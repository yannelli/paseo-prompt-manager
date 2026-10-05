export type MarkdownBlock =
  | { kind: "paragraph" | "quote" | "code"; text: string }
  | { kind: "heading"; text: string; level: number }
  | { kind: "list"; text: string; marker: string; depth: number }
  | { kind: "rule" };

export type MarkdownInline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold" | "italic" | "link"; children: MarkdownInline[] };

const fencePattern = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const headingPattern = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/;
const listPattern = /^(\s*)([-+*]|\d+[.)])\s+(.*)$/;
const rulePattern = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const quotePattern = /^ {0,3}>\s?(.*)$/;

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
      const closing = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
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
  const pattern = /\\([\\`*_[\]{}()#+.!>~-])|(`+)([^`]*?)\2(?!`)|!\[([^\]]*)\]\([^\n)]*\)|\[([^\]]+)\]\([^\n)]*\)|\*\*(.+?)\*\*|__(.+?)__|\*([^*\n]+)\*|_([^_\n]+)_/g;
  const tokens: MarkdownInline[] = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > offset) tokens.push({ kind: "text", text: text.slice(offset, match.index) });
    if (match[1] !== undefined) tokens.push({ kind: "text", text: match[1] });
    else if (match[2] !== undefined) tokens.push({ kind: "code", text: match[3] });
    else if (match[4] !== undefined) tokens.push({ kind: "text", text: `[Image: ${match[4] || "image"}]` });
    else if (match[5] !== undefined) tokens.push({ kind: "link", children: parseInlineMarkdown(match[5], depth + 1) });
    else if (match[6] !== undefined || match[7] !== undefined) tokens.push({ kind: "bold", children: parseInlineMarkdown(match[6] ?? match[7], depth + 1) });
    else tokens.push({ kind: "italic", children: parseInlineMarkdown(match[8] ?? match[9], depth + 1) });
    offset = match.index + match[0].length;
  }
  if (offset < text.length) tokens.push({ kind: "text", text: text.slice(offset) });
  return tokens;
}

export function previewLines(content: string, limit = 4) {
  const blocks = parseMarkdown(content);
  const heading = blocks.findIndex((block) => block.kind === "heading");
  return blocks.filter((_, index) => index !== heading)
    .flatMap((block) => "text" in block ? block.text.split("\n") : [])
    .map((line) => line.trim()).filter(Boolean).slice(0, limit);
}
