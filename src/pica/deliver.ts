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
  };

  let r: any;
  try {
    r = await deps.client.callTool("pica_share_send", payload);
  } catch (e) {
    if (e instanceof PicaMcpError) {
      if (e.code === FIRST_EXTERNAL) return { state: "needs_confirm", email };
      return { state: "error", message: e.message, code: e.code };
    }
    return { state: "error", message: String(e) };
  }

  if (r && typeof r === "object" && r.error_code) {
    if (r.error_code === FIRST_EXTERNAL) return { state: "needs_confirm", email };
    return { state: "error", message: r.error || r.suggestion || "delivery failed", code: r.error_code };
  }

  return {
    state: "sent",
    shareUrl: r?.share_url ?? "",
    classification: r?.recipient_resolution?.classification ?? "external",
    displayName: r?.recipient_resolution?.display_name ?? null,
  };
}
