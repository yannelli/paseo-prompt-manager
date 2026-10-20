import assert from "node:assert/strict";
import { test } from "node:test";
import { describeVariable, fillTemplate, parseVariables } from "../shared/templates.ts";

test("variables are listed once each, in order of first use, with their defaults", () => {
  assert.deepEqual(parseVariables("Assign to {{ person | me }}, PM {{Product Manager}}, QA {{QA}}, cc {{ person }}."), [
    { name: "person", fallback: "me" },
    { name: "Product Manager" },
    { name: "QA" },
  ]);
  assert.deepEqual(parseVariables("# Plain\n\nNo variables here."), []);
});

test("defaults may be empty, contain pipes, or come from a later use of the name", () => {
  assert.deepEqual(parseVariables("{{ note | }}"), [{ name: "note", fallback: "" }]);
  assert.deepEqual(parseVariables("{{ cmd | a | b }}"), [{ name: "cmd", fallback: "a | b" }]);
  assert.deepEqual(parseVariables("{{ x }} {{ x | first }} {{ x | second }}"), [{ name: "x", fallback: "first" }]);
});

test("GitHub Actions expressions, escaped braces and malformed braces are not variables", () => {
  assert.deepEqual(parseVariables("run: echo ${{ github.sha }} \\{{ literal }} {{ }} {{ a\nb }} {{ open"), []);
});

test("only names made of letters, digits, _, - and spaces are variables, so template code is not", () => {
  assert.deepEqual(parseVariables("<View style={{ flex: 1, gap: 8 }} /> -f '{{.State.Status}}' {{ .Values.image | quote }} {{ \"a\" }}"), []);
  assert.deepEqual(parseVariables("{{ my-var }} {{ Step 2 }} {{ módulo }}"), [{ name: "my-var" }, { name: "Step 2" }, { name: "módulo" }]);
});

test("code spans and code blocks are left as written", () => {
  const content = "Use {{ x }}.\n\n```tsx\n<View style={{ y }} />\n```\n\nRun `echo {{ z | a }}` and `\\{{ w }}`.";
  assert.deepEqual(parseVariables(content), [{ name: "x" }]);
  assert.equal(fillTemplate(content, { x: "1" }), "Use 1.\n\n```tsx\n<View style={{ y }} />\n```\n\nRun `echo {{ z | a }}` and `\\{{ w }}`.");
  assert.equal(fillTemplate("```\nunclosed {{ x }}", {}), "```\nunclosed {{ x }}");
});

test("filling replaces every use and falls back to defaults", () => {
  const template = "Look at {{ module }}. Assign to {{ person | me }}. Then check {{module}} again.";
  assert.equal(fillTemplate(template, { module: "server/git.ts" }), "Look at server/git.ts. Assign to me. Then check server/git.ts again.");
  assert.equal(fillTemplate(template, { module: "a", person: "Sam" }), "Look at a. Assign to Sam. Then check a again.");
  assert.equal(fillTemplate("Note: {{ note | none }}.", { note: "" }), "Note: .");
});

test("filling keeps GitHub Actions expressions and unescapes escaped braces", () => {
  assert.equal(fillTemplate("${{ github.sha }} \\{{ name }} {{ name }}", { name: "x" }), "${{ github.sha }} {{ name }} x");
  assert.equal(fillTemplate("Use \\{{ name }} syntax", {}), "Use {{ name }} syntax");
});

test("a dollar sign or an escaped backslash before a variable leaves it a variable", () => {
  assert.equal(fillTemplate("Budget is ${{ amount }}.", { amount: "40" }), "Budget is $40.");
  assert.equal(fillTemplate("a \\\\{{ x }} b", { x: "1" }), "a \\\\1 b");
});

test("filling keeps line endings", () => {
  assert.equal(fillTemplate("A {{ x }}\r\n```\r\n{{ y }}\r\n```\r\n", { x: "1" }), "A 1\r\n```\r\n{{ y }}\r\n```\r\n");
});

test("filling without a value for a variable that has no default fails", () => {
  assert.throws(() => fillTemplate("Review {{ module }}", {}), /Enter a value for "module"/);
  assert.throws(() => fillTemplate("Review {{ toString }}", {}), /Enter a value for "toString"/);
});

test("content without variables is returned unchanged", () => {
  const content = "# Review\n\nUse {single} braces and `{{` alone.";
  assert.equal(fillTemplate(content, {}), content);
});

test("variables are described with their defaults", () => {
  assert.deepEqual([{ name: "a" }, { name: "b", fallback: "me" }, { name: "c", fallback: "" }].map(describeVariable), ["a", "b = me", "c = (empty)"]);
});
