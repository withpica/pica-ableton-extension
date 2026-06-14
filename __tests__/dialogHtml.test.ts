import { describe, it, expect } from "vitest";
import { escapeHtml, messageHtml, linkMessageHtml, successBody, pasteKeyHtml } from "../src/dialogHtml";

describe("escapeHtml", () => {
  it("escapes &, <, > and quotes", () => {
    expect(escapeHtml(`a & <b> "c"`)).toBe("a &amp; &lt;b&gt; &quot;c&quot;");
  });
});

describe("messageHtml", () => {
  it("renders the title and escaped body with a close button", () => {
    const html = messageHtml("pica — error", "boom <script>");
    expect(html).toContain("pica — error");
    expect(html).toContain("boom &lt;script&gt;");
    expect(html).toContain("close_and_send");
  });

  it("keeps text selectable for manual copying", () => {
    expect(messageHtml("t", "b")).toContain("user-select:text");
  });
});

describe("linkMessageHtml", () => {
  const url = "https://withpica.com/inspect/works/abc-123";

  it("renders the url as a clickable anchor", () => {
    const html = linkMessageHtml("pica", "done", url);
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain('target="_blank"');
  });

  it("includes a copy-link button with a clipboard call and a selection fallback", () => {
    const html = linkMessageHtml("pica", "done", url);
    expect(html).toContain("copy link");
    expect(html).toContain("navigator.clipboard");
    expect(html).toContain("execCommand");
  });
});

describe("successBody", () => {
  // 2026-06-12 smoke-test feedback: "Registered · 0% complete" read as if the
  // upload itself failed. The body must say the work IS in the catalog and
  // frame the score as expected-to-be-low.
  it("states the work is in the catalog and frames a 0% score as normal", () => {
    const body = successBody(0);
    expect(body).toContain("now in your catalog");
    expect(body).toContain("completeness 0%");
    expect(body).toContain("normal for a fresh registration");
  });

  it("omits the completeness line when no score is available", () => {
    const body = successBody(undefined);
    expect(body).toContain("now in your catalog");
    expect(body).not.toContain("completeness");
  });

  it("successBody shows the master-ownership line when created", () => {
    const html = successBody(12, "created");
    expect(html).toContain("master ownership");
    expect(html).toContain("100%");
  });

  it("successBody shows nothing about ownership when status is undefined", () => {
    expect(successBody(12)).not.toContain("master ownership");
  });

  it("successBody notes a failed ownership write so it is not silent", () => {
    const html = successBody(undefined, "failed");
    expect(html).toContain("master ownership");
    expect(html).toContain("could not be saved");
  });
});

describe("pasteKeyHtml", () => {
  it("renders a key input and a connect button that bridges {apiKey}", () => {
    const html = pasteKeyHtml();
    expect(html).toContain('id="k"');
    expect(html).toContain("close_and_send");
    expect(html).toContain("apiKey");
  });

  it("renders a cancel button that bridges {cancelled:true}", () => {
    expect(pasteKeyHtml()).toContain("cancelled");
  });
});
