// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { installPeopleSuggest, peopleSuggestScript, personLabel, PEOPLE_UNAVAILABLE, type SuggestPerson } from "../src/peopleSuggest";
import { readFileSync } from "node:fs";

const creditsHtml = readFileSync(new URL("../ui/credits.html", import.meta.url), "utf8");

/**
 * Founder 2026-10-30: typing a name already in the catalogue suggested nothing
 * in Live, because Live's window never shows a native <datalist> popup. These
 * tests drive the page's own list and never touch a datalist.
 */
const PEOPLE: SuggestPerson[] = [
  { name: "Joseph Oyelade", stageNames: ["Kehinde"] },
  { name: "James Large", stageNames: [] },
  { name: "Fez", stageNames: ["Féz", "SoundsLikeFez"] },
  { name: "Jo Bloggs", stageNames: [] },
];

/** A dialog with one people field, the suggestion script injected as Live gets it. */
function dialog(people = PEOPLE) {
  const html =
    `<!doctype html><html><head>${peopleSuggestScript(people)}</head>` +
    `<body><input id="who" list="people"><datalist id="people"></datalist></body></html>`;
  const dom = new JSDOM(html, { runScripts: "dangerously" });
  const doc = dom.window.document;
  const who = doc.getElementById("who") as HTMLInputElement;
  const type = (v: string) => {
    who.dispatchEvent(new dom.window.FocusEvent("focusin", { bubbles: true }));
    who.value = v;
    who.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  };
  const key = (k: string) =>
    who.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: k, bubbles: true }));
  const shown = () =>
    [...doc.querySelectorAll("[data-people-suggest] [role=option]")].map((o) => o.textContent);
  const visible = () =>
    (doc.querySelector("[data-people-suggest]") as HTMLElement | null)?.style.display === "block";
  return { dom, doc, who, type, key, shown, visible };
}

describe("installPeopleSuggest: matching", () => {
  const { match } = installPeopleSuggest(new JSDOM("<body></body>").window.document, PEOPLE);

  it("suggests names that start with what was typed, first, the shorter (closer) one ahead", () => {
    expect(match("jo").map((m) => m.name)).toEqual(["Jo Bloggs", "Joseph Oyelade"]);
  });

  // Founder smoke 2026-11-23: "Féz" did not come up for "F" or "Fe".
  it("folds accents both ways, and puts a prefix match ahead of a match inside a name", () => {
    const m = installPeopleSuggest(new JSDOM("").window.document, [
      { name: "Alfie Fenwick", stageNames: [] },
      { name: "Féz", stageNames: [] },
      { name: "Felicity Farrow-Jones", stageNames: [] },
    ]).match;
    expect(m("fe")[0]!.name).toBe("Féz");
    expect(m("f")[0]!.name).toBe("Féz");
    expect(m("fez").map((x) => x.name)).toEqual(["Féz"]);
    expect(m("FÉZ").map((x) => x.name)).toEqual(["Féz"]);
  });

  it("matches a later word in the name, and a stage name", () => {
    expect(match("large").map((m) => m.name)).toEqual(["James Large"]);
    expect(match("kehin").map((m) => m.name)).toEqual(["Joseph Oyelade"]);
  });

  it("shows the stage name beside the name, but fills the name", () => {
    expect(match("soundslike")).toEqual([
      { name: "Fez", label: "Fez (also Féz, SoundsLikeFez)" },
    ]);
  });

  it("suggests nothing for an empty field", () => {
    expect(match("  ")).toEqual([]);
  });
});

describe("the injected script in a dialog", () => {
  it("shows the page's own list while typing, and drops the native datalist hook", () => {
    const d = dialog();
    d.type("jam");
    expect(d.visible()).toBe(true);
    expect(d.shown()).toEqual(["James Large"]);
    expect(d.who.hasAttribute("list")).toBe(false);
  });

  it("enter picks the highlighted suggestion; arrows move the highlight", () => {
    const d = dialog();
    d.type("jo");
    expect(d.shown()).toEqual(["Jo Bloggs", "Joseph Oyelade (also Kehinde)"]);
    d.key("ArrowDown");
    d.key("Enter");
    expect(d.who.value).toBe("Joseph Oyelade");
    expect(d.visible()).toBe(false);
  });

  it("a stage-name match fills the person's name, so the exact-match link still happens", () => {
    const d = dialog();
    d.type("kehinde");
    d.key("Enter");
    expect(d.who.value).toBe("Joseph Oyelade");
  });

  it("escape closes the list and leaves what was typed", () => {
    const d = dialog();
    d.type("ja");
    d.key("Escape");
    expect(d.visible()).toBe(false);
    expect(d.who.value).toBe("ja");
  });

  it("clicking a suggestion picks it", () => {
    const d = dialog();
    d.type("fe");
    const opt = d.doc.querySelector("[data-people-suggest] [role=option]")!;
    opt.dispatchEvent(new d.dom.window.MouseEvent("mousedown", { bubbles: true }));
    expect(d.who.value).toBe("Fez");
  });

  it("works on rows added after the page loaded", () => {
    const d = dialog();
    const extra = d.doc.createElement("input");
    extra.setAttribute("list", "people");
    d.doc.body.appendChild(extra);
    extra.dispatchEvent(new d.dom.window.FocusEvent("focusin", { bubbles: true }));
    extra.value = "james";
    extra.dispatchEvent(new d.dom.window.Event("input", { bubbles: true }));
    expect(d.shown()).toEqual(["James Large"]);
  });

  it("a name not in the catalogue shows no list, and typing stays free text", () => {
    const d = dialog();
    d.type("zzz");
    expect(d.visible()).toBe(false);
    d.key("Enter");
    expect(d.who.value).toBe("zzz");
  });
});

describe("the credits dialog", () => {
  it("still marks its performer fields as people fields", () => {
    expect(creditsHtml).toContain('who.setAttribute("list", "people")');
  });
});

import { toSuggestPeople } from "../src/peopleSuggest";

describe("toSuggestPeople with the account's own name", () => {
  it("puts the account holder's own name in when no person on file has it", () => {
    const people = toSuggestPeople([{ id: "a1", name: "Felicia Alamu", stageNames: [] }], "Féz");
    expect(people[0]).toEqual({ name: "Féz", stageNames: [] });
    const m = installPeopleSuggest(new JSDOM("").window.document, people).match;
    expect(m("fe")[0]!.name).toBe("Féz");
  });

  it("adds nothing when a person already has that name, accents aside, or there is no name", () => {
    const c = [{ id: "me", name: "Fez", stageNames: [] }];
    expect(toSuggestPeople(c, "Féz")).toHaveLength(1);
    expect(toSuggestPeople(c, null)).toHaveLength(1);
    expect(toSuggestPeople(c, "  ")).toHaveLength(1);
  });
});

// Founder smoke 2026-11-25: the people did not load, and the fields read as
// plain boxes with nothing said.
describe("peopleSuggestScript: when the people did not load", () => {
  function emptyDialog(loaded: boolean) {
    const html =
      `<!doctype html><html><head>${peopleSuggestScript([], loaded)}</head>` +
      `<body><input id="who" list="people"></body></html>`;
    const dom = new JSDOM(html, { runScripts: "dangerously" });
    const doc = dom.window.document;
    const who = doc.getElementById("who") as HTMLInputElement;
    who.dispatchEvent(new dom.window.FocusEvent("focusin", { bubbles: true }));
    who.value = "fe";
    who.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    return doc;
  }

  it("says so under the field once something is typed, and offers nothing to pick", () => {
    const doc = emptyDialog(false);
    expect(doc.querySelector("[data-people-unavailable]")?.textContent).toBe(PEOPLE_UNAVAILABLE);
    expect(doc.querySelectorAll("[role=option]")).toHaveLength(0);
  });

  it("says nothing when the load worked and the catalogue is simply empty", () => {
    expect(emptyDialog(true).querySelector("[data-people-unavailable]")).toBeNull();
  });
});

describe("personLabel", () => {
  it("drops another name that only repeats the name, and keeps an accented spelling", () => {
    expect(personLabel("Fez", ["Féz", "Fez", "fez", "Feranmi Oguns", "Feach"])).toBe(
      "Fez (also Féz, Feranmi Oguns, Feach)",
    );
  });
  it("is just the name when there are no other names", () => {
    expect(personLabel(" Sam ", [" ", "sam"])).toBe("Sam");
  });
});
