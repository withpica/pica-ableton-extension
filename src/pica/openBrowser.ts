// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { spawn as nodeSpawn } from "node:child_process";

type SpawnFn = typeof nodeSpawn;

const SAFE_URL = /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._~/?=-]*)?$/;

/**
 * Open `url` in the system browser.
 *
 * The Extensions SDK has no host call for this, and Live's modal webview
 * cannot open one either (a link inside it navigates the captive window, which
 * then cannot be closed). The extension host is Node, so ask the OS: `open` on
 * macOS, `start` on Windows, `xdg-open` elsewhere. Best-effort: resolves false
 * when the command cannot be started, so the caller can fall back to a link to
 * copy. Only plain https URLs are opened: no characters a shell or cmd would
 * read as syntax (`&`, `|`, `^`, `%`, quotes, spaces), because Windows hands
 * the URL to cmd's `start`.
 */
export function openInBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
  spawn: SpawnFn = nodeSpawn,
): Promise<boolean> {
  if (!SAFE_URL.test(url)) return Promise.resolve(false);
  const [cmd, args] =
    platform === "darwin"
      ? ["open", [url]]
      : platform === "win32"
        ? // `start` is a cmd builtin; the empty "" is its window-title slot.
          ["cmd", ["/c", "start", '""', url]]
        : ["xdg-open", [url]];
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args as string[], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
