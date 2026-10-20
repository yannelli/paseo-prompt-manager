import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInlineMarkdown, parseMarkdown, previewLines, splitCode } from "../shared/markdown.ts";

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

test("inline preview marks template variables, whole, with their defaults", () => {
  assert.deepEqual(parseInlineMarkdown("Assign to {{ person | me }}, see {{ my_var_name }} and **{{x}}**"), [
    { kind: "text", text: "Assign to " },
    { kind: "variable", name: "person", fallback: "me" },
    { kind: "text", text: ", see " },
    { kind: "variable", name: "my_var_name" },
    { kind: "text", text: " and " },
    { kind: "bold", children: [{ kind: "variable", name: "x" }] },
  ]);
});

test("inline preview keeps GitHub Actions expressions, escaped braces and code spans as they are", () => {
  assert.deepEqual(parseInlineMarkdown("${{ github.sha }} \\{{ name }} `git checkout {{ branch }}`"), [
    { kind: "text", text: "${{ github.sha }} " },
    { kind: "text", text: "{" },
    { kind: "text", text: "{ name }} " },
    { kind: "code", text: "git checkout {{ branch }}" },
  ]);
});

test("an underscore inside a variable name never ends italics", () => {
  assert.deepEqual(parseInlineMarkdown("Use snake_case for {{ my_var }}"), [
    { kind: "text", text: "Use snake_case for " },
    { kind: "variable", name: "my_var" },
  ]);
  assert.deepEqual(parseInlineMarkdown("_see {{ my_var }}_"), [
    { kind: "italic", children: [{ kind: "text", text: "see " }, { kind: "variable", name: "my_var" }] },
  ]);
});

test("an escaped backslash before a variable leaves it a variable", () => {
  assert.deepEqual(parseInlineMarkdown("a \\\\{{ x }}"), [
    { kind: "text", text: "a " },
    { kind: "text", text: "\\" },
    { kind: "variable", name: "x" },
  ]);
});

test("code splits out as Preview reads it and joins back into the content", () => {
  const content = "A `b` \\`c` ``d e``\n\n```sh\nf\n```\ng `h\n\ni`";
  const parts = splitCode(content);
  assert.equal(parts.map((part) => part.text).join(""), content);
  assert.deepEqual(parts.filter((part) => part.code).map((part) => part.text), ["`b`", "``d e``", "```sh\nf\n```\n"]);
});
