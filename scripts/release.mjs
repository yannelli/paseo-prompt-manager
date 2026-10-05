import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { manifestPaths, prepare, verifyConditions } from "./release-manifests.mjs";

const releaseTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.([1-9]\d*))?$/;
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const channels = { main: "latest", beta: "beta" };
const levels = { patch: 1, minor: 2, major: 3 };
const releaseMarker = "<!-- paseo-prompt-manager-release -->";

export function releaseType(message) {
  const header = /^([a-z]+)(?:\([^\r\n()]+\))?(!)?: \S[^\r\n]*/.exec(message);
  if (!header) return null;
  if (header[2] || /^BREAKING[ -]CHANGE: \S/m.test(message)) return "major";
  if (header[1] === "feat") return "minor";
  if (["fix", "perf", "revert"].includes(header[1])) return "patch";
  return null;
}

export function nextVersion(version, commits) {
  if (!stableVersion.test(version)) throw new Error(`Invalid stable version: ${version}`);
  const type = commits.reduce((highest, { message }) => {
    const current = releaseType(message);
    return (levels[current] || 0) > (levels[highest] || 0) ? current : highest;
  }, null);
  if (!type) return null;
  const [major, minor, patch] = version.split(".").map(BigInt);
  if (type === "major") return `${major + 1n}.0.0`;
  if (type === "minor") return `${major}.${minor + 1n}.0`;
  return `${major}.${minor}.${patch + 1n}`;
}

export function parseTag(tag) {
  const match = releaseTag.exec(tag);
  if (!match) return null;
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  return { tag, version: tag.slice(1), base: `${major}.${minor}.${patch}`, major, minor, patch, beta: match[4] ? Number(match[4]) : null };
}

export function compareTags(a, b) {
  const stable = (tag) => (tag.beta === null ? 1 : 0);
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch || stable(a) - stable(b) || (a.beta ?? 0) - (b.beta ?? 0);
}

export function betaVersion(base, tags) {
  const taken = tags.filter((tag) => tag.base === base && tag.beta !== null).map((tag) => tag.beta);
  return `${base}-beta.${Math.max(0, ...taken) + 1}`;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function releaseTags(...args) {
  return git("tag", "--list", ...args, "v*").split("\n").map(parseTag).filter(Boolean).sort(compareTags);
}

function commitsSince(tag) {
  const records = git("log", ...(tag ? [`${tag}..HEAD`] : []), "--format=%H%x00%B%x00").split("\0");
  const commits = [];
  for (let i = 0; i + 1 < records.length; i += 2) {
    commits.push({ hash: records[i].trim(), message: records[i + 1].trim() });
  }
  return commits;
}

export function releaseNotes(version, previousTag, commits) {
  const sections = [
    ["Breaking changes", (message) => releaseType(message) === "major"],
    ["Features", (message) => releaseType(message) === "minor"],
    ["Fixes and performance", (message) => releaseType(message) === "patch"],
  ];
  const notes = [`# ${version}`, ""];
  for (const [title, matches] of sections) {
    const matching = commits.filter(({ message }) => matches(message));
    if (!matching.length) continue;
    notes.push(`## ${title}`, "");
    for (const { hash, message } of matching) {
      const [subject, ...body] = message.split("\n");
      notes.push(`- ${subject} (${hash.slice(0, 7)})`);
      if (releaseType(message) === "major" && body.join("\n").trim()) {
        notes.push("", ...body.map((line) => `  ${line}`), "");
      }
    }
    notes.push("");
  }
  notes.push(previousTag ? `Changes since ${previousTag}.` : "First release.", "");
  return notes.join("\n");
}

async function publishRelease(tag, notes, repository) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GH_TOKEN or GITHUB_TOKEN is required to publish a release");
  const endpoint = `${process.env.GITHUB_API_URL || "https://api.github.com"}/repos/${repository}/releases`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const existing = await fetch(`${endpoint}/tags/${tag}`, { headers });
  if (existing.ok) {
    console.log(`GitHub release ${tag} already exists`);
    return;
  }
  if (existing.status !== 404) throw new Error(`GitHub release lookup failed: HTTP ${existing.status}`);
  const prerelease = parseTag(tag).beta !== null;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ tag_name: tag, name: tag, body: notes, draft: false, prerelease, make_latest: prerelease ? "false" : "true" }),
  });
  if (!response.ok) throw new Error(`GitHub release creation failed: HTTP ${response.status}: ${await response.text()}`);
  console.log(`Published ${(await response.json()).html_url}`);
}

export async function release({ dryRun = true } = {}) {
  const cwd = process.cwd();
  const branch = git("branch", "--show-current");
  if (!(branch in channels)) throw new Error(`Releases run from ${Object.keys(channels).join(" or ")}`);
  const beta = channels[branch] === "beta";
  if (git("status", "--porcelain")) throw new Error("Release checkout must be clean");
  const currentVersion = await verifyConditions({}, { cwd });
  const allTags = releaseTags();
  const reachable = releaseTags("--merged", "HEAD");
  const previous = reachable.at(-1);
  const previousStable = reachable.filter((tag) => tag.beta === null).at(-1);
  if (previous && currentVersion !== previous.version) throw new Error(`Manifest version ${currentVersion} does not match ${previous.tag}`);
  const repository = process.env.GITHUB_REPOSITORY;
  if (!dryRun) {
    if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("GITHUB_REPOSITORY must be owner/repo");
    if (!(process.env.GH_TOKEN || process.env.GITHUB_TOKEN)) throw new Error("GH_TOKEN or GITHUB_TOKEN is required");
    if (previous) {
      const annotation = git("for-each-ref", `refs/tags/${previous.tag}`, "--format=%(contents)");
      if (annotation.includes(releaseMarker)) await publishRelease(previous.tag, annotation.replace(releaseMarker, "").trim(), repository);
    }
  }
  const base = previousStable ? nextVersion(previousStable.version, commitsSince(previousStable.tag)) : currentVersion.replace(/-.*$/, "");
  const pending = beta && previous && !commitsSince(previous.tag).some(({ message }) => releaseType(message));
  if (!base || pending) {
    console.log(`No release-triggering commits since ${previous?.tag}`);
    return null;
  }
  const version = beta ? betaVersion(base, allTags) : base;
  if (allTags.some((tag) => tag.version === version)) throw new Error(`Tag v${version} already exists`);
  const notesFrom = beta ? previous : previousStable;
  const notes = releaseNotes(version, notesFrom?.tag, commitsSince(notesFrom?.tag));
  if (dryRun) {
    console.log(notes);
    return version;
  }
  if (version !== currentVersion) {
    await prepare({}, { cwd, nextRelease: { version } });
    git("add", "--", ...manifestPaths);
    git("commit", "-m", `chore(release): ${version}`);
  }
  const directory = mkdtempSync(join(tmpdir(), "prompt-manager-release-notes-"));
  const notesPath = join(directory, "notes.md");
  try {
    writeFileSync(notesPath, `${notes}\n${releaseMarker}\n`);
    git("tag", "-a", `v${version}`, "-F", notesPath);
    git("push", "--atomic", "origin", `HEAD:refs/heads/${branch}`, `refs/tags/v${version}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  await publishRelease(`v${version}`, notes, repository);
  return version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--publish", "--dry-run"].includes(args[0])) {
    throw new Error("Usage: node scripts/release.mjs --dry-run|--publish");
  }
  await release({ dryRun: args[0] === "--dry-run" });
}
