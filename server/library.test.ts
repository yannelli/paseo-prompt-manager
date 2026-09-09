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
  assert.deepEqual(await library.version({ id: first.id, filename: versions[1]!.filename }), { content: first.content, description: "", tags: [] });
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
  assert.deepEqual(result.imported.sort(), ["source/code-review", "source/nested/securite", "standalone"]);
  assert.equal(await readFile(join(root, "source", "code-review.md"), "utf8"), await readFile(join(source, "Code Review.MD"), "utf8"));
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
    { name: "folder/Good-Prompt.md", content: "Collision" },
    { name: "Code Review.md", content: "Archived collision" },
  ] });
  assert.deepEqual(result.imported, ["folder/good-prompt", "windows/another"]);
  assert.equal(result.skipped.length, 2);
  assert.ok(result.skipped.every((entry) => /already exists/.test(entry.reason)));
  assert.equal((await library.read("folder/good-prompt")).content, "# Good\nFirst content");
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
  assert.deepEqual(result.imported, ["source/allowed"]);
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

test("stores metadata in Markdown, searches tags and descriptions, and restores metadata", async (t) => {
  const { library, root } = await fixture(t);
  const first = await library.save({ name: "Review", content: "# Review\nRead changes.", revision: null, description: "Security checklist", tags: ["security", "backend", "security"] });
  assert.deepEqual(first.tags, ["security", "backend"]);
  const raw = await readFile(join(root, "review.md"), "utf8");
  assert.equal(raw, '---\npaseo: {"description":"Security checklist","tags":["security","backend"]}\n---\n# Review\nRead changes.');
  const initialVersion = (await library.versions(first.id))[0]!;
  const second = await library.save({ id: first.id, name: "ignored", content: first.content, revision: first.revision, description: "Style checklist", tags: ["style"] });
  assert.notEqual(second.revision, first.revision);
  assert.deepEqual((await library.list({ query: "style checklist" })).map((item) => item.id), ["review"]);
  assert.deepEqual((await library.list({ tag: "style" })).map((item) => item.id), ["review"]);
  assert.deepEqual(await library.list({ tag: "security" }), []);
  const attachment = (await library.search("style checklist")).items[0]!;
  assert.equal(attachment.text, first.content);
  assert.deepEqual(await library.version({ id: first.id, filename: initialVersion.filename }), { content: first.content, description: first.description, tags: first.tags });
  const restored = await library.restore({ id: first.id, filename: initialVersion.filename, revision: second.revision });
  assert.equal(restored.description, first.description);
  assert.deepEqual(restored.tags, first.tags);
  const edited = await library.save({ id: first.id, name: "ignored", content: "Changed body", revision: restored.revision });
  assert.equal(edited.description, first.description);
  assert.deepEqual(edited.tags, first.tags);
  await writeFile(join(root, "review.md"), (await readFile(join(root, "review.md"), "utf8")).replace("Security checklist", "Externally edited"));
  await assert.rejects(library.save({ id: first.id, name: "ignored", content: "Stale", revision: edited.revision }), /changed/);
});

test("preserves arbitrary frontmatter and external managed headers through import and archive", async (t) => {
  const { library, root } = await fixture(t);
  const content = "---\ntitle: Original metadata\n---\n# Instructions\nDo the task.";
  const first = await library.save({ name: "Frontmatter", content, revision: null, tags: ["test"] });
  assert.equal(first.content, content);
  const cleared = await library.save({ id: first.id, name: "ignored", content, revision: first.revision, tags: [], description: "" });
  assert.equal(await readFile(join(root, "frontmatter.md"), "utf8"), content);
  assert.equal(cleared.content, content);
  const managed = '---\npaseo: {"description":"Imported description","tags":["import"]}\n---\nImported body';
  await library.import({ paths: [], files: [{ name: "Imported.md", content: managed }] });
  const imported = await library.read("imported");
  assert.equal(imported.content, "Imported body");
  assert.equal(imported.description, "Imported description");
  await library.archive({ id: imported.id, revision: imported.revision });
  assert.deepEqual((await library.read("imported")).tags, ["import"]);
  assert.equal((await library.versions("imported")).length, 1);
});

test("creates nested folders, filters exact folders and archives nested prompts", async (t) => {
  const { library, root } = await fixture(t);
  assert.deepEqual(await library.createFolder("Engineering/Code Review"), { path: "engineering/code-review" });
  assert.deepEqual(await library.folders(), ["", "engineering", "engineering/code-review"]);
  const first = await library.save({ name: "Review", folder: "engineering/code-review", content: "Review", revision: null });
  assert.equal(first.id, "engineering/code-review/review");
  assert.equal(first.folder, "engineering/code-review");
  assert.equal(await readFile(join(root, "engineering", "code-review", "review.md"), "utf8"), "Review");
  const version = (await library.versions(first.id))[0]!;
  assert.match(version.filename, /^review\./);
  assert.equal(await readFile(join(root, "versions", "engineering", "code-review", "review", version.filename), "utf8"), "Review");
  assert.deepEqual(await library.list({ folder: "engineering" }), []);
  assert.deepEqual((await library.list({ folder: "engineering/code-review" })).map((item) => item.id), [first.id]);
  assert.equal((await library.search("engineering code-review")).items[0]!.id, first.id);
  await library.archive({ id: first.id, revision: first.revision });
  assert.deepEqual(await library.list(), []);
  assert.equal((await library.list({ archived: true, folder: first.folder }))[0]!.id, first.id);
  const archived = await library.read(first.id);
  await rm(join(root, "engineering"), { recursive: true });
  const restored = await library.restore({ id: first.id, filename: version.filename, revision: archived.revision });
  assert.equal(restored.archived, false);
  assert.equal(restored.content, first.content);
});

test("moves prompts with snapshots while preserving unrelated nested histories", async (t) => {
  const { library, root } = await fixture(t);
  const first = await create(library);
  const nested = await library.save({ name: "Nested", folder: first.id, content: "Nested prompt", revision: null });
  const moved = await library.save({ id: first.id, name: "ignored", folder: "engineering/reviews", content: "Moved content", revision: first.revision, tags: ["review"] });
  assert.equal(moved.id, "engineering/reviews/code-review");
  assert.deepEqual((await library.versions(moved.id)).map((version) => version.version), [2, 1]);
  assert.deepEqual(await library.versions(first.id), []);
  await assert.rejects(library.read(first.id), /not found/);
  assert.equal((await library.read(nested.id)).content, nested.content);
  assert.equal((await library.versions(nested.id)).length, 1);
  await assert.rejects(readFile(join(root, "code-review.md")), { code: "ENOENT" });
  const edited = await library.save({ id: moved.id, name: "ignored", content: "Edited in place", revision: moved.revision });
  assert.equal(edited.folder, "engineering/reviews");
  assert.deepEqual(edited.tags, ["review"]);
  await assert.rejects(library.save({ id: moved.id, name: "ignored", folder: "", content: "Stale", revision: moved.revision }), /changed/);
});

test("rejects moves onto active and archived prompts", async (t) => {
  const { library, root } = await fixture(t);
  const first = await create(library);
  const destination = await library.save({ name: "Code Review", folder: "target", content: "Existing", revision: null });
  const attempt = () => library.save({ id: first.id, name: "ignored", folder: "target", content: "Move", revision: first.revision });
  await assert.rejects(attempt(), /already exists/);
  await library.archive({ id: destination.id, revision: destination.revision });
  await assert.rejects(attempt(), /already exists/);
  assert.equal((await library.read(first.id)).revision, first.revision);
  assert.equal((await library.versions(first.id)).length, 1);
});

test("imports folder structure below a chosen destination with independent basenames", async (t) => {
  const { library } = await fixture(t);
  const result = await library.import({ paths: [], folder: "imported", files: [
    { name: "Team/Review.md", content: "First" },
    { name: "Team/Nested/Review.md", content: "Second" },
    { name: "Elsewhere/Review.md", content: "Third" },
  ] });
  assert.deepEqual(result.imported, ["imported/team/review", "imported/team/nested/review", "imported/elsewhere/review"]);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(await library.folders(), ["", "imported", "imported/elsewhere", "imported/team", "imported/team/nested"]);
});

test("rejects nested traversal, reserved folders and linked ancestors", async (t) => {
  const { library, root, base } = await fixture(t);
  for (const id of ["folder/../secret", "folder/.hidden/secret", "folder/versions/secret", "folder//secret", `folder/${"x".repeat(121)}`]) {
    await assert.rejects(library.read(id), /Invalid prompt/);
  }
  for (const path of ["folder/../secret", "folder/.hidden", "folder/versions", "folder//secret"]) {
    await assert.rejects(library.createFolder(path), /Invalid prompt/);
  }
  await mkdir(join(root, "safe"));
  const outside = join(base, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "secret.md"), "Outside content");
  await symlink(outside, join(root, "safe", "linked"));
  await assert.rejects(library.read("safe/linked/secret"), /symbolic links/);
  await assert.rejects(library.createFolder("safe/linked/child"), /symbolic links/);
  await assert.rejects(library.save({ name: "Secret", folder: "safe/linked", content: "Overwrite", revision: null }), /symbolic links/);
  const result = await library.import({ paths: [], files: [{ name: "safe/linked/secret.md", content: "Overwrite" }] });
  assert.equal(result.imported.length, 0);
  assert.match(result.skipped[0]!.reason, /symbolic links/);
  await mkdir(join(root, "versions", "safe"), { recursive: true });
  await symlink(outside, join(root, "versions", "safe", "linked"));
  await assert.rejects(library.versions("safe/linked/secret"), /symbolic links/);
  assert.equal(await readFile(join(outside, "secret.md"), "utf8"), "Outside content");
});

test("moves into folders with structural child histories and supports versions as a prompt basename", async (t) => {
  const { library } = await fixture(t);
  const first = await create(library);
  const child = await library.save({ name: "Child", folder: "team/code-review", content: "Child", revision: null });
  const moved = await library.save({ id: first.id, name: "ignored", folder: "team", content: first.content, revision: first.revision });
  assert.equal(moved.id, "team/code-review");
  assert.equal((await library.versions(moved.id)).length, 2);
  assert.equal((await library.versions(child.id)).length, 1);
  assert.equal((await library.read(child.id)).content, "Child");
  const versions = await library.save({ name: "Versions", content: "A prompt named versions", revision: null });
  assert.equal(versions.id, "versions");
  assert.ok((await library.list()).some((prompt) => prompt.id === "versions"));
  await library.archive({ id: versions.id, revision: versions.revision });
  assert.ok((await library.list({ archived: true })).some((prompt) => prompt.id === "versions"));
});

test("rolls back a move when creating its new snapshot fails", async (t) => {
  const { library, root } = await fixture(t);
  const first = await create(library);
  const history = await library.versions(first.id);
  const storage = library as unknown as { snapshot: (root: string, id: string, content: string) => Promise<string> };
  const snapshot = storage.snapshot.bind(library);
  storage.snapshot = async (root, id, content) => {
    if (id === "target/code-review") throw new Error("Snapshot write failed");
    return snapshot(root, id, content);
  };
  await assert.rejects(library.save({ id: first.id, name: "ignored", folder: "target", content: "Moved", revision: first.revision }), /Snapshot write failed/);
  assert.equal((await library.read(first.id)).revision, first.revision);
  assert.deepEqual(await library.versions(first.id), history);
  await assert.rejects(library.read("target/code-review"), /not found/);
  await assert.rejects(readFile(join(root, "target", "code-review.md")), { code: "ENOENT" });
});
