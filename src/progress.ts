// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { rotateLine } from "./storyCopy";

export interface StoryOptions {
  /** The honest phase label, shown immediately (e.g. "rendering drum loop…"). */
  steadyLabel: string;
  /** The held progress value; the bar does not move while the timer rotates copy. */
  pct: number;
  /** The idle pool rotated through while `work` is pending. */
  idleLines: readonly string[];
  /** How often to rotate a new idle line (ms). */
  intervalMs: number;
  /** Where in the pool to start rotating (lets a loop walk the pool globally). */
  startTick?: number;
}

/**
 * Run `work()` while a timer rotates `idleLines` through `update()` so an
 * opaque wait never looks frozen. The host closes the progress dialog when
 * `work()` resolves, so a `settled` guard ensures no `update()` lands after
 * that, and every timer-fired update swallows rejections (a late/racing update
 * must never surface as an error). Used only by the stems loop in slice 1.
 */
export async function withStory<T>(
  update: (text: string, progress?: number) => Promise<void>,
  signal: AbortSignal,
  opts: StoryOptions,
  work: () => Promise<T>,
): Promise<T> {
  let settled = false;
  let tick = opts.startTick ?? 0;
  // Show the honest phase label immediately; idle provenance lines follow.
  await update(opts.steadyLabel, opts.pct).catch(() => {});
  const timer = setInterval(() => {
    if (settled || signal.aborted) return;
    tick += 1;
    void update(rotateLine(opts.idleLines, tick), opts.pct).catch(() => {});
  }, opts.intervalMs);
  try {
    return await work();
  } finally {
    settled = true;
    clearInterval(timer);
  }
}
