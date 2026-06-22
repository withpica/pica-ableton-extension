// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { PicaMcpError, type PicaMcpClient } from "./mcpClient";

export interface DeliverDeps {
  client: PicaMcpClient;
}

export interface DeliverArgs {
  workId: string;
  email: string;
  note?: string;
  allowDownload: boolean;
  confirmFirstExternal?: boolean;
  includedFileIds?: string[];
}

export type DeliverResult =
  | { state: "sent"; shareUrl: string; classification: string; displayName: string | null }
  | { state: "needs_confirm"; email: string }
  | { state: "error"; message: string; code?: string };

const FIRST_EXTERNAL = "FIRST_EXTERNAL_SEND_CONFIRMATION_REQUIRED";

/** Basic deliverability check: non-empty, exactly one @, a dot in the domain. */
export function isDeliverableEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Send a registered work to a recipient via pica_share_send (entity_type='work').
 *
 * Error handling note: the share-send tool's error path returns a RESOLVED
 * object carrying `error_code` (it uses formatStructured, which sets no
 * isError), so a delivery failure does NOT throw — it comes back as a normal
 * callTool result. Network / HTTP / JSON-RPC failures DO throw PicaMcpError.
 * Both shapes are handled here.
 */
export async function deliverWork(deps: DeliverDeps, args: DeliverArgs): Promise<DeliverResult> {
  const email = args.email.trim();
  const payload: Record<string, unknown> = {
    entity_type: "work",
    entity_id: args.workId,
    recipient: { kind: "email", value: email },
    note: args.note?.trim() || undefined,
    scope: args.allowDownload ? "view+download" : "view",
    confirm_first_external_send: args.confirmFirstExternal ? true : undefined,
    ...(args.includedFileIds && args.includedFileIds.length > 0
      ? { included_file_ids: args.includedFileIds }
      : {}),
  };

  let r: any;
  try {
    r = await deps.client.callTool("pica_share_send", payload);
  } catch (e) {
    if (e instanceof PicaMcpError) {
      if (e.code === FIRST_EXTERNAL) return { state: "needs_confirm", email };
      return { state: "error", message: friendlyDeliverError(e.message), code: e.code };
    }
    return { state: "error", message: String(e) };
  }

  if (r && typeof r === "object" && r.error_code) {
    // The MCP pica_share_send tool collapses the route's specific error_code to
    // a generic SHARE_SEND_ERROR and preserves the real signal only in `status`
    // and the `error` message (verified live). So detect the first-external
    // confirmation via HTTP 428 (the route's code for it) or the message —
    // NOT error_code === FIRST_EXTERNAL, which the tool rarely surfaces.
    const msg = typeof r.error === "string" ? r.error : "";
    if (r.error_code === FIRST_EXTERNAL || r.status === 428 || msg.includes(FIRST_EXTERNAL)) {
      return { state: "needs_confirm", email };
    }
    return { state: "error", message: friendlyDeliverError(msg, r.suggestion), code: r.error_code };
  }

  return {
    state: "sent",
    shareUrl: r?.share_url ?? "",
    classification: r?.recipient_resolution?.classification ?? "external",
    displayName: r?.recipient_resolution?.display_name ?? null,
  };
}

/**
 * Render a plain-language message from pica_share_send's raw error. The MCP
 * tool collapses the real code into a generic SHARE_SEND_ERROR and nests the
 * truth as "API request failed: <status> {json}" in the message — so parse the
 * inner JSON and map the real code / retry_after to language a human reads,
 * instead of dumping raw JSON in the dialog.
 */
export function friendlyDeliverError(rawMessage: string, suggestion?: string): string {
  let code = "";
  let inner = "";
  let retryAfter = 0;
  const start = rawMessage.indexOf("{");
  if (start >= 0) {
    try {
      const p = JSON.parse(rawMessage.slice(start));
      code = typeof p.error_code === "string" ? p.error_code : "";
      inner = typeof p.error === "string" ? p.error : "";
      retryAfter = typeof p.retry_after_seconds === "number" ? p.retry_after_seconds : 0;
    } catch {
      /* not JSON — fall through to the raw text */
    }
  }
  const hrs = retryAfter > 0 ? Math.max(1, Math.round(retryAfter / 3600)) : 0;
  const later = hrs ? ` try again in ~${hrs}h.` : "";
  switch (code) {
    case "RECIPIENT_VOLUME_EXCEEDED":
      return `that recipient has had a lot of email from PICA recently, so this was held back.${later}`;
    case "SENDER_RATE_LIMIT_EXCEEDED":
      return `you've sent a lot of shares in the last day.${later || " try again later."}`;
    case "ROLE_ADDRESS_REJECTED":
      return "that looks like a role inbox (noreply@, admin@, …) — use the person's own email.";
    case "RECIPIENT_NOT_FOUND":
      return "couldn't find that recipient — check the email address.";
    case "ENTITY_NOT_FOUND":
      return "couldn't find that work in your catalog.";
    default:
      return inner || suggestion || rawMessage || "delivery failed.";
  }
}
