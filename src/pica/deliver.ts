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

/**
 * The address in what the recipient field holds: a typed address, or a picked
 * contact's "Name <email>".
 */
export function recipientEmail(field: string): string {
  const t = field.trim();
  const m = /<([^<>\s]+)>$/.exec(t);
  return m ? m[1]!.trim() : t;
}

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

export interface LinkArgs {
  workId: string;
  workTitle: string;
  note?: string;
  allowDownload: boolean;
  includedFileIds?: string[];
  /** Injected for tests; defaults to now. */
  now?: Date;
}

export type LinkResult =
  | {
      state: "made";
      shareUrl: string;
      linkId: string | null;
      /** Set only when a note was typed: whether it was added to the link. */
      noteSaved?: boolean;
    }
  | { state: "error"; message: string; code?: string; /** The raw reason, for the console only. */ detail?: string };

/** The same 30 days an emailed share lasts (pica_share_send's default). */
const LINK_DAYS = 30;

/**
 * Make a share link for a work and email nobody (ADR-259 Stage 5, Piece C).
 *
 * The link is a share_links row like the one an emailed share makes, with the
 * same choices: download on or off, the chosen stems (or every file when none
 * were picked), streaming on, 30 days. So it is tracked (views are counted)
 * and can be turned off in PICA (the song page's sharing section, "turn off").
 */
export async function createWorkLink(deps: DeliverDeps, args: LinkArgs): Promise<LinkResult> {
  const now = args.now ?? new Date();
  const expires = new Date(now.getTime() + LINK_DAYS * 24 * 60 * 60 * 1000);
  const picked = args.includedFileIds && args.includedFileIds.length > 0;
  const payload: Record<string, unknown> = {
    work_id: args.workId,
    name: args.workTitle.trim() || "shared from Ableton",
    // No personal_message here: the create route refuses it (it is not in
    // SHARE_LINK_POST_ALLOWED_FIELDS in PICA), though the update accepts it.
    expires_at: expires.toISOString(),
    allow_download: args.allowDownload,
    allow_streaming: true,
    include_all_files: !picked,
    ...(picked ? { included_file_ids: args.includedFileIds } : {}),
  };

  let r: any;
  try {
    r = await deps.client.callTool("pica_share_links_create", payload);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { state: "error", message: linkErrorMessage(detail), code: e instanceof PicaMcpError ? e.code : undefined, detail };
  }
  if (r && typeof r === "object" && r.error_code) {
    const detail = typeof r.error === "string" ? r.error : "";
    return { state: "error", message: linkErrorMessage(detail, r.suggestion), code: r.error_code, detail };
  }
  const shareUrl = typeof r?.share_url === "string" ? r.share_url : "";
  // Never report a link that isn't there: no share_url is a failure.
  if (!shareUrl) {
    return { state: "error", message: "pica didn't send the link back. look under sharing on the song in pica." };
  }
  const linkId = typeof r?.id === "string" ? r.id : null;
  const note = args.note?.trim();
  if (!note) return { state: "made", shareUrl, linkId };
  // The note, shown on the share page as a quote, goes on with an update.
  // Best-effort: the link already exists, so a failure here is reported
  // beside it rather than as a failed link.
  let noteSaved = false;
  if (linkId) {
    try {
      const u: any = await deps.client.callTool("pica_share_links_update", { id: linkId, personal_message: note });
      noteSaved = !(u && typeof u === "object" && u.error_code);
    } catch {
      noteSaved = false;
    }
  }
  return { state: "made", shareUrl, linkId, noteSaved };
}

const LINK_ERROR_FALLBACK = "something went wrong. try again, or make the link on the song in pica.";

/**
 * What a failed link says: always plain words. The API's own message names
 * fields and routes ("unknown field 'personal_message' on share-links —
 * allowed fields: …", founder smoke 2026-11-23), so it never reaches the
 * screen; extension.ts logs it to the console instead.
 */
export function linkErrorMessage(_rawMessage: string, _suggestion?: string): string {
  return LINK_ERROR_FALLBACK;
}
