import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, opendir, readdir, rename, rmdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, resolve } from "node:path";
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
  if (!id || id.length > 500 || id.split("/").some((segment) => !ID.test(segment) || segment.length > 120) || id.split("/").slice(0, -1).includes("versions")) throw new Error("Invalid prompt filename.");
  return id;
}

function normalize(name: string) {
  return validId(name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120).replace(/-$/g, ""));
}

function validFolder(path: string) {
  if (path === "") return path;
  validId(path);
  if (path.split("/").includes("versions")) throw new Error("Invalid prompt folder.");
  return path;
}

function normalizeFolder(path: string, prompt = false) {
  if (path === "") return "";
  const segments = path.replace(/\\/g, "/").split("/");
  if (segments.some((segment) => !segment || segment.startsWith("."))) throw new Error("Invalid prompt folder.");
  return (prompt ? validId : validFolder)(segments.map(normalize).join("/"));
}

const folderOf = (id: string) => id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "";
type Metadata = { description: string; tags: string[] };

function metadata(value: Metadata): Metadata {
  if (typeof value.description !== "string" || value.description.length > 2000 || !Array.isArray(value.tags)
    || value.tags.length > 30 || value.tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.trim().length > 40)) throw new Error("Invalid prompt metadata.");
  return { description: value.description, tags: [...new Set(value.tags.map((tag) => tag.trim()))] };
}

function decode(raw: string) {
  const header = /^---\npaseo: (\{[^\n]*\})\n---\n/.exec(raw);
  if (!header) return { content: raw, description: "", tags: [] as string[] };
  return { content: raw.slice(header[0].length), ...metadata(JSON.parse(header[1]!) as Metadata) };
}

function encode(content: string, value: Metadata) {
  const normalized = metadata(value);
  const raw = normalized.description || normalized.tags.length ? `---\npaseo: ${JSON.stringify(normalized)}\n---\n${content}` : content;
  validateContent(raw);
  return raw;
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
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const segment of absolute.slice(current.length).split("/").filter(Boolean)) {
    current = join(current, segment);
    try {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Library directories must not be symbolic links.");
    } catch (error) {
      if (!missing(error)) throw error;
      if (!create) return false;
      await mkdir(current);
    }
  }
  return true;
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
    const prefix = `${basename(id)}.`;
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
      if (await regularFile(join(path, filename))) versions.push(version);
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
    if (await directory(dirname(file), false) && await regularFile(file)) {
      const { content: raw, updatedAt } = await readFile(file);
      const value = decode(raw);
      return { id, folder: folderOf(id), title: this.title(id, value.content), ...value, revision: digest(raw), updatedAt, archived: false };
    }
    const latest = (await this.history(root, id))[0];
    if (!latest) return null;
    const raw = await this.historicalContent(root, id, latest.filename);
    const value = decode(raw);
    return { id, folder: folderOf(id), title: this.title(id, value.content), ...value, revision: digest(`archived\0${latest.filename}\0${raw}`), updatedAt: latest.createdAt, archived: true };
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
    const filename = `${basename(id)}.${timestamp}_v${version}.md`;
    const path = await this.historyDirectory(root, id, true);
    await atomicWrite(join(path!, filename), content, true);
    return join(path!, filename);
  }

  private async preserve(root: string, current: Prompt) {
    const raw = (await readFile(join(root, `${current.id}.md`))).content;
    const latest = (await this.history(root, current.id))[0];
    if (!latest || await this.historicalContent(root, current.id, latest.filename) !== raw) {
      await this.snapshot(root, current.id, raw);
    }
  }

  private async scan(root: string, history = false) {
    const ids = new Set<string>();
    const folders = new Set<string>([""]);
    const base = history ? join(root, "versions") : root;
    if (!await directory(base, false)) return { ids, folders };
    const walk = async (path: string, prefix: string): Promise<void> => {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          try { (history ? validId : validFolder)(relative); } catch { continue; }
          if (!history) folders.add(relative);
          await walk(join(path, entry.name), relative);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          if (history) {
            if (!prefix) continue;
            try { this.parseVersion(prefix, entry.name); ids.add(prefix); } catch { continue; }
          } else {
            const id = relative.slice(0, -3);
            try { validId(id); ids.add(id); } catch { continue; }
          }
        }
      }
    };
    await walk(base, "");
    return { ids, folders };
  }

  folders() {
    return this.withRoot(async (root) => [...(await this.scan(root)).folders].sort());
  }

  createFolder(path: string) {
    return this.withRoot(async (root) => {
      const normalized = normalizeFolder(path);
      await directory(join(root, normalized));
      return { path: normalized };
    });
  }

  private async matching(root: string, query: string, archived: boolean, folder?: string, tag?: string) {
    validFolder(folder ?? "");
    const { ids } = await this.scan(root);
    if (archived) for (const id of (await this.scan(root, true)).ids) ids.add(id);
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const result: Prompt[] = [];
    for (const id of ids) {
      const prompt = await this.current(root, id);
      if (!prompt || (!archived && prompt.archived) || (folder !== undefined && prompt.folder !== folder)
        || (tag !== undefined && !prompt.tags.includes(tag))) continue;
      const text = `${prompt.title}\n${id}.md\n${prompt.content}\n${prompt.description}\n${prompt.tags.join(" ")}\n${prompt.folder}`.toLowerCase();
      if (terms.every((term) => text.includes(term))) result.push(prompt);
    }
    return result.sort((a, b) => a.title.localeCompare(b.title));
  }

  list({ query = "", archived = false, folder, tag }: { query?: string; archived?: boolean; folder?: string; tag?: string } = {}) {
    return this.withRoot(async (root) => (await this.matching(root, query, archived, folder, tag)).map(({ content: _content, ...summary }) => summary));
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

  import(input: { paths: string[]; files: { name: string; content: string }[]; folder?: string }): Promise<ImportResult> {
    return this.withRoot(async (root) => {
      const result: ImportResult = { imported: [], skipped: [] };
      const destinationFolder = validFolder(input.folder ?? "");
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
          const relative = normalizeFolder(name.replace(/\\/g, "/").slice(0, -3), true);
          const id = validId(destinationFolder ? `${destinationFolder}/${relative}` : relative);
          if (await this.current(root, id)) throw new Error(`Prompt "${id}" already exists, including archived versions.`);
          const content = await read();
          validateContent(content);
          decode(content);
          const size = Buffer.byteLength(content, "utf8");
          if (bytes + size > IMPORT_MAX_BYTES) throw new Error("Import limit reached: 8 MB per import.");
          bytes += size;
          const destination = join(root, `${id}.md`);
          await directory(dirname(destination));
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
      const walk = async (path: string, relative: string): Promise<void> => {
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
              await walk(join(path, entry.name), `${relative}/${entry.name}`);
            }
          } else if (info.isFile()) {
            await importFile(path, relative, async () => (await readFile(path)).content);
          } else { skip(path, "Only regular Markdown files and folders can be imported."); }
        } catch (error) { skip(path, errorReason(error)); }
      };
      for (const source of input.paths) {
        try {
          const path = directoryPath(source.trim());
          await directory(dirname(path), false);
          await walk(path, basename(path));
        }
        catch (error) { skip(source, errorReason(error)); }
      }
      for (const file of input.files) {
        if (file.name.split(/[\\/]/).some(excluded)) { skip(file.name, "Hidden files and version history are excluded."); continue; }
        await importFile(file.name, file.name, async () => file.content);
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

  save(input: { id?: string; name: string; content: string; revision: string | null; folder?: string; description?: string; tags?: string[] }) {
    return this.withRoot(async (root) => {
      validateContent(input.content);
      const oldId = input.id ? validId(input.id) : undefined;
      const folder = input.folder === undefined ? (oldId ? folderOf(oldId) : "") : input.folder;
      validFolder(folder ?? "");
      const filename = oldId ? basename(oldId) : normalize(input.name);
      const id = validId(folder ? `${folder}/${filename}` : filename);
      const current = await this.current(root, oldId ?? id);
      this.checkRevision(current, input.revision);
      if (current?.archived) throw new Error("Restore this archived prompt before editing it.");
      const raw = encode(input.content, { description: input.description ?? current?.description ?? "", tags: input.tags ?? current?.tags ?? [] });
      const moving = Boolean(current && id !== current.id);
      if (moving && await this.current(root, id)) throw new Error(`Prompt "${id}" already exists, including archived versions.`);
      await directory(dirname(join(root, `${id}.md`)));
      if (current) await this.preserve(root, current);
      if (moving && current) return this.move(root, current, id, raw);
      const snapshot = await this.snapshot(root, id, raw);
      try { await atomicWrite(join(root, `${id}.md`), raw, !current); }
      catch (error) { await unlink(snapshot); throw error; }
      return (await this.current(root, id))!;
    });
  }

  private async move(root: string, current: Prompt, id: string, raw: string) {
    const oldFile = join(root, `${current.id}.md`);
    const newFile = join(root, `${id}.md`);
    const oldRaw = (await readFile(oldFile)).content;
    const oldDirectory = (await this.historyDirectory(root, current.id))!;
    const newDirectory = (await this.historyDirectory(root, id, true))!;
    const copies: { oldPath: string; newPath: string }[] = [];
    let snapshot: string | undefined;
    let created = false;
    let removed = false;
    try {
      for (const version of await this.history(root, current.id)) {
        const oldPath = join(oldDirectory, version.filename);
        const newPath = join(newDirectory, version.filename);
        await atomicWrite(newPath, (await readFile(oldPath)).content, true);
        copies.push({ oldPath, newPath });
      }
      snapshot = await this.snapshot(root, id, raw);
      await atomicWrite(newFile, raw, true);
      created = true;
      await unlink(oldFile);
      removed = true;
      for (const copy of copies) await unlink(copy.oldPath);
      await rmdir(oldDirectory).catch((error: unknown) => { if ((error as NodeJS.ErrnoException).code !== "ENOTEMPTY" && !missing(error)) throw error; });
    } catch (error) {
      if (removed) await atomicWrite(oldFile, oldRaw, true);
      await directory(oldDirectory);
      for (const copy of copies) {
        if (!await regularFile(copy.oldPath)) await atomicWrite(copy.oldPath, (await readFile(copy.newPath)).content, true);
        await unlink(copy.newPath);
      }
      if (created) await unlink(newFile);
      if (snapshot) await unlink(snapshot);
      await rmdir(newDirectory).catch(() => undefined);
      throw error;
    }
    return (await this.current(root, id))!;
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
    return this.withRoot(async (root) => decode(await this.historicalContent(root, input.id, input.filename)));
  }

  restore(input: { id: string; filename: string; revision: string | null }) {
    return this.withRoot(async (root) => {
      const current = await this.current(root, input.id);
      this.checkRevision(current, input.revision);
      const content = await this.historicalContent(root, input.id, input.filename);
      if (current && !current.archived) await this.preserve(root, current);
      await directory(dirname(join(root, `${input.id}.md`)));
      const snapshot = await this.snapshot(root, input.id, content);
      try { await atomicWrite(join(root, `${input.id}.md`), content, !current || current.archived); }
      catch (error) { await unlink(snapshot); throw error; }
      return (await this.current(root, input.id))!;
    });
  }
}
