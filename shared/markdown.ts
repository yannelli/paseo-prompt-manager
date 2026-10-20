export type MarkdownBlock =
  | { kind: "paragraph" | "quote" | "code"; text: string }
  | { kind: "heading"; text: string; level: number }
  | { kind: "list"; text: string; marker: string; depth: number }
  | { kind: "rule" };

export type MarkdownInline =
  | { kind: "text"; text: string }
  | { kind: "variable"; name: string; fallback?: string }
  | { kind: "code"; text: string }
  | { kind: "bold" | "italic" | "link"; children: MarkdownInline[] };

const fencePattern = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const headingPattern = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/;
const listPattern = /^(\s*)([-+*]|\d+[.)])\s+(.*)$/;
const rulePattern = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const quotePattern = /^ {0,3}>\s?(.*)$/;
// Both parsers require matching backtick runs and allow other runs inside a span.
// A run without a closing run is still matched whole, so no span starts inside it.
const codeSpanSource = String.raw`(?<codeFence>\`+)(?!\`)(?:((?:[^\`]|(?!\k<codeFence>(?!\`))\`+(?!\`))*?)\k<codeFence>(?!\`))?`;
const codeSpanPattern = new RegExp(String.raw`\\[\s\S]|` + codeSpanSource, "g");
// Letters, digits, `_` and `-`, with single spaces between words. Code such as `{{ .Values.x }}` does not match.
const variableName = String.raw`[A-Za-z_\u00C0-\uFFFF][\w\u00C0-\uFFFF-]*(?: [\w\u00C0-\uFFFF-]+)*`;
/** `{{ name }}` or `{{ name | default }}`, capturing the name and the default. */
export const variableSource = String.raw`\{\{\s*(${variableName})\s*(?:\|\s*([^{}\`\n]*?)\s*)?\}\}`;
// Variables are matched whole, and `_` ends italics only before a non-word character,
// so underscores in a name such as {{ my_var }} never start or end italics.
const inlinePattern = new RegExp(String.raw`\\([\\\`*_[\]{}()#+.!>~-])` + "|" + codeSpanSource + String.raw`|!\[([^\]]*)\]\([^\n)]*\)|\[([^\]]+)\]\([^\n)]*\)|\*\*(.+?)\*\*|__(.+?)__|\*([^*\n]+)\*|_((?:\{\{[^{}\n]*\}\}|[^_\n])+?)_(?!\w)|` + variableSource, "g");

function closingFence(fence: string) {
  return new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`);
}

function startsBlock(line: string) {
  return fencePattern.test(line) || headingPattern.test(line) || rulePattern.test(line) ||
    listPattern.test(line) || quotePattern.test(line);
}

export function parseMarkdown(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index++];
    if (!line.trim()) continue;
    const fence = line.match(fencePattern);
    if (fence) {
      const text: string[] = [];
      const closing = closingFence(fence[1]);
      while (index < lines.length && !closing.test(lines[index])) text.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push({ kind: "code", text: text.join("\n") });
      continue;
    }
    const heading = line.match(headingPattern);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }
    if (rulePattern.test(line)) {
      blocks.push({ kind: "rule" });
      continue;
    }
    const list = line.match(listPattern);
    if (list) {
      const task = list[3].match(/^\[([ xX])\]\s+(.*)$/);
      blocks.push({
        kind: "list", text: task?.[2] ?? list[3],
        marker: task ? (task[1] === " " ? "☐" : "☑") : /^\d/.test(list[2]) ? list[2] : "•",
        depth: Math.min(6, Math.floor(list[1].replace(/\t/g, "    ").length / 2)),
      });
      continue;
    }
    const quote = line.match(quotePattern);
    if (quote) {
      const text = [quote[1]];
      while (index < lines.length && quotePattern.test(lines[index])) {
        text.push(lines[index++].replace(quotePattern, "$1"));
      }
      blocks.push({ kind: "quote", text: text.join("\n") });
      continue;
    }
    const text = [line];
    while (index < lines.length && lines[index].trim() && !startsBlock(lines[index])) {
      text.push(lines[index++]);
    }
    blocks.push({ kind: "paragraph", text: text.join("\n") });
  }
  return blocks;
}

export function parseInlineMarkdown(text: string, depth = 0): MarkdownInline[] {
  if (depth > 8) return [{ kind: "text", text }];
  const tokens: MarkdownInline[] = [];
  let offset = 0;
  for (const match of text.matchAll(inlinePattern)) {
    if (match.index > offset) tokens.push({ kind: "text", text: text.slice(offset, match.index) });
    if (match[1] !== undefined) tokens.push({ kind: "text", text: match[1] });
    else if (match[2] !== undefined) tokens.push(match[3] === undefined ? { kind: "text", text: match[2] } : { kind: "code", text: match[3] });
    else if (match[4] !== undefined) tokens.push({ kind: "text", text: `[Image: ${match[4] || "image"}]` });
    else if (match[5] !== undefined) tokens.push({ kind: "link", children: parseInlineMarkdown(match[5], depth + 1) });
    else if (match[6] !== undefined || match[7] !== undefined) tokens.push({ kind: "bold", children: parseInlineMarkdown(match[6] ?? match[7], depth + 1) });
    else if (match[10] !== undefined) tokens.push(match[11] === undefined ? { kind: "variable", name: match[10] } : { kind: "variable", name: match[10], fallback: match[11] });
    else tokens.push({ kind: "italic", children: parseInlineMarkdown(match[8] ?? match[9], depth + 1) });
    offset = match.index + match[0].length;
  }
  if (offset < text.length) tokens.push({ kind: "text", text: text.slice(offset) });
  return tokens;
}

export type CodeSplit = { text: string; code: boolean };

/** Splits raw content into code blocks and code spans, which Preview shows as written, and the text around them. */
export function splitCode(content: string): CodeSplit[] {
  const parts: CodeSplit[] = [];
  const add = (text: string, code: boolean) => { if (text) parts.push({ text, code }); };
  const addText = (text: string) => {
    let offset = 0;
    for (const match of text.matchAll(codeSpanPattern)) {
      if (match[2] === undefined) continue;
      add(text.slice(offset, match.index), false);
      add(match[0], true);
      offset = match.index + match[0].length;
    }
    add(text.slice(offset), false);
  };
  // Each line keeps its line ending, so the parts join back into the content.
  const lines = content.match(/[^\r\n]*(?:\r\n?|\n|$)/g) ?? [];
  const bare = (line: string) => line.replace(/\r?\n?$/, "");
  let index = 0;
  while (index < lines.length) {
    const line = bare(lines[index]);
    const fence = line.match(fencePattern);
    if (fence) {
      const closing = closingFence(fence[1]);
      let code = lines[index++];
      while (index < lines.length && !closing.test(bare(lines[index]))) code += lines[index++];
      if (index < lines.length) code += lines[index++];
      add(code, true);
      continue;
    }
    let text = lines[index++];
    if (!line.trim()) {
      add(text, false);
      continue;
    }
    if (quotePattern.test(line)) {
      while (index < lines.length && quotePattern.test(bare(lines[index]))) text += lines[index++];
    } else if (!startsBlock(line)) {
      while (index < lines.length && bare(lines[index]).trim() && !startsBlock(bare(lines[index]))) text += lines[index++];
    }
    addText(text);
  }
  return parts;
}

export function previewLines(content: string, limit = 4) {
  const blocks = parseMarkdown(content);
  const heading = blocks.findIndex((block) => block.kind === "heading");
  return blocks.filter((_, index) => index !== heading)
    .flatMap((block) => "text" in block ? block.text.split("\n") : [])
    .map((line) => line.trim()).filter(Boolean).slice(0, limit);
}
