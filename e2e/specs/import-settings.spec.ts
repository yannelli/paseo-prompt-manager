import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "./fixtures.ts";

const execute = promisify(execFile);

test.describe("import", () => {
  test("imports Markdown files and folders from host paths", async ({ app, library, daemon }, testInfo) => {
    const source = join(daemon.root, "import-source", testInfo.testId);
    await mkdir(join(source, "team", "nested"), { recursive: true });
    await writeFile(join(source, "bug-report.md"), "# Bug report\n\nSteps to reproduce.");
    await writeFile(join(source, "team", "onboarding.md"), "# Onboarding\n\nFirst-week checklist.");
    await writeFile(join(source, "team", "nested", "handoff.md"), "# Handoff\n\nWhat the next person needs.");
    await writeFile(join(source, "team", "notes.txt"), "not markdown");
    await library.seed("imported/keep", { content: "# Keep\n\nAlready here." });

    await app.openLibrary();
    await app.button("Import").click();
    await app.button("Select folder imported").click();
    await app.field("Markdown file or folder paths").fill(`${join(source, "bug-report.md")}\n${join(source, "team")}`);
    await app.button("Import 2 paths").click();
    await expect(app.text("3 imported · 1 skipped")).toBeVisible();
    await expect(app.text(/notes\.txt · Only Markdown \(\.md\) files can be imported\./)).toBeVisible();

    expect(await library.ids()).toEqual(["imported/bug-report", "imported/keep", "imported/team/nested/handoff", "imported/team/onboarding"]);
    expect((await library.read("imported/team/nested/handoff"))?.content).toBe("# Handoff\n\nWhat the next person needs.");
    expect(await library.versions("imported/bug-report")).toHaveLength(1);
    // Sources stay in place.
    expect(await readFile(join(source, "bug-report.md"), "utf8")).toBe("# Bug report\n\nSteps to reproduce.");

    await app.button("Back to library").click();
    for (const title of ["Bug report", "Onboarding", "Handoff", "Keep"]) await expect(app.promptRow(title)).toBeVisible();
  });

  test("reports paths it cannot import", async ({ app, library, daemon }) => {
    await library.seed("bug-report", { content: "# Bug report\n\nExisting." });
    const duplicate = join(daemon.root, "duplicate", "bug-report.md");
    await mkdir(join(daemon.root, "duplicate"), { recursive: true });
    await writeFile(duplicate, "# Bug report\n\nIncoming.");

    await app.openLibrary();
    await app.button("Import").click();
    await app.field("Markdown file or folder paths").fill(`${duplicate}\n${join(daemon.root, "missing.md")}`);
    await app.button("Import 2 paths").click();
    await expect(app.text("0 imported · 2 skipped")).toBeVisible();
    expect((await library.read("bug-report"))?.content).toBe("# Bug report\n\nExisting.");
    expect(await library.ids()).toEqual(["bug-report"]);
  });

  test("imports files picked in the browser", async ({ app, library, client }) => {
    test.skip(client !== "web", "The browser file picker exists only in the web client.");
    await app.openLibrary();
    await app.button("Import").click();
    const chooser = app.page.waitForEvent("filechooser");
    await app.button("Choose Markdown files").click();
    await (await chooser).setFiles([
      { name: "summary.md", mimeType: "text/markdown", buffer: Buffer.from("# Summary\n\nThree bullet points.") },
      { name: "rewrite.md", mimeType: "text/markdown", buffer: Buffer.from("# Rewrite\n\nPlain language.") },
    ]);
    await expect(app.text("2 imported · 0 skipped")).toBeVisible();
    expect(await library.ids()).toEqual(["rewrite", "summary"]);
    expect((await library.read("summary"))?.content).toBe("# Summary\n\nThree bullet points.");
  });
});

test.describe("library settings", () => {
  test("switches the library directory", async ({ app, library, daemon }, testInfo) => {
    const other = join(daemon.root, "other-library", testInfo.testId);
    await mkdir(other, { recursive: true });
    await writeFile(join(other, "elsewhere.md"), "# Elsewhere\n\nFrom another directory.");
    await library.seed("here", { content: "# Here\n\nOriginal directory." });

    await app.openLibrary();
    await expect(app.promptRow("Here")).toBeVisible();
    await app.button("Settings").click();
    await app.field("Prompt library directory").fill(other);
    await app.button("Save settings").click();
    await expect.poll(async () => (await library.settings()).directory).toBe(other);

    await app.button("Back to prompts").click();
    await expect(app.promptRow("Elsewhere")).toBeVisible();
    await expect(app.promptRow("Here")).toBeHidden();
    // The previous library stays on disk.
    expect(await library.ids()).toEqual(["here"]);
  });

  test("sets up Git sync and pushes prompts to a remote", async ({ app, library, daemon }, testInfo) => {
    const remote = join(daemon.root, "remotes", `${testInfo.testId}.git`);
    await execute("git", ["init", "--bare", "-q", "--initial-branch", "main", remote]);
    await library.seed("deploy", { content: "# Deploy\n\nShip it.", tags: ["ops"] });

    await app.openLibrary();
    await app.button("Settings").click();
    await app.field("Git sync").click();
    await app.button("Save settings").click();
    await expect.poll(async () => (await library.settings()).gitEnabled).toBe(true);

    await app.field("Git remote URL").fill(remote);
    await app.field("Git branch").fill("main");
    await app.button("Set up").click();
    await expect(app.text("Initialized")).toBeVisible();
    expect(await library.git("remote", "get-url", "origin")).toBe(remote);

    await app.button("Sync now").click();
    await expect.poll(async () => {
      const { stdout } = await execute("git", ["--git-dir", remote, "ls-tree", "-r", "--name-only", "main"]).catch(() => ({ stdout: "" }));
      return stdout.split("\n").filter(Boolean);
    }, { timeout: 30_000 }).toContain("deploy.md");
    const { stdout: pushed } = await execute("git", ["--git-dir", remote, "show", "main:deploy.md"]);
    expect(pushed).toContain("# Deploy\n\nShip it.");

    await app.button("Automatic").click();
    await expect.poll(async () => (await library.settings()).syncMode).toBe("changes");
  });
});
