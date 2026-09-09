import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gitStatus, initializeGit, synchronizeGit } from "./git.ts";

function command(root: string, ...args: string[]) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const base = await mkdtemp(join(tmpdir(), "prompt-git-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, "library");
  await mkdir(root);
  await initializeGit(root, "");
  command(root, "config", "user.name", "Prompt test");
  command(root, "config", "user.email", "test@example.invalid");
  return { base, root };
}

test("local checkpoint commits prompts and versions, leaving unrelated files", async (t) => {
  const { root } = await fixture(t);
  await mkdir(join(root, "versions", "review"), { recursive: true });
  await writeFile(join(root, "review.md"), "# Review\nCheck the diff.");
  await writeFile(join(root, "versions", "review", "review.2026-09-09T00-00-00-000Z_v1.md"), "# Review");
  await writeFile(join(root, "private.txt"), "unrelated");
  const result = await synchronizeGit(root);
  assert.match(result.message, /local Git checkpoint/);
  assert.deepEqual(command(root, "ls-files").split("\n"), ["review.md", "versions/review/review.2026-09-09T00-00-00-000Z_v1.md"]);
  await rm(join(root, "review.md"));
  await synchronizeGit(root);
  assert.equal(command(root, "ls-files", "review.md"), "");
  assert.match(command(root, "ls-files"), /versions/);
});

test("push, fast-forward pull and divergence preserve both histories", async (t) => {
  const { base, root } = await fixture(t);
  const remote = join(base, "remote.git");
  await mkdir(remote);
  command(remote, "init", "--bare", "--initial-branch=main");
  await initializeGit(root, remote);
  await writeFile(join(root, "review.md"), "one");
  await synchronizeGit(root);
  const second = join(base, "second");
  command(base, "clone", remote, second);
  command(second, "config", "user.name", "Prompt test");
  command(second, "config", "user.email", "test@example.invalid");
  await writeFile(join(second, "review.md"), "two");
  await synchronizeGit(second);
  await synchronizeGit(root);
  assert.equal(await readFile(join(root, "review.md"), "utf8"), "two");
  await writeFile(join(second, "review.md"), "remote edit");
  await synchronizeGit(second);
  await writeFile(join(root, "review.md"), "local edit");
  await assert.rejects(synchronizeGit(root), /Resolve branch divergence/);
  assert.equal(await readFile(join(root, "review.md"), "utf8"), "local edit");
  assert.equal(command(remote, "show", "main:review.md"), "remote edit");
});

test("unrelated staged files block sync without committing", async (t) => {
  const { root } = await fixture(t);
  await writeFile(join(root, "secret.txt"), "private");
  command(root, "add", "secret.txt");
  await assert.rejects(synchronizeGit(root), /unstage unrelated/);
  assert.equal(command(root, "diff", "--cached", "--name-only"), "secret.txt");
});

test("nested library does not use its parent repository", async (t) => {
  const { root } = await fixture(t);
  const nested = join(root, "nested");
  await mkdir(nested);
  assert.equal((await gitStatus(nested)).initialized, false);
  await assert.rejects(synchronizeGit(nested), /Initialize Git/);
  await assert.rejects(initializeGit(nested, "--upload-pack=bad"), /Use an HTTPS/);
});

test("sync tracks nested prompts, metadata, and moved version history", async (t) => {
  const { root } = await fixture(t);
  const history = "review.2026-09-09T00-00-00-000Z_v1.md";
  const content = '---\npaseo: {"description":"Review changes","tags":["security"]}\n---\n# Review\nCheck changes.';
  await mkdir(join(root, "engineering", "security"), { recursive: true });
  await mkdir(join(root, "versions", "engineering", "security", "review"), { recursive: true });
  await writeFile(join(root, "engineering", "security", "review.md"), content);
  await writeFile(join(root, "versions", "engineering", "security", "review", history), content);
  await writeFile(join(root, "engineering", "private.txt"), "unrelated");
  await synchronizeGit(root);
  assert.deepEqual(command(root, "ls-files").split("\n"), ["engineering/security/review.md", `versions/engineering/security/review/${history}`]);
  assert.equal(command(root, "show", "HEAD:engineering/security/review.md"), content);
  await mkdir(join(root, "versions", "operations"), { recursive: true });
  await mkdir(join(root, "operations"), { recursive: true });
  await rename(join(root, "engineering", "security", "review.md"), join(root, "operations", "review.md"));
  await rename(join(root, "versions", "engineering", "security", "review"), join(root, "versions", "operations", "review"));
  await synchronizeGit(root);
  assert.deepEqual(command(root, "ls-files").split("\n"), ["operations/review.md", `versions/operations/review/${history}`]);
});
