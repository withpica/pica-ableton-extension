// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";

const audioHtml = readFileSync(new URL("../ui/audio.html", import.meta.url), "utf8");

/** The stems window with injected data, answering into `sent` as Live would. */
function open(data: Record<string, unknown>) {
  const sent: Array<{ params: string[] }> = [];
  const html = audioHtml.replace(
    "</head>",
    `<script>window.__PICA_STEMS__ = ${JSON.stringify(data)};</script></head>`,
  );
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    beforeParse(w) {
      (w as unknown as { webkit: unknown }).webkit = {
        messageHandlers: { live: { postMessage: (m: { params: string[] }) => sent.push(m) } },
      };
    },
  });
  const d = dom.window.document;
  const set = (id: string, v: string) => {
    const el = d.getElementById(id) as HTMLSelectElement;
    el.value = v;
    el.dispatchEvent(new dom.window.Event("change"));
  };
  const save = () => {
    (d.getElementById("save") as HTMLButtonElement).click();
    return JSON.parse(sent[0]!.params[0]!);
  };
  return { d, set, save };
}

const STEMS = [{ index: 0, name: "BASS", label: "BASS" }];
const LOCS = [
  { index: 0, name: "INTRO" },
  { index: 1, name: "V1" },
  { index: 2, name: "CH" },
];

describe("stems window: what to export", () => {
  it("exports the whole song unless a section is chosen", () => {
    const w = open({ stems: STEMS, locators: LOCS });
    expect(w.save().range).toEqual({ mode: "whole" });
  });

  it("sends the two locators chosen, ending at the next one by default", () => {
    const w = open({ stems: STEMS, locators: LOCS });
    w.set("range", "locators");
    w.set("from", "1");
    expect(w.save().range).toEqual({ mode: "locators", from: 1, to: 2 });
  });

  it("can run a section to the end of the song", () => {
    const w = open({ stems: STEMS, locators: LOCS });
    w.set("range", "locators");
    w.set("from", "2");
    expect(w.save().range).toEqual({ mode: "locators", from: 2, to: -1 });
  });

  // Founder 2026-10-30: the window must tell people how to use this.
  it("says how to export a section, and how to add a locator", () => {
    const w = open({ stems: STEMS, locators: LOCS });
    const hint = w.d.getElementById("rangehint")!.textContent!;
    expect(hint).toMatch(/pick the locator it starts at and the one it ends at/);
    expect(hint).toMatch(/create → add locator/);
  });

  it("with no locators, offers only the whole song and says how to add one", () => {
    const w = open({ stems: STEMS, locators: [] });
    const opt = w.d.querySelector('#range option[value="locators"]') as HTMLOptionElement;
    expect(opt.disabled).toBe(true);
    expect(w.d.getElementById("rangehint")!.textContent).toMatch(/no locators/);
  });

  it("shows why a range was refused, and keeps the chosen range", () => {
    const w = open({
      stems: STEMS,
      locators: LOCS,
      range: { mode: "locators", from: 2, to: 1 },
      error: '"V1" is not after "CH". pick an end that comes later.',
    });
    expect(w.d.getElementById("rangeerror")!.textContent).toMatch(/is not after/);
    expect((w.d.getElementById("from") as HTMLSelectElement).value).toBe("2");
  });
});
