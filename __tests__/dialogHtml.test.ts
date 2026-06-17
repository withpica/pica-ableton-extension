import { describe, it, expect } from "vitest";
import { escapeHtml, messageHtml, linkMessageHtml, finalReportHtml, type RegisterReport, pasteKeyHtml, duplicateChoiceHtml } from "../src/dialogHtml";

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

describe("finalReportHtml", () => {
  const base: RegisterReport = {
    action: "registered",
    title: "My Song",
    workId: "w1",
    recordingId: "r1",
  };

  it("renders the registered lead line and all three links", () => {
    const html = finalReportHtml(base);
    expect(html).toContain("are now in your catalog");
    expect(html).toContain("My Song");
    expect(html).toContain("https://withpica.com/inspect/works/w1");
    expect(html).toContain("https://withpica.com/inspect/recordings/r1");
    expect(html).toContain("https://withpica.com/inspect");
    expect(html).toContain("view the work");
    expect(html).toContain("view the recording");
    expect(html).toContain("open your catalog");
  });

  it("varies the lead line by action", () => {
    expect(finalReportHtml({ ...base, action: "version" })).toContain("as a new version");
    expect(finalReportHtml({ ...base, action: "existing" })).toContain("updated &quot;My Song&quot;");
  });

  it("escapes the title", () => {
    const html = finalReportHtml({ ...base, title: "<b>x</b>" });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
  });

  it("renders ownership lines and omits when undefined", () => {
    expect(finalReportHtml({ ...base, masterOwnership: "created" })).toContain("your org now owns 100%");
    expect(finalReportHtml({ ...base, masterOwnership: "skipped_existing" })).toContain("master ownership: already set");
    expect(finalReportHtml({ ...base, masterOwnership: "failed" })).toContain("could not be saved automatically");
    expect(finalReportHtml(base)).not.toContain("master ownership");
  });

  it("distinguishes credits skipped / error / saved, and omits when undefined", () => {
    expect(finalReportHtml({ ...base, credits: { state: "skipped" } })).toContain("credits: skipped.");
    expect(finalReportHtml({ ...base, credits: { state: "error", error: "boom" } })).toContain("credits: could not be saved.");
    expect(finalReportHtml({ ...base, credits: { state: "saved", outcomes: [{ creditedName: "a", instrument: "b", status: "saved_linked" }] } })).toContain("credits: 1 saved.");
    expect(finalReportHtml(base)).not.toContain("credits:");
  });

  it("distinguishes writers skipped / error / saved-empty, and omits when undefined", () => {
    expect(finalReportHtml({ ...base, writers: { state: "skipped" } })).toContain("writers: skipped.");
    expect(finalReportHtml({ ...base, writers: { state: "error", error: "x" } })).toContain("writers: could not be saved.");
    expect(finalReportHtml({ ...base, writers: { state: "saved", outcomes: [] } })).toContain("writers: none added.");
    expect(finalReportHtml(base)).not.toContain("writers:");
  });

  it("shows the splice line only when > 0", () => {
    expect(finalReportHtml({ ...base, spliceLogged: 3 })).toContain("splice samples: 3 logged");
    expect(finalReportHtml({ ...base, spliceLogged: 0 })).not.toContain("splice samples");
    expect(finalReportHtml(base)).not.toContain("splice samples");
  });

  it("renders a send-stems button and labels the recording link for the master upload", () => {
    const html = finalReportHtml({ action: "registered", title: "X", workId: "w1", recordingId: "r1" });
    expect(html).toContain("send stems");
    expect(html).toContain("upload your master");
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

describe("duplicateChoiceHtml", () => {
  const html = duplicateChoiceHtml("My Song", ["alternate", "remix", "demo"]);
  it("shows the title and all three actions", () => {
    expect(html).toContain("My Song");
    expect(html).toContain("action:'existing'");
    expect(html).toContain("action:'newVersion'");
    expect(html).toContain("action:'cancel'");
  });
  it("reads the selected version type from the #vt select", () => {
    expect(html).toContain('id="vt"');
    expect(html).toContain("document.getElementById('vt').value");
  });
  it("renders one option per supplied version type, default first", () => {
    expect(html).toContain('<option value="alternate">');
    expect(html).toContain('<option value="remix">');
    expect(html).toContain('<option value="demo">');
    expect(html.indexOf('value="alternate"')).toBeLessThan(html.indexOf('value="remix"'));
  });
  it("escapes the title", () => {
    expect(duplicateChoiceHtml('<x>', ["alternate"])).toContain("&lt;x&gt;");
  });
});
