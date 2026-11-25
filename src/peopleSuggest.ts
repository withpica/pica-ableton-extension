// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import type { PersonCandidate } from "./pica/people";

/** One person as the dialogs receive it: the name to fill, and stage names. */
export interface SuggestPerson {
  name: string;
  stageNames: string[];
}

/**
 * How a person reads in a list: the name, then any other names they go by
 * that differ from it. "Fez · Féz, Fez, Feranmi Oguns" repeated the name and
 * read as one long name (founder smoke 2026-11-25). Case is ignored when
 * comparing, accents are not, so "Féz" still shows beside "Fez".
 * Copy: e1 (2026-11-25). The dialog's own copy of this rule, inside
 * installPeopleSuggest, is pinned to it by a test.
 */
export function personLabel(name: string, stageNames: readonly string[]): string {
  const shown = name.trim();
  const plain = shown.toLowerCase();
  const seen = new Set<string>([plain]);
  const alias: string[] = [];
  for (const st of stageNames) {
    const t = st.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    alias.push(t);
  }
  return alias.length ? `${shown} (also ${alias.join(", ")})` : shown;
}

export function toSuggestPeople(candidates: PersonCandidate[], ownName?: string | null): SuggestPerson[] {
  const out = candidates.map((c) => ({ name: c.name, stageNames: c.stageNames }));
  // The account holder's own name is suggested even with no person on file
  // for it; picking it then creates the person, as typing it would.
  const own = ownName?.trim();
  if (own) {
    const fold = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
    const k = fold(own);
    if (!out.some((p) => fold(p.name) === k || p.stageNames.some((st) => fold(st) === k))) {
      out.unshift({ name: own, stageNames: [] });
    }
  }
  return out;
}

/**
 * Name suggestions for the dialogs' person fields, drawn by the page itself.
 *
 * The fields used a native <datalist>, and Live's embedded window never shows
 * a datalist's popup, so typing a name already in the catalogue suggested
 * nothing (founder, 2026-10-30). This draws its own list under the field.
 *
 * Runs INSIDE the dialog: extension.ts injects it as source text
 * (`peopleSuggestScript`), so it must be self-contained (no imports, no
 * outer references) and plain enough to survive minification. It acts on any
 * input with `list="people"` or `data-people`, including rows added later,
 * through listeners on the document.
 *
 * Picking a suggestion fills the person's NAME, never a stage name, so the
 * exact-match link to the existing person (resolvePersonId) still happens.
 * Keyboard: up/down move, enter picks, escape closes. Returns `match` for tests.
 */
export function installPeopleSuggest(
  doc: Document,
  people: SuggestPerson[],
  /** Shown under the field, in place of suggestions, when the people did not load. */
  unavailable?: string,
): { match: (q: string) => Array<{ name: string; label: string }> } {
  var MAX = 8;
  var list = (people || []).filter(function (p) {
    return p && typeof p.name === "string" && p.name.trim();
  });

  // Accents fold on both sides, so "fe" finds "Féz" and "fez" does too.
  function norm(s: string): string {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  }

  // Rank: name starts with the query, a word in the name does, a stage name
  // does, then the query anywhere. Within a rank the shorter name comes
  // first (the closer match), then catalogue order.
  function match(q: string): Array<{ name: string; label: string }> {
    var query = norm(q);
    if (!query) return [];
    var scored: Array<{ s: number; n: number; i: number; name: string; label: string }> = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i]!;
      var name = norm(p.name);
      var stages = (p.stageNames || []).map(norm);
      var s = -1;
      if (name.indexOf(query) === 0) s = 0;
      else if (name.split(/\s+/).some(function (w) { return w.indexOf(query) === 0; })) s = 1;
      else if (stages.some(function (st) { return st.indexOf(query) === 0; })) s = 2;
      else if (name.indexOf(query) >= 0 || stages.some(function (st) { return st.indexOf(query) >= 0; })) s = 3;
      if (s < 0) continue;
      // Shown spellings compare without folding, so "Féz" still shows beside
      // "Fez". The same rule as personLabel (pinned by a test).
      var plain = p.name.trim().toLowerCase();
      var seenAlias: Record<string, boolean> = {};
      seenAlias[plain] = true;
      var alias: string[] = [];
      (p.stageNames || []).forEach(function (st) {
        var t = String(st || "").trim();
        if (!t || seenAlias[t.toLowerCase()]) return;
        seenAlias[t.toLowerCase()] = true;
        alias.push(t);
      });
      scored.push({
        s: s,
        n: name.length,
        i: i,
        name: p.name.trim(),
        // Same wording as personLabel below (this runs inside the dialog, so
        // it cannot import it).
        label: p.name.trim() + (alias.length ? " (also " + alias.join(", ") + ")" : ""),
      });
    }
    scored.sort(function (a, b) { return a.s - b.s || a.n - b.n || a.i - b.i; });
    return scored.slice(0, MAX).map(function (x) { return { name: x.name, label: x.label }; });
  }

  var box: HTMLDivElement | null = null;
  var field: HTMLInputElement | null = null;
  var items: Array<{ name: string; label: string }> = [];
  var active = -1;

  function isPeopleField(el: unknown): el is HTMLInputElement {
    var e = el as HTMLInputElement | null;
    return !!e && e.tagName === "INPUT" &&
      (e.getAttribute("list") === "people" || e.hasAttribute("data-people"));
  }

  function close() {
    if (box) box.style.display = "none";
    items = [];
    active = -1;
  }

  function pick(i: number) {
    if (!field || !items[i]) return;
    field.value = items[i]!.name;
    field.dispatchEvent(new Event("change", { bubbles: true }));
    close();
  }

  function paint() {
    if (!box) return;
    while (box.firstChild) box.removeChild(box.firstChild);
    items.forEach(function (it, i) {
      var row = doc.createElement("div");
      row.setAttribute("role", "option");
      row.setAttribute("data-suggestion", it.name);
      row.textContent = it.label;
      row.style.cssText =
        "padding:6px 8px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" +
        (i === active ? "background:rgba(184,115,51,.25);color:#EDEDED" : "color:#EDEDED");
      if (i === active) row.setAttribute("aria-selected", "true");
      // mousedown, not click: it lands before the field's blur closes the list.
      row.addEventListener("mousedown", function (e) { e.preventDefault(); pick(i); });
      box!.appendChild(row);
    });
  }

  function open(input: HTMLInputElement) {
    field = input;
    items = match(input.value);
    active = items.length ? 0 : -1;
    // No people loaded at all: say so once something is typed, rather than
    // leave what looks like a plain box (founder smoke 2026-11-25).
    var note = !list.length && unavailable && input.value.trim() ? unavailable : "";
    if (!items.length && !note) { close(); return; }
    if (!box) {
      box = doc.createElement("div");
      box.setAttribute("role", "listbox");
      box.setAttribute("data-people-suggest", "");
      box.style.cssText =
        "position:absolute;z-index:1000;background:#141414;border:1px solid rgba(255,255,255,.18);" +
        "font-size:12px;max-height:220px;overflow-y:auto";
      doc.body.appendChild(box);
    }
    var r = input.getBoundingClientRect();
    var view = doc.defaultView;
    box.style.left = r.left + (view ? view.scrollX : 0) + "px";
    box.style.top = r.bottom + (view ? view.scrollY : 0) + 2 + "px";
    box.style.width = Math.max(r.width, 160) + "px";
    box.style.display = "block";
    if (note) {
      while (box.firstChild) box.removeChild(box.firstChild);
      var msg = doc.createElement("div");
      msg.setAttribute("data-people-unavailable", "");
      msg.textContent = note;
      msg.style.cssText = "padding:6px 8px;color:#A0A0A0;white-space:normal";
      box.appendChild(msg);
      return;
    }
    paint();
  }

  doc.addEventListener("focusin", function (e) {
    var t = e.target;
    if (!isPeopleField(t)) return;
    // Drop the native datalist hook so the two never fight.
    if (t.getAttribute("list") === "people") {
      t.removeAttribute("list");
      t.setAttribute("data-people", "");
      t.setAttribute("autocomplete", "off");
    }
  });
  doc.addEventListener("input", function (e) {
    if (isPeopleField(e.target)) open(e.target);
  });
  doc.addEventListener("focusout", function (e) {
    if (e.target === field) close();
  });
  doc.addEventListener("keydown", function (e) {
    if (e.target !== field || !box || box.style.display === "none" || !items.length) return;
    if (e.key === "ArrowDown") { active = (active + 1) % items.length; paint(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = (active - 1 + items.length) % items.length; paint(); e.preventDefault(); }
    else if (e.key === "Enter") { if (active >= 0) { pick(active); e.preventDefault(); } }
    else if (e.key === "Escape") { close(); e.preventDefault(); }
  });

  return { match: match };
}

/**
 * What a person field says when the catalogue's people could not be loaded.
 * Copy: e1 (2026-11-25).
 */
export const PEOPLE_UNAVAILABLE =
  "couldn't load the people in your catalogue, so there are no suggestions. type their full name: if they're already in pica, it's matched to them when you save.";

/**
 * The script tag that installs the suggestions in a dialog, people inlined.
 * `loaded` false (the people load failed) makes an empty field say so.
 */
export function peopleSuggestScript(people: SuggestPerson[], loaded = true): string {
  const json = JSON.stringify(people).replace(/</g, "\\u003c");
  const note = loaded ? "" : `, ${JSON.stringify(PEOPLE_UNAVAILABLE).replace(/</g, "\\u003c")}`;
  return `<script>(${installPeopleSuggest.toString()})(document, ${json}${note});</script>`;
}
