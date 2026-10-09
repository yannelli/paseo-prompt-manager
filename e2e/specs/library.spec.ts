import { expect, test } from "./fixtures.ts";

test.describe("prompt library", () => {
  test("opens from the sidebar and lists prompts on disk", async ({ app, library }) => {
    await library.seed("code-review", { content: "# Code review\n\nReview the diff for bugs.", description: "Find bugs before merge", tags: ["review"] });
    await app.openLibrary();
    await expect(app.promptRow("Code review")).toBeVisible();
    await expect(app.text("Find bugs before merge")).toBeVisible();
    await expect(app.text("#review")).toBeVisible();
    await expect(app.text(library.directory)).toBeVisible();
  });

  test("creates a prompt with metadata in a new folder", async ({ app, library }) => {
    await app.openLibrary();
    await app.button("New prompt").click();
    await app.showDetails();
    await app.field("Prompt filename").fill("release-notes");
    await app.field("Prompt description").fill("Draft release notes from merged PRs");
    await app.field("Prompt tags").fill("writing, release");
    await app.field("Create editor subfolder").fill("team/docs");
    await app.button("Create folder").click();
    await expect(app.button("Select folder team/docs")).toBeVisible();
    await app.field("Prompt Markdown").fill("# Release notes\n\nSummarize every merged PR since the last tag.");
    await app.save();

    await expect.poll(() => library.read("team/docs/release-notes")).toEqual({
      content: "# Release notes\n\nSummarize every merged PR since the last tag.",
      description: "Draft release notes from merged PRs",
      tags: ["writing", "release"],
    });
    expect(await library.ids()).toEqual(["team/docs/release-notes"]);
    expect(await library.versions("team/docs/release-notes")).toHaveLength(1);
    await app.backToList();
    await expect(app.promptRow("Release notes")).toBeVisible();
  });

  test("rejects a save without content and writes nothing", async ({ app, library }) => {
    await app.openLibrary();
    await app.button("New prompt").click();
    await app.field("Prompt filename").fill("empty");
    await expect(app.text("Content is required to save")).toBeVisible();
    await expect(app.button("Save prompt")).toBeDisabled();
    expect(await library.ids()).toEqual([]);
  });

  test("saves edits as versions and restores an older one", async ({ app, library }) => {
    await library.seed("standup", { content: "# Standup\n\nList what changed yesterday." });
    await app.openLibrary();
    await app.openPrompt("Standup");
    await app.field("Prompt Markdown").fill("# Standup\n\nList what changed yesterday and what is blocked.");
    await expect(app.text("Unsaved changes")).toBeVisible();
    await app.save();
    await expect.poll(async () => (await library.read("standup"))?.content).toBe("# Standup\n\nList what changed yesterday and what is blocked.");
    const saved = await library.versions("standup");
    expect(saved.map((version) => version.content)).toEqual([
      "# Standup\n\nList what changed yesterday.",
      "# Standup\n\nList what changed yesterday and what is blocked.",
    ]);

    await app.button("Version history").click();
    await app.button("Version 1").click();
    await app.button("Restore as new version").click();
    await app.toast("Version restored as a new revision.");
    await expect.poll(async () => (await library.read("standup"))?.content).toBe("# Standup\n\nList what changed yesterday.");
    expect(await library.versions("standup")).toHaveLength(3);
    await expect(app.field("Prompt Markdown")).toHaveValue("# Standup\n\nList what changed yesterday.");
  });

  test("asks before discarding unsaved changes", async ({ app, library }) => {
    await library.seed("triage", { content: "# Triage\n\nLabel new issues." });
    await app.openLibrary();
    await app.openPrompt("Triage");
    await app.field("Prompt Markdown").fill("# Triage\n\nLabel and assign new issues.");
    await app.button("Discard draft").click();
    await expect(app.host.text("Discard unsaved changes?")).toBeVisible();
    await app.dialog.button("Cancel").click();
    await expect(app.field("Prompt Markdown")).toHaveValue("# Triage\n\nLabel and assign new issues.");

    await app.button("Discard draft").click();
    await app.dialog.button("Discard changes").click();
    await expect(app.field("Prompt Markdown")).toHaveValue("# Triage\n\nLabel new issues.");
    expect((await library.read("triage"))?.content).toBe("# Triage\n\nLabel new issues.");
    expect(await library.versions("triage")).toHaveLength(0);
  });

  test("archives a prompt, keeps its history, and restores it", async ({ app, library }) => {
    await library.seed("retro", { content: "# Retro\n\nWhat went well?" });
    await app.openLibrary();
    await app.openPrompt("Retro");
    await app.button("Archive prompt").click();
    await expect(app.host.text("Archive this prompt?")).toBeVisible();
    await app.dialog.button("Archive").click();
    await expect.poll(() => library.read("retro")).toBeNull();
    expect((await library.versions("retro")).map((version) => version.content)).toEqual(["# Retro\n\nWhat went well?"]);
    await app.backToList();
    await expect(app.promptRow("Retro")).toBeHidden();

    await app.button("Archived").click();
    await app.openPrompt("Retro");
    await expect(app.text("This prompt is archived. Restore it to edit or send it.")).toBeVisible();
    await app.button("Restore").click();
    await expect.poll(async () => (await library.read("retro"))?.content).toBe("# Retro\n\nWhat went well?");
  });

  test("filters by search, folder, and tag", async ({ app, library }) => {
    await library.seed("code-review", { content: "# Code review\n\nCheck error handling.", tags: ["review"] });
    await library.seed("writing/blog-post", { content: "# Blog post\n\nOutline a launch post.", tags: ["writing"] });
    await library.seed("writing/changelog", { content: "# Changelog\n\nGroup changes by type.", tags: ["writing", "release"] });
    await app.openLibrary();
    for (const title of ["Code review", "Blog post", "Changelog"]) await expect(app.promptRow(title)).toBeVisible();

    await app.field("Search prompts").fill("launch");
    await expect(app.promptRow("Blog post")).toBeVisible();
    await expect(app.promptRow("Code review")).toBeHidden();
    await expect(app.promptRow("Changelog")).toBeHidden();
    await app.button("Clear search").click();

    await app.button("All folders").click();
    await app.button("Select folder writing").click();
    await expect(app.promptRow("Blog post")).toBeVisible();
    await expect(app.promptRow("Changelog")).toBeVisible();
    await expect(app.promptRow("Code review")).toBeHidden();
    await app.button("Clear filters").click();

    await app.button("release").click();
    await expect(app.promptRow("Changelog")).toBeVisible();
    await expect(app.promptRow("Blog post")).toBeHidden();
    await expect(app.promptRow("Code review")).toBeHidden();
  });

  test("previews Markdown", async ({ app, library }) => {
    await library.seed("checklist", { content: "# Checklist\n\n- **Tests** pass\n- Docs updated" });
    await app.openLibrary();
    await app.openPrompt("Checklist");
    await app.button("Preview").click();
    await expect(app.text("Tests")).toBeVisible();
    await expect(app.text("Docs updated")).toBeVisible();
    await expect(app.field("Prompt Markdown")).toBeHidden();
  });
});
