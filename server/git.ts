import { execFile } from "node:child_process";
import { lstat, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const segment = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function isPromptPath(path: string) {
  const parts = path.split("/");
  if (parts[0] === "versions") {
    const filename = parts.pop()!;
    parts.shift();
    const name = parts.at(-1);
    return Boolean(name && segment.test(name) && parts.slice(0, -1).every((part) => part !== "versions" && segment.test(part)) &&
      filename.startsWith(`${name}.`) && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_v[1-9]\d*\.md$/.test(filename.slice(name.length + 1)));
  }
  const filename = parts.pop()!;
  return filename.endsWith(".md") && segment.test(filename.slice(0, -3)) &&
    parts.every((part) => part !== "versions" && segment.test(part));
}

async function git(root: string, args: string[]) {
  try {
    const result = await execute("git", ["-c", "core.hooksPath=/dev/null", "-C", root, ...args], {
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes" },
    });
    return result.stdout.trim();
  } catch (error) {
    const failure = error as Error & { stderr?: string };
    throw new Error(failure.stderr?.trim() || failure.message);
  }
}

async function attempt(root: string, args: string[]) {
  try { return await git(root, args); } catch { return null; }
}

/** Cheap check for a repository at the library root, without running Git. */
export async function hasRepository(root: string) {
  try {
    await lstat(join(root, ".git"));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function isRepository(root: string) {
  if (!await hasRepository(root)) return false;
  const top = await git(root, ["rev-parse", "--show-toplevel"]);
  if (await realpath(top) !== await realpath(root)) throw new Error("Choose a Git repository whose root is the prompt directory.");
  return true;
}

export async function gitStatus(root: string, message = "") {
  if (!await isRepository(root)) return { initialized: false, branch: "", remote: "", changes: 0, message };
  const branch = await git(root, ["symbolic-ref", "--short", "HEAD"]);
  const remotes = await git(root, ["remote"]);
  const remote = remotes.split("\n").includes("origin") ? await git(root, ["remote", "get-url", "origin"]) : "";
  const status = await git(root, ["status", "--porcelain", "--untracked-files=all"]);
  return { initialized: true, branch, remote, changes: status ? status.split("\n").length : 0, message };
}

async function hasUpstream(root: string, branch: string) {
  return Boolean(branch && await attempt(root, ["config", "--get", `branch.${branch}.remote`]));
}

async function remoteDefaultBranch(root: string) {
  let refs: string;
  try {
    refs = await git(root, ["ls-remote", "--symref", "origin", "HEAD"]);
  } catch (error) {
    throw new Error(`Could not reach origin. Check the URL and this host's Git credentials. ${(error as Error).message}`);
  }
  return /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(refs)?.[1] ?? "";
}

/** Creates the repository if needed, then points origin and the local branch at the chosen remote. */
export async function initializeGit(root: string, remote: string, branch = "") {
  const url = remote.trim();
  const wanted = branch.trim();
  if (url && (!/^(?:https:\/\/|ssh:\/\/|git@[a-zA-Z0-9.-]+:|\/)/.test(url) || /[\r\n\0]/.test(url))) {
    throw new Error("Use an HTTPS URL, SSH URL, git@host:path, or absolute local remote path.");
  }
  if (wanted && (wanted.startsWith("-") || await attempt(root, ["check-ref-format", "--branch", wanted]) === null)) {
    throw new Error("Enter a valid branch name, such as main.");
  }
  if (!await isRepository(root)) await git(root, ["init", "--initial-branch=main"]);
  const status = await gitStatus(root);
  if (url && !status.remote) await git(root, ["remote", "add", "origin", url]);
  else if (url && status.remote !== url) await git(root, ["remote", "set-url", "origin", url]);
  else if (!url && status.remote) await git(root, ["remote", "remove", "origin"]);
  // A branch that already tracks origin keeps its name when only the URL changes.
  const detect = url && !wanted && !await hasUpstream(root, status.branch);
  const target = wanted || (detect ? await remoteDefaultBranch(root) : "") || status.branch;
  if (target && target !== status.branch) {
    if (await attempt(root, ["rev-parse", "--verify", "--quiet", "HEAD"]) === null) await git(root, ["symbolic-ref", "HEAD", `refs/heads/${target}`]);
    else await git(root, ["branch", "-m", status.branch, target]);
  }
  return gitStatus(root, url
    ? `Connected to origin on ${target}. Sync merges prompts from both sides, then pushes.`
    : "Git is ready for local checkpoints. Add a remote to sync across machines.");
}

async function managedFiles(root: string) {
  const files: string[] = [];
  const walk = async (prefix = "") => {
    for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isFile() && isPromptPath(path)) files.push(path);
      if (entry.isDirectory() && segment.test(entry.name) && (entry.name !== "versions" || !prefix || prefix === "versions" || prefix.startsWith("versions/"))) await walk(path);
    }
  };
  await walk();
  const tracked = (await git(root, ["ls-files", "-z"])).split("\0").filter(isPromptPath);
  return [...new Set([...files, ...tracked])];
}

async function checkpoint(root: string) {
  const status = await gitStatus(root);
  if (!status.initialized) throw new Error("Initialize Git in the prompt directory first.");
  const staged = (await git(root, ["diff", "--cached", "--name-only", "-z"])).split("\0").filter(Boolean);
  if (staged.some((path) => !isPromptPath(path))) throw new Error("Commit or unstage unrelated files before syncing prompts.");
  const files = await managedFiles(root);
  for (let offset = 0; offset < files.length; offset += 100) {
    await git(root, ["add", "-A", "--", ...files.slice(offset, offset + 100)]);
  }
  if (await git(root, ["diff", "--cached", "--name-only"])) {
    await git(root, ["commit", "-m", "Update prompt library"]);
  }
  return status;
}

async function integrate(root: string, branch: string) {
  const args = ["merge", "--no-edit", "-m", "Merge prompt library from origin", "FETCH_HEAD"];
  if (await attempt(root, ["rev-parse", "--verify", "--quiet", "HEAD"]) !== null
    && await attempt(root, ["merge-base", "HEAD", "FETCH_HEAD"]) === null
    && !await hasUpstream(root, branch)) {
    // First connection of a library that already has its own history.
    args.splice(1, 0, "--allow-unrelated-histories");
  }
  try {
    await git(root, args);
  } catch (error) {
    await attempt(root, ["merge", "--abort"]);
    throw new Error(`Git sync stopped before merging origin. Resolve branch divergence with Git, then sync again. ${(error as Error).message}`);
  }
}

type Exclusive = <T>(operation: () => Promise<T>) => Promise<T>;

// Commits prompt files, merges origin's branch, and pushes. `exclusive` holds the library lock
// for steps that touch the working tree; network steps run without it so prompts stay usable.
export async function synchronizeGit(root: string, exclusive: Exclusive = (operation) => operation()) {
  const status = await exclusive(() => checkpoint(root));
  if (!status.remote) return gitStatus(root, "Saved a local Git checkpoint. Add an origin remote to sync across machines.");
  const remoteRefs = await git(root, ["ls-remote", "--heads", "origin"]);
  if (remoteRefs.split("\n").some((line) => line.endsWith(`refs/heads/${status.branch}`))) {
    await git(root, ["fetch", "origin", status.branch]);
    await exclusive(() => integrate(root, status.branch));
  }
  await git(root, ["push", "--set-upstream", "origin", status.branch]);
  return gitStatus(root, "Synced with origin.");
}
