// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

/**
 * The single home for every in-DAW loading string (phase labels + the idle
 * rotation pool). Pure and host-independent so the node-env Vitest suite can
 * lock the voice — the same discipline as dialogHtml.ts. Strings here are
 * passed to the host progress dialog's `update()`, never rendered as HTML.
 */

export type StemPhase = "render" | "upload" | "queued";
export type RegisterPhase = "introduce" | "register";

/** A stem's current phase, data-aware. `sizeMb` shows only on upload. */
export function stemPhaseLabel(
  phase: StemPhase,
  stemName: string,
  sizeMb?: number,
): string {
  const name = stemName.trim() || "this stem";
  switch (phase) {
    case "render":
      return `rendering ${name}, straight from the session…`;
    case "upload":
      return sizeMb && sizeMb > 0
        ? `${name}, onto your master… (${sizeMb} mb)`
        : `${name}, onto your master…`;
    case "queued":
      return `${name}'s in. analysis to follow…`;
  }
}

export function registerPhaseLabel(
  phase: RegisterPhase,
  title: string,
): string {
  switch (phase) {
    case "introduce":
      return "declaring you as the maker…";
    case "register":
      return `registering "${title.trim()}" in your catalog…`;
  }
}

export function deliverPhaseLabel(title: string, recipient?: string): string {
  const t = title.trim();
  const to = recipient?.trim();
  return to ? `sending "${t}" to ${to}…` : `sending "${t}"…`;
}

export function creditsPhaseLabel(): string {
  return "crediting who played what…";
}

export function writersPhaseLabel(title?: string): string {
  const t = title?.trim();
  return t ? `naming the writers on "${t}"…` : "naming the writers…";
}

/** The blend pool: editorial-minimal dominant, two warmer lines for breathing room. */
export const IDLE_LINES: readonly string[] = [
  "made together. credited together.",
  "every hand, named.",
  "who played what, straight from the source.",
  "your part. their part. one record.",
  "the credits write themselves while you work.",
  "captured at the source.",
  "a session forgets. the record won't.",
];

/** Deterministic pick from `lines` by tick (caller owns the tick). Empty → "". */
export function rotateLine(lines: readonly string[], tick: number): string {
  if (lines.length === 0) return "";
  const i = ((tick % lines.length) + lines.length) % lines.length;
  return lines[i] ?? "";
}

/**
 * True if `s` honours the loading-copy voice: no em dash and all-lowercase.
 * Feed it static copy (IDLE_LINES) or labels built from lowercase data — the
 * test gate that stops the voice silently drifting.
 */
export function obeysCopyInvariants(s: string): boolean {
  return !s.includes("—") && s === s.toLowerCase();
}
