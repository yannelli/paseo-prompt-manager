import { splitCode, variableSource } from "./markdown.ts";

export type TemplateVariable = { name: string; fallback?: string };

// An escaped backslash, which keeps the next braces a variable, or a variable whose braces a backslash may escape.
const variablePattern = new RegExp(String.raw`\\\\|(\\)?` + variableSource, "g");

/** Variables outside code, in order of first use, one per name. The first default given for a name wins. */
export function parseVariables(content: string): TemplateVariable[] {
  const variables = new Map<string, TemplateVariable>();
  for (const part of splitCode(content)) {
    if (part.code) continue;
    for (const [, escaped, name, fallback] of part.text.matchAll(variablePattern)) {
      if (escaped || name === undefined) continue;
      const known = variables.get(name);
      if (!known) variables.set(name, fallback === undefined ? { name } : { name, fallback });
      else if (known.fallback === undefined && fallback !== undefined) known.fallback = fallback;
    }
  }
  return [...variables.values()];
}

/** Replaces each variable with its value, or its default when no value is given. Code is left as written. */
export function fillTemplate(content: string, values: Record<string, string>): string {
  const given = new Map(Object.entries(values));
  const fallbacks = new Map(parseVariables(content).map((variable) => [variable.name, variable.fallback]));
  return splitCode(content).map((part) => part.code ? part.text : part.text.replace(variablePattern, (match, escaped: string | undefined, name: string | undefined) => {
    if (name === undefined) return match;
    if (escaped) return match.slice(1);
    const value = given.get(name) ?? fallbacks.get(name);
    if (value === undefined) throw new Error(`Enter a value for "${name}".`);
    return value;
  })).join("");
}

/** The name, with its default when it has one, as the editor and Preview show it. */
export function describeVariable(variable: TemplateVariable): string {
  return variable.fallback === undefined ? variable.name : `${variable.name} = ${variable.fallback || "(empty)"}`;
}
