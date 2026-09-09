import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PromptLibrary } from "./library.ts";

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const base = await mkdtemp(join(tmpdir(), "paseo-prompts-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, "library");
  const library = new PromptLibrary(join(base, "settings.json"));
  await library.configure({ directory: root, gitEnabled: false });
  return { base, root, library };
}

const create = (library: PromptLibrary, content = "# Code review\nRead the changes.") => library.save({ name: "Code Review", content, revision: null });

test("saves markdown unchanged with normalized stable ids and numbered snapshots", async (t) => {
  const { library, root } = await fixture(t);
  const first = await create(library);
  assert.equal(first.id, "code-review");
  assert.equal(first.title, "Code review");
  assert.equal(await readFile(join(root, "code-review.md"), "utf8"), first.content);
  const second = await library.save({ id: first.id, name: "A different name", content: "# New title\nNew instructions.", revision: first.revision });
  assert.equal(second.id, first.id);
  assert.equal(second.title, "New title");
  const versions = await library.versions(first.id);
  assert.deepEqual(versions.map((version) => version.version), [2, 1]);
  assert.match(versions[1]!.filename, /^code-review\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_v1\.md$/);
  assert.deepEqual(await library.version({ id: first.id, filename: versions[1]!.filename }), { content: first.content });
  assert.deepEqual((await readdir(root)).sort(), ["code-review.md", "versions"]);
});

test("restores an earlier version and preserves history through archive", async (t) => {
  const { library, root } = await fixture(t);
  const first = await create(library);
  const second = await library.save({ id: first.id, name: "ignored", content: "Second version", revision: first.revision });
  const earliest = (await library.versions(first.id))[1]!;
  const restored = await library.restore({ id: first.id, filename: earliest.filename, revision: second.revision });
  assert.equal(restored.content, first.content);
  assert.equal((await library.versions(first.id)).length, 3);
  await library.archive({ id: first.id, revision: restored.revision });
  await assert.rejects(readFile(join(root, `${first.id}.md`)), { code: "ENOENT" });
  assert.deepEqual(await library.list(), []);
  const archived = await library.read(first.id);
  assert.equal(archived.archived, true);
  assert.notEqual(archived.revision, restored.revision);
  assert.equal((await library.list({ archived: true }))[0]!.archived, true);
  const active = await library.restore({ id: first.id, filename: earliest.filename, revision: archived.revision });
  assert.equal(active.archived, false);
  assert.equal(active.content, first.content);
  assert.equal((await library.versions(first.id))[0]!.version, 4);
});

test("imports external markdown and preserves external revisions before edit and archive", async (t) => {
  const { library, root } = await fixture(t);
  const file = join(root, "imported.md");
  await writeFile(file, "Original external content");
  const imported = await library.read("imported");
  assert.equal(imported.title, "imported");
  await library.save({ id: imported.id, name: "ignored", content: "Edited in plugin", revision: imported.revision });
  let versions = await library.versions(imported.id);
  assert.equal(versions.length, 2);
  assert.equal((await library.version({ id: imported.id, filename: versions[1]!.filename })).content, imported.content);
  await writeFile(file, "External edit after saving");
  const external = await library.read(imported.id);
  await library.archive({ id: imported.id, revision: external.revision });
  versions = await library.versions(imported.id);
  assert.equal(versions.length, 3);
  assert.equal((await library.read(imported.id)).content, external.content);
});

test("rejects stale writes, duplicate creation, stale archive and restore", async (t) => {
  const { library, root } = await fixture(t);
  const first = await create(library);
  await assert.rejects(create(library), /changed/);
  const version = (await library.versions(first.id))[0]!;
  await writeFile(join(root, `${first.id}.md`), "External change");
  await assert.rejects(library.save({ id: first.id, name: "ignored", content: "Stale change", revision: first.revision }), /changed/);
  await assert.rejects(library.archive({ id: first.id, revision: first.revision }), /changed/);
  await assert.rejects(library.restore({ id: first.id, filename: version.filename, revision: first.revision }), /changed/);
  assert.equal((await library.versions(first.id)).length, 1);
  assert.equal((await library.read(first.id)).content, "External change");
});

test("serializes saves and Git callbacks without losing competing edits", async (t) => {
  const { library } = await fixture(t);
  const first = await create(library);
  const events: string[] = [];
  const operation = library.withRoot(async () => {
    events.push("start");
    await new Promise((done) => setTimeout(done, 20));
    events.push("end");
  });
  const results = await Promise.allSettled([
    library.save({ id: first.id, name: "ignored", content: "One", revision: first.revision }).then((result) => { events.push("save"); return result; }),
    library.save({ id: first.id, name: "ignored", content: "Two", revision: first.revision }),
  ]);
  await operation;
  assert.deepEqual(events, ["start", "end", "save"]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await library.versions(first.id)).length, 2);
});

test("searches content, includes archived on request, and reloads chosen settings", async (t) => {
  const { library, base, root } = await fixture(t);
  const first = await create(library);
  await library.save({ name: "Another", content: "# Another\nDifferent instructions", revision: null });
  assert.equal((await library.list({ query: "read THE changes" }))[0]!.id, first.id);
  await library.archive({ id: first.id, revision: first.revision });
  assert.equal((await library.list()).length, 1);
  assert.equal((await library.list({ archived: true })).length, 2);
  const reopened = new PromptLibrary(join(base, "settings.json"));
  assert.deepEqual(await reopened.settings(), { directory: root, gitEnabled: false });
  const other = join(base, "other");
  await library.configure({ directory: other, gitEnabled: true });
  assert.equal((await reopened.settings()).directory, other);
  assert.deepEqual(await library.list(), []);
  await assert.rejects(library.configure({ directory: "relative", gitEnabled: false }), /absolute/);
});

test("rejects traversal, invalid versions, oversized files and symbolic links", async (t) => {
  const { library, base, root } = await fixture(t);
  await assert.rejects(library.read("../secret"), /Invalid prompt/);
  await assert.rejects(library.save({ id: "../secret", name: "Secret", content: "text", revision: null }), /Invalid prompt/);
  await assert.rejects(library.version({ id: "prompt", filename: "../../secret.md" }), /Invalid version/);
  await assert.rejects(library.save({ name: "Large", content: "😀".repeat(128_001), revision: null }), /512 KB/);
  await writeFile(join(root, "large.md"), "x".repeat(512_001));
  await assert.rejects(library.read("large"), /512 KB/);
  const outside = join(base, "outside.md");
  await writeFile(outside, "Outside content");
  await symlink(outside, join(root, "linked.md"));
  await assert.rejects(library.read("linked"), /regular files/);
  await assert.rejects(library.save({ name: "Linked", content: "overwrite", revision: null }), /regular files/);
  await symlink(base, join(root, "versions"));
  await assert.rejects(library.versions("prompt"), /symbolic links/);
  assert.equal(await readFile(outside, "utf8"), "Outside content");
});

test("rejects symbolic version directories and version files", async (t) => {
  const { library, base, root } = await fixture(t);
  const first = await create(library);
  const latest = (await library.versions(first.id))[0]!;
  const versionPath = join(root, "versions", first.id, latest.filename);
  await rm(versionPath);
  await symlink(join(root, `${first.id}.md`), versionPath);
  await assert.rejects(library.version({ id: first.id, filename: latest.filename }), /regular files/);
  await assert.rejects(library.versions(first.id), /regular files/);
  await mkdir(join(base, "elsewhere"));
  await symlink(join(base, "elsewhere"), join(root, "versions", "other"));
  await assert.rejects(library.versions("other"), /symbolic links/);
});

test("imports Markdown files and recursive folders unchanged with initial snapshots", async (t) => {
  const { library, base, root } = await fixture(t);
  const source = join(base, "source");
  await mkdir(join(source, "nested"), { recursive: true });
  await writeFile(join(source, "Code Review.MD"), "# Review\r\nKeep exact spacing.  \r\n");
  await writeFile(join(source, "nested", "Sécurité.md"), "# Security\nInspect permissions.");
  const standalone = join(base, "standalone.md");
  await writeFile(standalone, "Standalone content");
  const result = await library.import({ paths: [source, standalone], files: [] });
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.imported.sort(), ["code-review", "securite", "standalone"]);
  assert.equal(await readFile(join(root, "code-review.md"), "utf8"), await readFile(join(source, "Code Review.MD"), "utf8"));
  for (const id of result.imported) {
    const versions = await library.versions(id);
    assert.deepEqual(versions.map((version) => version.version), [1]);
    assert.equal((await library.version({ id, filename: versions[0]!.filename })).content, (await library.read(id)).content);
  }
  assert.equal(await readFile(standalone, "utf8"), "Standalone content");
});

test("imports uploaded names portably and skips collisions including archived prompts", async (t) => {
  const { library } = await fixture(t);
  const archived = await create(library);
  await library.archive({ id: archived.id, revision: archived.revision });
  const result = await library.import({ paths: [], files: [
    { name: "folder/Good Prompt.MD", content: "# Good\nFirst content" },
    { name: "windows\\Another.md", content: "Second content" },
    { name: "Good-Prompt.md", content: "Collision" },
    { name: "Code Review.md", content: "Archived collision" },
  ] });
  assert.deepEqual(result.imported, ["good-prompt", "another"]);
  assert.equal(result.skipped.length, 2);
  assert.ok(result.skipped.every((entry) => /already exists/.test(entry.reason)));
  assert.equal((await library.read("good-prompt")).content, "# Good\nFirst content");
  assert.equal((await library.read(archived.id)).archived, true);
  assert.deepEqual((await library.versions(archived.id)).map((version) => version.version), [1]);
});

test("skips hidden files, history, symbolic files and folders during import", async (t) => {
  const { library, base } = await fixture(t);
  const source = join(base, "source");
  for (const dir of [source, join(source, ".hidden"), join(source, "versions")]) await mkdir(dir);
  await writeFile(join(source, "allowed.md"), "Allowed");
  await writeFile(join(source, ".private.md"), "Private");
  await writeFile(join(source, ".hidden", "secret.md"), "Secret");
  await writeFile(join(source, "versions", "backup.md"), "Backup");
  await symlink(join(source, "allowed.md"), join(source, "link.md"));
  await symlink(source, join(source, "linked-folder"));
  const result = await library.import({ paths: [source], files: [
    { name: "folder/.hidden/upload.md", content: "Hidden upload" },
    { name: "folder/versions/backup.md", content: "History upload" },
    { name: "../outside.md", content: "Traversal upload" },
  ] });
  assert.deepEqual(result.imported, ["allowed"]);
  assert.equal(result.skipped.length, 8);
  assert.equal(result.skipped.filter((entry) => /Symbolic/.test(entry.reason)).length, 2);
});

test("reports invalid imports individually and retains successful imports", async (t) => {
  const { library, base, root } = await fixture(t);
  await writeFile(join(base, "large.md"), "x".repeat(512_001));
  const result = await library.import({ paths: ["relative.md", join(base, "missing.md"), join(base, "large.md")], files: [
    { name: "readme.txt", content: "Unsupported" },
    { name: "empty.md", content: " \n" },
    { name: "😀.md", content: "Invalid filename" },
    { name: "unicode.md", content: "😀".repeat(128_001) },
    { name: "valid.md", content: "Valid import" },
  ] });
  assert.deepEqual(result.imported, ["valid"]);
  assert.equal(result.skipped.length, 7);
  assert.ok(result.skipped.some((entry) => /absolute/.test(entry.reason)));
  assert.ok(result.skipped.some((entry) => /ENOENT/.test(entry.reason)));
  assert.equal(result.skipped.filter((entry) => /512 KB/.test(entry.reason)).length, 2);
  assert.deepEqual((await readdir(root)).sort(), ["valid.md", "versions"]);
});

test("bounds import file counts and cumulative content bytes", async (t) => {
  const { library } = await fixture(t);
  const count = await library.import({ paths: [], files: Array.from({ length: 101 }, (_, index) => ({ name: `file-${index}.md`, content: "Content" })) });
  assert.equal(count.imported.length, 100);
  assert.match(count.skipped[0]!.reason, /100 files/);
  const size = await library.import({ paths: [], files: Array.from({ length: 17 }, (_, index) => ({ name: `large-${index}.md`, content: "x".repeat(500_000) })) });
  assert.equal(size.imported.length, 16);
  assert.match(size.skipped[0]!.reason, /8 MB/);
});

test("searches trimmed multiword terms across titles, filenames and content with complete attachments", async (t) => {
  const { library, root } = await fixture(t);
  await library.import({ paths: [], files: [
    { name: "security-review.md", content: "# Security Review\nCheck permissions." },
    { name: "other.md", content: "# Another\nReview the code for security issues." },
    { name: "review.md", content: "# Review\nSearch term is security." },
    { name: "unrelated.md", content: "Unrelated" },
  ] });
  assert.deepEqual((await library.list({ query: "  REVIEW    security  " })).map((item) => item.id), ["other", "review", "security-review"]);
  const { items } = await library.search("  REVIEW   security ");
  assert.deepEqual(items.map((item) => item.id), ["security-review", "other", "review"]);
  assert.equal(items[0]!.text, "# Security Review\nCheck permissions.");
  assert.equal(items[0]!.subtitle, "security-review.md");
  assert.equal(items[0]!.url, new URL(`file://${root}/security-review.md`).href);
  assert.equal((await library.search("review")).items[0]!.id, "review");
  assert.equal((await library.search("security-review.md")).items[0]!.id, "security-review");
  assert.equal((await library.search("permissions")).items[0]!.id, "security-review");
  const prompt = await library.read("security-review");
  await library.archive({ id: prompt.id, revision: prompt.revision });
  assert.equal((await library.search("permissions")).items.length, 0);
  assert.equal((await library.search(" ")).items.length, 3);
});

test("limits attachment search to fifty results", async (t) => {
  const { library } = await fixture(t);
  await library.import({ paths: [], files: Array.from({ length: 51 }, (_, index) => ({ name: `prompt-${index}.md`, content: "Shared search term" })) });
  assert.equal((await library.search("search term")).items.length, 50);
});


test("unsupported files do not exhaust the Markdown import count", async (t) => {
  const { library } = await fixture(t);
  const result = await library.import({ paths: [], files: [
    ...Array.from({ length: 101 }, (_, index) => ({ name: `file-${index}.txt`, content: "Unsupported" })),
    { name: "accepted.md", content: "Accepted" },
  ] });
  assert.deepEqual(result.imported, ["accepted"]);
  assert.equal(result.skipped.length, 101);
});
