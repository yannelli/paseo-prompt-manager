import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInlineMarkdown, parseMarkdown, previewLines } from "../shared/markdown.ts";

test("preview recognizes headings, lists, tasks, quotes and rules", () => {
  assert.deepEqual(parseMarkdown("# Review\r\n\r\nRead first.\r\n- [ ] Inspect\r\n  1. Test\r\n- [x] Save\r\n> Keep changes small\r\n> Explain failures\r\n\r\n---"), [
    { kind: "heading", level: 1, text: "Review" },
    { kind: "paragraph", text: "Read first." },
    { kind: "list", text: "Inspect", marker: "☐", depth: 0 },
    { kind: "list", text: "Test", marker: "1.", depth: 1 },
    { kind: "list", text: "Save", marker: "☑", depth: 0 },
    { kind: "quote", text: "Keep changes small\nExplain failures" },
    { kind: "rule" },
  ]);
});

test("fenced code preserves markdown and shorter inner fences literally", () => {
  assert.deepEqual(parseMarkdown("````md\n# **Literal**\n```\n<script>alert(1)</script>\n````\nAfter"), [
    { kind: "code", text: "# **Literal**\n```\n<script>alert(1)</script>" },
    { kind: "paragraph", text: "After" },
  ]);
  assert.deepEqual(parseMarkdown("~~~\nunfinished"), [{ kind: "code", text: "unfinished" }]);
});

test("inline preview formats emphasis, keeps code literal and leaves HTML as text", () => {
  assert.deepEqual(parseInlineMarkdown("**Bold** *italic* `**code**` <b>literal</b>"), [
    { kind: "bold", children: [{ kind: "text", text: "Bold" }] },
    { kind: "text", text: " " },
    { kind: "italic", children: [{ kind: "text", text: "italic" }] },
    { kind: "text", text: " " },
    { kind: "code", text: "**code**" },
    { kind: "text", text: " <b>literal</b>" },
  ]);
});

test("preview renders links as inert labels and images as text", () => {
  assert.deepEqual(parseInlineMarkdown("[Docs](https://example.com) ![Diagram](https://example.com/image.png)"), [
    { kind: "link", children: [{ kind: "text", text: "Docs" }] },
    { kind: "text", text: " " },
    { kind: "text", text: "[Image: Diagram]" },
  ]);
  assert.deepEqual(parseInlineMarkdown("[unsafe](javascript:evil)"), [{ kind: "link", children: [{ kind: "text", text: "unsafe" }] }]);
});

test("escaped punctuation remains literal", () => {
  assert.deepEqual(parseInlineMarkdown("\\*literal\\*"), [
    { kind: "text", text: "*" }, { kind: "text", text: "literal" }, { kind: "text", text: "*" },
  ]);
});

test("preview lines skip the title heading, blank lines and rules", () => {
  assert.deepEqual(previewLines("Intro\n\n# Review\n\n- Read\n- Test\n\n---\n\n```\nnpm test\n```\nDone"), ["Intro", "Read", "Test", "npm test"]);
  assert.deepEqual(previewLines("# Only a title"), []);
  assert.deepEqual(previewLines("# A\n## B\nC", 2), ["B", "C"]);
});
