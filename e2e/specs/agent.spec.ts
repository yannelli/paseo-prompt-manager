import { receivedPrompts, receivedTexts } from "../harness/library.ts";
import { expect, test } from "./fixtures.ts";

const CODE_REVIEW = "# Code review\n\nReview the diff for bugs, missing tests, and unclear names.";

test.describe("sending prompts to agents", () => {
  test.beforeEach(async ({ library }) => {
    await library.seed("code-review", { content: CODE_REVIEW, description: "Pre-merge review", tags: ["review"] });
    await library.seed("writing/summary", { content: "# Summary\n\nSummarize this thread in three bullets." });
  });

  test("composer pill searches and sends a saved prompt", async ({ app, agent }) => {
    await app.openAgent(agent.id);
    await app.host.button("Send a saved prompt").click();
    await expect(app.picker.button("Send Code review")).toBeVisible();
    await expect(app.picker.button("Send Summary")).toBeVisible();

    await app.picker.field("Search saved prompts").fill("thread");
    await expect(app.picker.button("Send Summary")).toBeVisible();
    await expect(app.picker.button("Send Code review")).toBeHidden();
    await app.picker.field("Search saved prompts").fill("review");
    await app.picker.button("Send Code review").click();

    await app.toast('Sent "Code review".');
    await expect(app.picker.root).toBeHidden();
    await expect.poll(() => receivedTexts(agent)).toEqual(["Ready for a saved prompt.", CODE_REVIEW]);
  });

  test("/prompt sends a saved prompt by ID", async ({ app, agent }) => {
    await app.openAgent(agent.id);
    await app.composer().fill("/prompt writing/summary");
    await app.host.button("Send message").click();
    await expect.poll(() => receivedTexts(agent)).toEqual(["Ready for a saved prompt.", "# Summary\n\nSummarize this thread in three bullets."]);
  });

  test("/prompt reports unknown and archived prompts without sending", async ({ app, agent, library }) => {
    await library.seed("old", { content: "# Old\n\nRetired." });
    await app.openLibrary();
    await app.openPrompt("Old");
    await app.button("Archive prompt").click();
    await app.dialog.button("Archive").click();
    await expect.poll(() => library.read("old")).toBeNull();

    await app.openAgent(agent.id);
    await app.composer().fill("/prompt old");
    await app.host.button("Send message").click();
    await app.toast("This prompt is archived. Restore it from the library first.");
    await app.composer().fill("/prompt");
    await app.host.button("Send message").click();
    await app.toast("Enter a prompt ID, for example /prompt code-review. Use /prompts to browse.");
    expect(await receivedTexts(agent)).toEqual(["Ready for a saved prompt."]);
  });

  test("/prompts opens the agent panel, which sends the selected prompt", async ({ app, agent }) => {
    await app.openAgent(agent.id);
    await app.composer().fill("/prompts");
    await app.host.button("Send message").click();
    await expect(app.text("Save instructions and send them to this agent.")).toBeVisible();
    await app.openPrompt("Code review");
    await app.button("Send saved prompt to agent").click();
    await expect.poll(() => receivedTexts(agent)).toEqual(["Ready for a saved prompt.", CODE_REVIEW]);
  });

  test("the attachment menu attaches a saved prompt to a message", async ({ app, agent }) => {
    await app.openAgent(agent.id);
    await app.host.button("Add attachment").click();
    await app.page.getByRole("menuitem", { name: "Attach Saved prompt" }).click();
    await app.page.keyboard.type("review");
    await app.host.text("Code review").click();
    await expect(app.page.getByTestId("composer-plugin-resource-attachment-pill").filter({ visible: true })).toHaveCount(1);
    await app.composer().fill("Use the attached checklist.");
    await app.host.button("Send message").click();
    await expect.poll(async () => (await receivedPrompts(agent)).length).toBe(2);
    const [blocks] = (await receivedPrompts(agent)).slice(-1);
    expect(blocks[0]).toEqual({ type: "text", text: "Use the attached checklist." });
    expect(blocks.slice(1).map((block) => block.text ?? "").join("\n")).toContain(CODE_REVIEW);
  });

  for (const [item, expected] of [["Open prompt library", "Markdown prompts shared across agents on this host."], ["Use saved prompts", "Save instructions and send them to this agent."]] as const) {
    test(`the Command Center item "${item}" opens the plugin`, async ({ app, agent }) => {
      test.skip(app.compact, "Phones have no Command Center shortcut in the sidebar.");
      // Plugin items need a host route; the agent screen also enables agent items.
      await app.openAgent(agent.id);
      await app.page.getByTestId("sidebar-search").filter({ visible: true }).first().click();
      await app.page.getByTestId("command-center-input").filter({ visible: true }).first().fill("prompt");
      await app.host.text(item).click();
      await expect(app.text(expected)).toBeVisible();
    });
  }
});
