import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, opendir, readdir, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ImportResult, LibrarySettings, Prompt, Version } from "../shared/prompts.ts";

const MAX_BYTES = 512_000;
const IMPORT_MAX_BYTES = 8_000_000;
const IMPORT_MAX_FILES = 100;
const IMPORT_MAX_ENTRIES = 5_000;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const configHome = () => process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const digest = (content: string) => createHash("sha256").update(content).digest("hex");
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

function validId(id: string) {
  if (!ID.test(id) || id.length > 120) throw new Error("Invalid prompt filename.");
  return id;
}

function normalize(name: string) {
  return validId(name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120).replace(/-$/g, ""));
}

function directoryPath(value: string) {
  const expanded = value === "~" ? homedir() : value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
  if (!isAbsolute(expanded)) throw new Error("Choose an absolute directory path.");
  return resolve(expanded);
}

async function regularFile(path: string) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Prompt files must be regular files.");
    return info;
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

async function directory(path: string, create = true) {
  if (create) await mkdir(path, { recursive: true });
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Library directories must not be symbolic links.");
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

async function readFile(path: string) {
  await regularFile(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error("Prompt exceeds the 512 KB file limit.");
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_BYTES) throw new Error("Prompt exceeds the 512 KB file limit.");
    return { content: buffer.subarray(0, length).toString("utf8"), updatedAt: info.mtime.toISOString() };
  } finally {
    await handle.close();
  }
}

function validateContent(content: string) {
  if (!content.trim()) throw new Error("Enter prompt content.");
  if (Buffer.byteLength(content, "utf8") > MAX_BYTES) throw new Error("Prompt exceeds the 512 KB file limit.");
}

async function atomicWrite(path: string, content: string, exclusive = false) {
  await regularFile(path);
  const temporary = join(dirname(path), `.prompt-${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await regularFile(path);
    if (exclusive) await link(temporary, path);
    else await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: unknown) => { if (!missing(error)) throw error; });
  }
}

export class PromptLibrary {
  private readonly configPath: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(configPath = join(configHome(), "paseo", "prompt-manager.json")) {
    this.configPath = configPath;
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async loadSettings(): Promise<LibrarySettings> {
    try {
      const value: unknown = JSON.parse((await readFile(this.configPath)).content);
      if (!value || typeof value !== "object" || !("directory" in value) || typeof value.directory !== "string"
        || !("gitEnabled" in value) || typeof value.gitEnabled !== "boolean") throw new Error("Invalid prompt library settings.");
      return { directory: directoryPath(value.directory), gitEnabled: value.gitEnabled };
    } catch (error) {
      if (!missing(error)) throw error;
      return { directory: join(configHome(), "paseo", "prompt-lib"), gitEnabled: false };
    }
  }

  settings() { return this.serialize(() => this.loadSettings()); }

  configure(settings: LibrarySettings) {
    return this.serialize(async () => {
      const value = { directory: directoryPath(settings.directory), gitEnabled: settings.gitEnabled };
      await directory(value.directory);
      await mkdir(dirname(this.configPath), { recursive: true });
      await atomicWrite(this.configPath, `${JSON.stringify(value, null, 2)}\n`);
      return value;
    });
  }

  withRoot<T>(operation: (root: string, settings: LibrarySettings) => Promise<T>): Promise<T> {
    return this.serialize(async () => {
      const settings = await this.loadSettings();
      await directory(settings.directory);
      return operation(settings.directory, settings);
    });
  }

  private async historyDirectory(root: string, id: string, create = false) {
    validId(id);
    const base = join(root, "versions");
    if (!await directory(base, create)) return null;
    const path = join(base, id);
    return await directory(path, create) ? path : null;
  }

  private parseVersion(id: string, filename: string): Version {
    validId(id);
    const prefix = `${id}.`;
    if (!filename.startsWith(prefix)) throw new Error("Invalid version filename.");
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)_v([1-9]\d*)\.md$/.exec(filename.slice(prefix.length));
    if (!match) throw new Error("Invalid version filename.");
    const timestamp = match[1]!;
    const createdAt = `${timestamp.slice(0, 13)}:${timestamp.slice(14, 16)}:${timestamp.slice(17, 19)}.${timestamp.slice(20)}`;
    const version = Number(match[2]);
    if (!Number.isSafeInteger(version) || (!Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt)) throw new Error("Invalid version filename.");
    return { filename, version, createdAt };
  }

  private async history(root: string, id: string): Promise<Version[]> {
    const path = await this.historyDirectory(root, id);
    if (!path) return [];
    const entries = await readdir(path);
    const versions: Version[] = [];
    for (const filename of entries) {
      if (!filename.endsWith(".md")) continue;
      const version = this.parseVersion(id, filename);
      await regularFile(join(path, filename));
      versions.push(version);
    }
    return versions.sort((a, b) => b.version - a.version || b.filename.localeCompare(a.filename));
  }

  private async historicalContent(root: string, id: string, filename: string) {
    this.parseVersion(id, filename);
    const path = await this.historyDirectory(root, id);
    if (!path) throw new Error("Prompt version not found.");
    return (await readFile(join(path, filename))).content;
  }

  private async current(root: string, id: string): Promise<Prompt | null> {
    validId(id);
    const file = join(root, `${id}.md`);
    if (await regularFile(file)) {
      const { content, updatedAt } = await readFile(file);
      return { id, title: this.title(id, content), content, revision: digest(content), updatedAt, archived: false };
    }
    const latest = (await this.history(root, id))[0];
    if (!latest) return null;
    const content = await this.historicalContent(root, id, latest.filename);
    return { id, title: this.title(id, content), content, revision: digest(`archived\0${latest.filename}\0${content}`), updatedAt: latest.createdAt, archived: true };
  }

  private title(id: string, content: string) {
    return /^#{1,6}\s+(.+?)\s*#*\s*$/m.exec(content)?.[1]?.trim() || id;
  }

  private checkRevision(current: Prompt | null, revision: string | null) {
    if ((current?.revision ?? null) !== revision) throw new Error("This prompt changed. Reload it before saving.");
  }

  private async snapshot(root: string, id: string, content: string) {
    const existing = await this.history(root, id);
    const version = (existing[0]?.version ?? 0) + 1;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${id}.${timestamp}_v${version}.md`;
    const path = await this.historyDirectory(root, id, true);
    await atomicWrite(join(path!, filename), content, true);
  }

  private async preserve(root: string, current: Prompt) {
    const latest = (await this.history(root, current.id))[0];
    if (!latest || await this.historicalContent(root, current.id, latest.filename) !== current.content) {
      await this.snapshot(root, current.id, current.content);
    }
  }

  private async matching(root: string, query: string, archived: boolean) {
    const ids = new Set((await readdir(root)).filter((name) => name.endsWith(".md") && ID.test(name.slice(0, -3)) && name.length <= 123).map((name) => name.slice(0, -3)));
    if (archived && await directory(join(root, "versions"), false)) {
      for (const id of await readdir(join(root, "versions"))) if (ID.test(id) && id.length <= 120) ids.add(id);
    }
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const result: Prompt[] = [];
    for (const id of ids) {
      const prompt = await this.current(root, id);
      if (!prompt || (!archived && prompt.archived)) continue;
      const text = `${prompt.title}\n${id}.md\n${prompt.content}`.toLowerCase();
      if (terms.every((term) => text.includes(term))) result.push(prompt);
    }
    return result.sort((a, b) => a.title.localeCompare(b.title));
  }

  list({ query = "", archived = false }: { query?: string; archived?: boolean } = {}) {
    return this.withRoot(async (root) => (await this.matching(root, query, archived)).map(({ content: _content, ...summary }) => summary));
  }

  search(query: string) {
    return this.withRoot(async (root) => {
      const normalized = query.trim().toLowerCase();
      const terms = normalized.split(/\s+/).filter(Boolean);
      const rank = (prompt: Prompt) => {
        if (prompt.id === normalized || `${prompt.id}.md` === normalized || prompt.title.toLowerCase() === normalized) return 0;
        return terms.every((term) => `${prompt.title}\n${prompt.id}.md`.toLowerCase().includes(term)) ? 1 : 2;
      };
      const prompts = (await this.matching(root, query, false)).sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
      return { items: prompts.slice(0, 50).map((prompt) => ({
        id: prompt.id, identifier: prompt.id, url: pathToFileURL(join(root, `${prompt.id}.md`)).href,
        title: prompt.title, subtitle: `${prompt.id}.md`, text: prompt.content, resourceType: "prompt",
      })) };
    });
  }

  import(input: { paths: string[]; files: { name: string; content: string }[] }): Promise<ImportResult> {
    return this.withRoot(async (root) => {
      const result: ImportResult = { imported: [], skipped: [] };
      let candidates = 0;
      let entries = 0;
      let bytes = 0;
      const skip = (source: string, reason: string) => { result.skipped.push({ source, reason }); };
      const errorReason = (error: unknown) => error instanceof Error ? error.message : "Import failed.";
      const excluded = (name: string) => name.startsWith(".") || name.toLowerCase() === "versions";
      const basename = (name: string) => name.split(/[\\/]/).at(-1) ?? "";
      const importFile = async (source: string, name: string, read: () => Promise<string>) => {
        if (!/\.md$/i.test(name)) { skip(source, "Only Markdown (.md) files can be imported."); return; }
        if (candidates >= IMPORT_MAX_FILES) { skip(source, "Import limit reached: 100 files per import."); return; }
        candidates++;
        try {
          const id = normalize(name.slice(0, -3));
          if (await this.current(root, id)) throw new Error(`Prompt "${id}" already exists, including archived versions.`);
          const content = await read();
          validateContent(content);
          const size = Buffer.byteLength(content, "utf8");
          if (bytes + size > IMPORT_MAX_BYTES) throw new Error("Import limit reached: 8 MB per import.");
          bytes += size;
          const destination = join(root, `${id}.md`);
          await atomicWrite(destination, content, true);
          try {
            await this.snapshot(root, id, content);
          } catch (error) {
            await unlink(destination);
            throw error;
          }
          result.imported.push(id);
        } catch (error) { skip(source, errorReason(error)); }
      };
      const walk = async (path: string): Promise<void> => {
        if (entries >= IMPORT_MAX_ENTRIES) { skip(path, "Import limit reached: 5,000 directory entries."); return; }
        if (candidates >= IMPORT_MAX_FILES) { skip(path, "Import limit reached: 100 files per import."); return; }
        entries++;
        try {
          if (excluded(basename(path))) { skip(path, "Hidden files and version history are excluded."); return; }
          const info = await lstat(path);
          if (info.isSymbolicLink()) { skip(path, "Symbolic links are excluded."); return; }
          if (info.isDirectory()) {
            const handle = await opendir(path);
            for await (const entry of handle) {
              if (entries >= IMPORT_MAX_ENTRIES || candidates >= IMPORT_MAX_FILES) {
                skip(path, entries >= IMPORT_MAX_ENTRIES ? "Import limit reached: 5,000 directory entries." : "Import limit reached: 100 files per import.");
                break;
              }
              await walk(join(path, entry.name));
            }
          } else if (info.isFile()) {
            await importFile(path, basename(path), async () => (await readFile(path)).content);
          } else { skip(path, "Only regular Markdown files and folders can be imported."); }
        } catch (error) { skip(path, errorReason(error)); }
      };
      for (const source of input.paths) {
        try { await walk(directoryPath(source.trim())); }
        catch (error) { skip(source, errorReason(error)); }
      }
      for (const file of input.files) {
        if (file.name.split(/[\\/]/).some(excluded)) { skip(file.name, "Hidden files and version history are excluded."); continue; }
        await importFile(file.name, basename(file.name), async () => file.content);
      }
      return result;
    });
  }

  read(id: string) {
    return this.withRoot(async (root) => {
      const prompt = await this.current(root, id);
      if (!prompt) throw new Error("Prompt not found.");
      return prompt;
    });
  }

  save(input: { id?: string; name: string; content: string; revision: string | null }) {
    return this.withRoot(async (root) => {
      validateContent(input.content);
      const id = input.id ? validId(input.id) : normalize(input.name);
      const current = await this.current(root, id);
      this.checkRevision(current, input.revision);
      if (current?.archived) throw new Error("Restore this archived prompt before editing it.");
      if (current) await this.preserve(root, current);
      await this.snapshot(root, id, input.content);
      await atomicWrite(join(root, `${id}.md`), input.content);
      return (await this.current(root, id))!;
    });
  }

  archive(input: { id: string; revision: string }) {
    return this.withRoot(async (root) => {
      const current = await this.current(root, input.id);
      this.checkRevision(current, input.revision);
      if (!current || current.archived) throw new Error("Active prompt not found.");
      await this.preserve(root, current);
      await regularFile(join(root, `${input.id}.md`));
      await unlink(join(root, `${input.id}.md`));
      return {};
    });
  }

  versions(id: string) { return this.withRoot((root) => this.history(root, id)); }

  version(input: { id: string; filename: string }) {
    return this.withRoot(async (root) => ({ content: await this.historicalContent(root, input.id, input.filename) }));
  }

  restore(input: { id: string; filename: string; revision: string | null }) {
    return this.withRoot(async (root) => {
      const current = await this.current(root, input.id);
      this.checkRevision(current, input.revision);
      const content = await this.historicalContent(root, input.id, input.filename);
      if (current && !current.archived) await this.preserve(root, current);
      await this.snapshot(root, input.id, content);
      await atomicWrite(join(root, `${input.id}.md`), content);
      return (await this.current(root, input.id))!;
    });
  }
}
