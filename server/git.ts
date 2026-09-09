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
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true" },
    });
    return result.stdout.trim();
  } catch (error) {
    const failure = error as Error & { stderr?: string };
    throw new Error(failure.stderr?.trim() || failure.message);
  }
}

async function isRepository(root: string) {
  try {
    await lstat(join(root, ".git"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
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

export async function initializeGit(root: string, remote: string) {
  const url = remote.trim();
  if (url && (!/^(?:https:\/\/|ssh:\/\/|git@[a-zA-Z0-9.-]+:|\/)/.test(url) || /[\r\n\0]/.test(url))) {
    throw new Error("Use an HTTPS URL, SSH URL, git@host:path, or absolute local remote path.");
  }
  if (!await isRepository(root)) await git(root, ["init", "--initial-branch=main"]);
  const status = await gitStatus(root);
  if (url && status.remote && status.remote !== url) throw new Error("Origin already points elsewhere. Change it with Git before syncing.");
  if (url && !status.remote) await git(root, ["remote", "add", "origin", url]);
  return gitStatus(root, "Git is ready. Sync commits prompt files and version history.");
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

export async function synchronizeGit(root: string) {
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
  if (!status.remote) return gitStatus(root, "Saved a local Git checkpoint. Add an origin remote to sync across machines.");
  const remoteRefs = await git(root, ["ls-remote", "--heads", "origin"]);
  const branchExists = remoteRefs.split("\n").some((line) => line.endsWith(`refs/heads/${status.branch}`));
  if (branchExists) {
    await git(root, ["fetch", "origin", status.branch]);
    try {
      await git(root, ["merge", "--ff-only", "FETCH_HEAD"]);
    } catch (error) {
      throw new Error(`Git sync stopped. Resolve branch divergence or local changes with Git, then sync again. ${(error as Error).message}`);
    }
  } else if (remoteRefs) {
    throw new Error(`Origin has no ${status.branch} branch. Check out the remote library branch with Git before syncing.`);
  }
  await git(root, ["push", "--set-upstream", "origin", status.branch]);
  return gitStatus(root, "Synced with origin.");
}
