import { describe, it, expect } from "vitest";
import { escapeHtml, messageHtml, linkMessageHtml, finalReportHtml, type RegisterReport, pasteKeyHtml, duplicateChoiceHtml, titlePromptHtml, deliverHtml, deliverConfirmHtml, stemsReportHtml, shareStemsHtml } from "../src/dialogHtml";

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

  it("renders a log-stems button and labels the recording link for the master upload", () => {
    const html = finalReportHtml({ action: "registered", title: "X", workId: "w1", recordingId: "r1" });
    expect(html).toContain("log stems →");
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

describe("titlePromptHtml", () => {
  it("renders a single title input and the prompt heading", () => {
    const h = titlePromptHtml();
    expect(h).toContain('id="t"');
    expect(h).toContain('class="h"');
    expect(h).toContain("which work?");
  });
});

describe("deliverHtml", () => {
  it("has email/note/allow-download controls and a send button bridging the payload", () => {
    const html = deliverHtml('My Song "Live"');
    expect(html).toContain("My Song &quot;Live&quot;"); // title escaped
    expect(html).toContain('id="e"'); // email
    expect(html).toContain('id="n"'); // note
    expect(html).toContain('id="d"'); // allow-download checkbox
    expect(html).toContain("getElementById('e').value");
    expect(html).toContain("note:document.getElementById('n').value");
    expect(html).toContain("allowDownload:document.getElementById('d').checked");
    expect(html).toContain("cancelled:true");
  });
});

describe("deliverConfirmHtml", () => {
  it("names the email and bridges confirmed/cancelled", () => {
    const html = deliverConfirmHtml("sarah@band.com");
    expect(html).toContain("sarah@band.com");
    expect(html).toContain("confirmed:true");
    expect(html).toContain("cancelled:true");
  });

  it("escapes html-special characters in the email", () => {
    const html = deliverConfirmHtml('evil <script> "person"@x.com');
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;person&quot;");
  });
});

describe("titlePromptHtml subtitle", () => {
  it("uses a custom subtitle when given, default otherwise", () => {
    expect(titlePromptHtml("type the title of the work you want to deliver:")).toContain("you want to deliver");
    expect(titlePromptHtml()).toContain("these stems belong to"); // default preserved
  });
});

describe("finalReportHtml deliver button", () => {
  it("offers a deliver action alongside send stems", () => {
    const html = finalReportHtml({
      action: "registered", title: "T", workId: "w", recordingId: "r",
    } as any);
    expect(html).toContain("'deliver'");
    expect(html).toContain("'sendStems'");
  });
});

describe("rename: register report follow-on buttons", () => {
  const base: RegisterReport = {
    action: "registered",
    title: "Wave",
    workId: "w1",
    recordingId: "r1",
  };
  it("uses 'log stems →' and 'share with →' (not the old labels)", () => {
    const html = finalReportHtml(base);
    expect(html).toContain("log stems →");
    expect(html).toContain("share with →");
    expect(html).not.toContain("send stems →");
    expect(html).not.toContain("deliver this →");
  });
  it("keeps the internal bridge action ids stable", () => {
    const html = finalReportHtml(base);
    expect(html).toContain("'sendStems'");
    expect(html).toContain("'deliver'");
  });
});

describe("rename: deliverHtml is now 'share'", () => {
  it("renders share title, body, and button", () => {
    const html = deliverHtml("Wave");
    expect(html).toContain('pica / share "Wave"');
    expect(html).toContain("share this work with someone by email");
    expect(html).toContain(">share</button>");
    expect(html).not.toContain("pica — deliver");
  });
});

describe("rename: deliverConfirmHtml is now 'sharing'", () => {
  it("renders 'first time sharing with'", () => {
    const html = deliverConfirmHtml("a@b.com");
    expect(html).toContain("first time sharing with a@b.com");
    expect(html).not.toContain("first time sending to");
  });
});

describe("shareStemsHtml", () => {
  const stems = [
    { id: "id-1", label: "drums", fileType: "wav" },
    { id: "id-2", label: 'bass "DI"', fileType: "aiff" },
  ];

  it("renders lowercase heading 'which stems to share' with no em dash", () => {
    const html = shareStemsHtml(stems);
    expect(html).toContain("pica: which stems to share");
    expect(html).not.toContain("—");
    expect(html).not.toContain("&mdash;");
  });

  it("renders one stem-row per stem with the correct data-id", () => {
    const html = shareStemsHtml(stems);
    expect(html).toContain('data-id="id-1"');
    expect(html).toContain('data-id="id-2"');
    expect((html.match(/class="stem-row"/g) ?? []).length).toBe(2);
  });

  it("each row has an include/skip select defaulting to include", () => {
    const html = shareStemsHtml(stems);
    expect((html.match(/<option value="include">/g) ?? []).length).toBe(2);
    expect((html.match(/<option value="skip">/g) ?? []).length).toBe(2);
    // include appears before skip in each row (default is include)
    expect(html.indexOf('<option value="include">')).toBeLessThan(html.indexOf('<option value="skip">'));
  });

  it("shows each stem label (escaped) and file_type", () => {
    const html = shareStemsHtml(stems);
    expect(html).toContain("drums");
    // label with quotes is escaped
    expect(html).toContain("bass &quot;DI&quot;");
    expect(html).not.toContain('bass "DI"');
    expect(html).toContain("wav");
    expect(html).toContain("aiff");
  });

  it("has a share button that collects included data-ids and a cancel button", () => {
    const html = shareStemsHtml(stems);
    expect(html).toContain(">share</button>");
    expect(html).toContain(">cancel</button>");
    expect(html).toContain("close_and_send");
    expect(html).toContain("cancelled:true");
    // share button posts ids array
    expect(html).toContain("ids");
    expect(html).toContain("row.dataset.id");
  });
});

describe("flat form dialogs", () => {
  const FLAT_STYLE_MARKER = "--copper:#B87333";

  it("deliverHtml is flat + keeps its field ids and share payload", () => {
    const h = deliverHtml('a "b" work');
    expect(h).toContain(FLAT_STYLE_MARKER);
    expect(h).toContain('class="h"');
    expect(h).toContain('id="e"');
    expect(h).toContain('id="n"');
    expect(h).toContain('id="d"');
    expect(h).toContain("document.getElementById('e').value.trim()");
    expect(h).toContain("allowDownload:document.getElementById('d').checked");
    expect(h).toContain("&quot;b&quot;");
    expect(h).not.toContain("#1A1A1A");
  });

  it("pasteKeyHtml keeps #k + apiKey payload", () => {
    const h = pasteKeyHtml();
    expect(h).toContain(FLAT_STYLE_MARKER);
    expect(h).toContain('id="k"');
    expect(h).toContain("apiKey:document.getElementById('k').value.trim()");
    expect(h).not.toContain("#1A1A1A");
  });

  it("titlePromptHtml keeps #t + title payload", () => {
    const h = titlePromptHtml();
    expect(h).toContain(FLAT_STYLE_MARKER);
    expect(h).toContain("title:document.getElementById('t').value.trim()");
    expect(h).not.toContain("#1A1A1A");
  });

  it("linkMessageHtml keeps the #u anchor + copy", () => {
    const h = linkMessageHtml("t", "b", "https://x/y");
    expect(h).toContain(FLAT_STYLE_MARKER);
    expect(h).toContain('id="u"');
    expect(h).toContain("https://x/y");
    expect(h).not.toContain("#1A1A1A");
  });

  it("messageHtml is flat + keeps body + close", () => {
    const h = messageHtml("pica — error", "something went wrong");
    expect(h).toContain(FLAT_STYLE_MARKER);
    expect(h).toContain('class="h"');
    expect(h).toContain("something went wrong");
    expect(h).not.toContain("#1A1A1A");
  });

  it("deliverConfirmHtml is flat + keeps confirmed/cancelled payloads", () => {
    const h = deliverConfirmHtml("a@b.com");
    expect(h).toContain(FLAT_STYLE_MARKER);
    expect(h).toContain('class="h"');
    expect(h).toContain("confirmed:true");
    expect(h).toContain("cancelled:true");
    expect(h).not.toContain("#1A1A1A");
  });
});

describe("stemsReportHtml", () => {
  const url = "https://withpica.com/inspect/recordings/r1";
  it("renders the 'stems logged' title and the body", () => {
    const html = stemsReportHtml("✓ drum loop\n✓ vocal loop", url);
    expect(html).toContain("pica — stems logged");
    expect(html).toContain("✓ drum loop");
  });
  it("renders the PICA link with a copy button", () => {
    const html = stemsReportHtml("x", url);
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain("navigator.clipboard");
  });
  it("offers a 'share with →' follow-on bridging 'share', plus close", () => {
    const html = stemsReportHtml("x", url);
    expect(html).toContain("share with →");
    expect(html).toContain("'share'");
    expect(html).toContain("close_and_send");
  });
});
