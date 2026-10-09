import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { recordingProvider, type TestDaemon } from "./daemon.ts";

const execute = promisify(execFile);

export interface StoredPrompt {
  content: string;
  description: string;
  tags: string[];
}

export interface LibrarySettingsFile {
  directory: string;
  gitEnabled: boolean;
  syncMode: string;
  syncInterval: number;
}

/** Same on-disk format as `server/library.ts`: optional `paseo:` JSON front matter, then Markdown. */
export function decodePrompt(raw: string): StoredPrompt {
  const header = /^---\npaseo: (\{[^\n]*\})\n---\n/.exec(raw);
  if (!header) return { content: raw, description: "", tags: [] };
  const meta = JSON.parse(header[1]) as { description?: string; tags?: string[] };
  return { content: raw.slice(header[0].length), description: meta.description ?? "", tags: meta.tags ?? [] };
}

function encodePrompt({ content, description = "", tags = [] }: { content: string; description?: string; tags?: string[] }) {
  return description || tags.length ? `---\npaseo: ${JSON.stringify({ description, tags })}\n---\n${content}` : content;
}

/** A prompt library directory owned by one test, plus readers that check what the plugin wrote. */
export class TestLibrary {
  readonly directory: string;
  readonly settingsPath: string;

  constructor(daemon: TestDaemon, name: string) {
    this.directory = join(daemon.root, "libraries", name);
    this.settingsPath = join(daemon.configHome, "paseo", "prompt-manager.json");
  }

  /** Points the plugin at this library. The plugin reads its settings file on every call. */
  async activate(settings: Partial<LibrarySettingsFile> = {}) {
    await rm(this.directory, { recursive: true, force: true });
    await mkdir(this.directory, { recursive: true });
    await mkdir(dirname(this.settingsPath), { recursive: true });
    const value: LibrarySettingsFile = { directory: this.directory, gitEnabled: false, syncMode: "manual", syncInterval: 15, ...settings };
    await writeFile(this.settingsPath, `${JSON.stringify(value, null, 2)}\n`);
  }

  async seed(id: string, prompt: { content: string; description?: string; tags?: string[] }) {
    const file = join(this.directory, `${id}.md`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, encodePrompt(prompt));
  }

  async read(id: string): Promise<StoredPrompt | null> {
    try {
      return decodePrompt(await readFile(join(this.directory, `${id}.md`), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  /** Prompt IDs under the library root, without history and archive folders. */
  async ids(): Promise<string[]> {
    const entries = await readdir(this.directory, { recursive: true, withFileTypes: true }).catch(() => []);
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => join(entry.parentPath, entry.name).slice(this.directory.length + 1, -3))
      .filter((id) => !id.split("/").some((segment) => segment === "versions" || segment.startsWith(".")))
      .sort();
  }

  /** Saved version contents of one prompt, oldest first. */
  async versions(id: string): Promise<StoredPrompt[]> {
    const folder = join(this.directory, "versions", id);
    const names = (await readdir(folder).catch(() => [] as string[])).filter((name) => /_v\d+\.md$/.test(name));
    const ordered = names.sort((a, b) => Number(/_v(\d+)\.md$/.exec(a)![1]) - Number(/_v(\d+)\.md$/.exec(b)![1]));
    return Promise.all(ordered.map(async (name) => decodePrompt(await readFile(join(folder, name), "utf8"))));
  }

  async settings(): Promise<LibrarySettingsFile> {
    return JSON.parse(await readFile(this.settingsPath, "utf8")) as LibrarySettingsFile;
  }

  async git(...args: string[]) {
    const { stdout } = await execute("git", args, { cwd: this.directory });
    return stdout.trim();
  }
}

export interface TestAgent {
  id: string;
  cwd: string;
}

/** Creates an agent on the recording provider in a fresh Git workspace and waits for its first turn. */
export async function createAgent(daemon: TestDaemon, name: string): Promise<TestAgent> {
  const cwd = join(daemon.root, "workspaces", name);
  await mkdir(cwd, { recursive: true });
  await execute("git", ["init", "-q"], { cwd });
  const output = await daemon.cli(["run", "Ready for a saved prompt.", "--background", "--provider", recordingProvider, "--title", name, "--cwd", cwd, "--json"]);
  const { agentId } = JSON.parse(output.slice(output.indexOf("{"))) as { agentId: string };
  await daemon.cli(["wait", agentId, "--timeout", "60"]);
  return { id: agentId, cwd };
}

/** ACP content blocks of every prompt the agent received, in order. */
export async function receivedPrompts(agent: TestAgent): Promise<{ type: string; text?: string }[][]> {
  const raw = await readFile(join(agent.cwd, ".received.jsonl"), "utf8").catch(() => "");
  return raw.split("\n").filter(Boolean).map((line) => (JSON.parse(line) as { prompt: { type: string; text?: string }[] }).prompt);
}

/** Text of every prompt the agent received, one entry per turn with its blocks joined. */
export async function receivedTexts(agent: TestAgent): Promise<string[]> {
  return (await receivedPrompts(agent)).map((blocks) => blocks.map((block) => block.text ?? "").join("\n\n"));
}
