import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { startDaemon, type TestDaemon } from "../harness/daemon.ts";
import { TestLibrary, createAgent, receivedPrompts, receivedTexts, type TestAgent } from "../harness/library.ts";
import { platform, resultsDir } from "./config.ts";
import { appEndpoint, find, hierarchy, keyboardTop, prepareDevice, screenSize, screenshot, waitForKeyboard } from "./device.ts";
import { startHooks, stopHooks } from "./hooks.ts";
import { renderFlows, runFlow } from "./maestro.ts";

const execute = promisify(execFile);
const READY = "Ready for a saved prompt.";
const CODE_REVIEW = "# Code review\n\nReview the diff for bugs, missing tests, and unclear names.";
const SUMMARY = "# Summary\n\nSummarize this thread in three bullets.";

let daemon: TestDaemon;
const pattern = process.env.PROMPT_E2E_PATTERN ? new RegExp(process.env.PROMPT_E2E_PATTERN, "i") : null;
const selected = (title: string) => !pattern || pattern.test(title);
let hookPort = "";
/** Every scenario needs the app to be connected; when the connection test failed, fail the rest at once. */
let connection: "pending" | "connected" | "failed" = "pending";

/** Retries `read` until it satisfies `done`; the plugin writes after the UI action returns. */
async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean, what: string, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await sleep(500);
    value = await read();
  }
  assert.ok(done(value), `${what}; last value: ${JSON.stringify(value)}`);
  return value;
}

/** One scenario: a fresh library, optional agent, and a flow runner that passes the daemon to Maestro. */
function scenario(title: string, body: (context: { library: TestLibrary; flow: (file: string, extra?: Record<string, string>) => Promise<void>; agent: () => Promise<TestAgent> }) => Promise<void>) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  test(title, { timeout: (platform === "ios" ? 25 : 15) * 60_000, skip: !selected(title) && "Not selected by PROMPT_E2E_PATTERN." }, async () => {
    assert.notEqual(connection, "failed", "The app never connected to the daemon; see the first test.");
    const library = new TestLibrary(daemon, slug);
    await library.activate();
    let created: TestAgent | undefined;
    const agent = async () => created ??= await createAgent(daemon, `agent-${slug}`);
    const flow = async (file: string, extra: Record<string, string> = {}) => {
      const env: Record<string, string> = { SERVER_ID: daemon.serverId, HOOK_PORT: hookPort, ...extra };
      if (created) env.AGENT_ID = created.id;
      await runFlow(file, `${slug}-${file.replace(/\.yaml$/, "")}`, env);
    };
    await body({ library, flow, agent });
  });
}

before(async () => {
  await renderFlows();
  daemon = await startDaemon({ host: "127.0.0.1" });
  await prepareDevice(daemon);
  hookPort = String(await startHooks());
});

after(async () => {
  await stopHooks();
  if (!daemon) return;
  await mkdir(resultsDir, { recursive: true });
  await copyFile(daemon.logFile, join(resultsDir, "daemon.log")).catch(() => undefined);
  await daemon.stop();
});

describe(`Prompt manager on ${platform}`, () => {
  test("connects the app to the daemon from a fresh install", { timeout: 10 * 60_000, skip: !selected("connects the app to the daemon from a fresh install") && "Not selected by PROMPT_E2E_PATTERN." }, async () => {
    const library = new TestLibrary(daemon, "connect");
    await library.activate();
    connection = "failed";
    // The first launch on a fresh emulator is the slowest; give the app a second try.
    for (const attempt of [1, 2]) {
      try {
        await runFlow("connect.yaml", `connect-${attempt}`, { ...appEndpoint(daemon), SERVER_ID: daemon.serverId });
        break;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
    connection = "connected";
    // Reaching a screen with the header menu means the app registered the host and its connection came up.
    assert.deepEqual(await library.ids(), []);
  });

  scenario("opens the library from the drawer", async ({ library, flow }) => {
    await library.seed("code-review", { content: CODE_REVIEW, description: "Find bugs before merge", tags: ["review"] });
    await library.seed("writing/summary", { content: SUMMARY });
    await flow("library-open.yaml");
    assert.deepEqual(await library.ids(), ["code-review", "writing/summary"]);
    assert.deepEqual(await library.versions("code-review"), []);
  });

  scenario("creates a prompt with metadata in a new folder", async ({ library, flow }) => {
    await flow("create-prompt.yaml");
    const id = "team/docs/release-notes";
    await eventually(() => library.read(id), (prompt) => prompt !== null, "the prompt file was not written");
    assert.deepEqual(await library.read(id), {
      content: "# Release notes\n\nSummarize every merged PR since the last tag.",
      description: "Draft release notes from merged PRs",
      tags: ["writing", "release"],
    });
    assert.deepEqual(await library.ids(), [id]);
    assert.equal((await library.versions(id)).length, 1);
  });

  scenario("saves edits as versions and restores Version 1", async ({ library, flow }) => {
    const original = "# Standup\n\nList what changed yesterday.";
    const edited = "# Standup\n\nList what changed yesterday and what is blocked.";
    await library.seed("standup", { content: original });
    await flow("edit-restore-edit.yaml");
    await eventually(async () => (await library.read("standup"))?.content, (content) => content === edited, "the edit was not saved");
    assert.deepEqual((await library.versions("standup")).map((version) => version.content), [original, edited]);

    await flow("edit-restore-restore.yaml");
    await eventually(async () => (await library.read("standup"))?.content, (content) => content === original, "Version 1 was not restored");
    const versions = await eventually(() => library.versions("standup"), (list) => list.length === 3, "restoring did not add a third version");
    assert.deepEqual(versions.map((version) => version.content), [original, edited, original]);
  });

  scenario("asks before discarding unsaved changes", async ({ library, flow }) => {
    await library.seed("triage", { content: "# Triage\n\nLabel new issues." });
    await flow("discard.yaml");
    assert.equal((await library.read("triage"))?.content, "# Triage\n\nLabel new issues.");
    assert.equal((await library.versions("triage")).length, 0);
  });

  scenario("archives a prompt and restores it from Archived", async ({ library, flow }) => {
    const content = "# Retro\n\nWhat went well?";
    await library.seed("retro", { content });
    await flow("archive-archive.yaml");
    await eventually(() => library.read("retro"), (prompt) => prompt === null, "the archived prompt is still in the library");
    assert.deepEqual((await library.versions("retro")).map((version) => version.content), [content]);

    await flow("archive-restore.yaml");
    await eventually(async () => (await library.read("retro"))?.content, (value) => value === content, "the prompt was not restored");
  });

  scenario("filters by search, folder, and tag", async ({ library, flow }) => {
    await library.seed("code-review", { content: "# Code review\n\nCheck error handling.", tags: ["review"] });
    await library.seed("writing/blog-post", { content: "# Blog post\n\nOutline a launch post.", tags: ["writing"] });
    await library.seed("writing/changelog", { content: "# Changelog\n\nGroup changes by type.", tags: ["writing", "release"] });
    await flow("filters.yaml");
    assert.deepEqual(await library.ids(), ["code-review", "writing/blog-post", "writing/changelog"]);
    assert.equal((await library.versions("writing/changelog")).length, 0);
  });

  scenario("imports Markdown files and folders from host paths", async ({ library, flow }) => {
    const source = join(daemon.root, "import-source", "mobile");
    await mkdir(join(source, "team", "nested"), { recursive: true });
    await writeFile(join(source, "bug-report.md"), "# Bug report\n\nSteps to reproduce.");
    await writeFile(join(source, "team", "onboarding.md"), "# Onboarding\n\nFirst-week checklist.");
    await writeFile(join(source, "team", "nested", "handoff.md"), "# Handoff\n\nWhat the next person needs.");
    await writeFile(join(source, "team", "notes.txt"), "not markdown");
    await library.seed("imported/keep", { content: "# Keep\n\nAlready here." });
    await flow("import.yaml", { IMPORT_FILE: join(source, "bug-report.md"), IMPORT_DIR: join(source, "team") });

    await eventually(() => library.ids(), (ids) => ids.length === 4, "the import did not write four prompts");
    assert.deepEqual(await library.ids(), ["imported/bug-report", "imported/keep", "imported/team/nested/handoff", "imported/team/onboarding"]);
    assert.equal((await library.read("imported/team/nested/handoff"))?.content, "# Handoff\n\nWhat the next person needs.");
    assert.equal((await library.versions("imported/bug-report")).length, 1);
    assert.equal(await readFile(join(source, "bug-report.md"), "utf8"), "# Bug report\n\nSteps to reproduce.");
  });

  scenario("switches the library directory in settings", async ({ library, flow }) => {
    const other = join(daemon.root, "other-library", "mobile");
    await mkdir(other, { recursive: true });
    await writeFile(join(other, "elsewhere.md"), "# Elsewhere\n\nFrom another directory.");
    await library.seed("here", { content: "# Here\n\nOriginal directory." });
    await flow("settings-directory.yaml", { OTHER_DIR: other });
    await eventually(async () => (await library.settings()).directory, (directory) => directory === other, "the settings file still names the old directory");
    await flow("settings-directory-back.yaml");
    assert.deepEqual(await library.ids(), ["here"]);
  });

  scenario("sets up Git sync and pushes prompts to a remote", async ({ library, flow }) => {
    const remote = join(daemon.root, "remotes", "mobile.git");
    await execute("git", ["init", "--bare", "-q", "--initial-branch", "main", remote]);
    await library.seed("deploy", { content: "# Deploy\n\nShip it.", tags: ["ops"] });

    await flow("git-enable.yaml");
    await eventually(async () => (await library.settings()).gitEnabled, (enabled) => enabled === true, "Git sync was not enabled in the settings file");
    await flow("git-setup-sync.yaml", { REMOTE: remote });
    assert.equal(await eventually(() => library.git("remote", "get-url", "origin").catch(() => ""), (url) => url === remote, "origin does not point at the remote"), remote);
    const pushed = await eventually(
      async () => (await execute("git", ["--git-dir", remote, "ls-tree", "-r", "--name-only", "main"]).catch(() => ({ stdout: "" }))).stdout.split("\n").filter(Boolean),
      (files) => files.includes("deploy.md"), "deploy.md was not pushed to the remote",
    );
    assert.ok(pushed.includes("deploy.md"));
    const { stdout } = await execute("git", ["--git-dir", remote, "show", "main:deploy.md"]);
    assert.ok(stdout.includes("# Deploy\n\nShip it."));

    await flow("git-automatic.yaml");
    await eventually(async () => (await library.settings()).syncMode, (mode) => mode === "changes", "the sync mode was not saved");
  });

  describe("agent screen", () => {
    const seed = async (library: TestLibrary) => {
      await library.seed("code-review", { content: CODE_REVIEW, description: "Pre-merge review", tags: ["review"] });
      await library.seed("writing/summary", { content: SUMMARY });
    };

    scenario("the composer pill searches and sends a saved prompt", async ({ library, flow, agent }) => {
      await seed(library);
      const target = await agent();
      await flow("agent-pill.yaml");
      await eventually(() => receivedTexts(target), (texts) => texts.length >= 2, "the agent did not receive the prompt");
      assert.deepEqual(await receivedTexts(target), [READY, CODE_REVIEW]);
    });

    scenario("/prompt sends a saved prompt by ID", async ({ library, flow, agent }) => {
      await seed(library);
      const target = await agent();
      await flow("agent-slash-prompt.yaml");
      await eventually(() => receivedTexts(target), (texts) => texts.length >= 2, "the agent did not receive the prompt");
      assert.deepEqual(await receivedTexts(target), [READY, SUMMARY]);
    });

    scenario("/prompts opens the panel, which sends the selected prompt", async ({ library, flow, agent }) => {
      await seed(library);
      const target = await agent();
      await flow("agent-slash-prompts.yaml");
      await eventually(() => receivedTexts(target), (texts) => texts.length >= 2, "the agent did not receive the prompt");
      assert.deepEqual(await receivedTexts(target), [READY, CODE_REVIEW]);
    });

    scenario("Attach Saved prompt adds the prompt to a message", async ({ library, flow, agent }) => {
      await seed(library);
      const target = await agent();
      await flow("agent-attach.yaml");
      await eventually(async () => (await receivedPrompts(target)).length, (count) => count >= 2, "the agent did not receive the message");
      const blocks = (await receivedPrompts(target)).at(-1)!;
      assert.deepEqual(blocks[0], { type: "text", text: "Use the attached checklist." });
      assert.ok(blocks.slice(1).map((block) => block.text ?? "").join("\n").includes(CODE_REVIEW), `the attachment text is missing from ${JSON.stringify(blocks)}`);
    });
  });

  describe("phone layout", () => {
    scenario("the picker sheet opens tall and reaches the last result", async ({ library, flow, agent }) => {
      for (let index = 1; index <= 12; index++) {
        await library.seed(`step-${String(index).padStart(2, "0")}`, { content: `# Step ${index}\n\nLine one.\nLine two.\nLine three.` });
      }
      const target = await agent();
      await flow("mobile-picker-open.yaml");
      // Regression for #9: the host sized the sheet to a nested list and left it a few rows tall.
      await screenshot("picker-open");
      const nodes = await hierarchy("picker-open");
      const picker = find(nodes, "prompt-picker")?.bounds;
      assert.ok(picker, "the prompt picker is not in the view hierarchy");
      const screen = await screenSize();
      assert.ok(picker.bottom - picker.top > screen.height * 0.5, `picker is ${picker.bottom - picker.top}px tall on a ${screen.height}px screen`);

      await flow("mobile-picker-last.yaml");
      await eventually(() => receivedTexts(target), (texts) => texts.length >= 2, "the agent did not receive Step 12");
      assert.deepEqual(await receivedTexts(target), [READY, "# Step 12\n\nLine one.\nLine two.\nLine three."]);
    });

    scenario("the focused editor field stays above the keyboard", async ({ library, flow }) => {
      await flow("mobile-editor-new.yaml");
      await waitForKeyboard(true, "editor-tags");
      await screenshot("editor-tags");
      const top = await keyboardTop("editor-tags");
      const tags = find(await hierarchy("editor-tags"), "Prompt tags");
      assert.ok(tags?.bounds, "the tags field is not in the view hierarchy");
      assert.ok(tags.bounds.top >= 0 && tags.bounds.bottom <= top, `tags field ${JSON.stringify(tags.bounds)} is not above the keyboard at y=${top}`);

      await flow("mobile-editor-markdown.yaml");
      await waitForKeyboard(true, "editor-markdown");
      await screenshot("editor-markdown");
      const markdownTop = await keyboardTop("editor-markdown");
      const markdown = find(await hierarchy("editor-markdown"), "Prompt Markdown");
      assert.ok(markdown?.bounds, "the Markdown field is not in the view hierarchy");
      // A tall field only needs its first lines in view; the caret scrolls the rest.
      assert.ok(markdown.bounds.top >= 0 && markdown.bounds.top + 40 <= markdownTop, `Markdown field ${JSON.stringify(markdown.bounds)} starts under the keyboard at y=${markdownTop}`);
      assert.deepEqual(await library.ids(), []);
    });

    scenario("the expanded editor shows Hide keyboard and it hides the keyboard", async ({ flow }) => {
      await flow("mobile-editor-expanded.yaml");
      await waitForKeyboard(true, "expanded-up");
      await flow("mobile-editor-done.yaml");
      await waitForKeyboard(false, "expanded-down");
    });

    scenario("the library header shows on the list only", async ({ library, flow }) => {
      await library.seed("standup", { content: "# Standup\n\nYesterday, today, blockers." });
      await flow("mobile-header.yaml");
      assert.deepEqual(await library.ids(), ["standup"]);
    });
  });
});
