import { receivedTexts } from "../harness/library.ts";
import { expect, test } from "./fixtures.ts";

test.describe("phone layout", () => {
  test.beforeEach(({ app }) => {
    test.skip(!app.compact, "Phone layout only.");
  });

  test("the prompt picker sheet opens tall and reaches every result", async ({ app, agent, library }) => {
    for (let index = 1; index <= 12; index++) {
      await library.seed(`step-${String(index).padStart(2, "0")}`, { content: `# Step ${index}\n\nLine one.\nLine two.\nLine three.` });
    }
    await app.openAgent(agent.id);
    await app.host.button("Send a saved prompt").click();
    await expect(app.picker.button("Send Step 1")).toBeVisible();

    // Regression for #9: the host sized the sheet to a nested list and left it a few rows tall.
    const viewport = app.page.viewportSize()!;
    const picker = (await app.picker.root.boundingBox())!;
    expect(picker.height).toBeGreaterThan(viewport.height * 0.5);

    const last = app.picker.button("Send Step 12");
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await last.click();
    await expect.poll(() => receivedTexts(agent)).toEqual(["Ready for a saved prompt.", "# Step 12\n\nLine one.\nLine two.\nLine three."]);
  });

  test("shows the library header only on the list", async ({ app, library }) => {
    await library.seed("standup", { content: "# Standup\n\nYesterday, today, blockers." });
    await app.openLibrary();
    const subtitle = app.text("Markdown prompts shared across agents on this host.");
    await expect(subtitle).toBeVisible();
    await app.openPrompt("Standup");
    await expect(subtitle).toBeHidden();
    await expect(app.promptRow("Standup")).toBeHidden();
    await app.backToList();
    await expect(subtitle).toBeVisible();

    await app.button("Settings").click();
    await expect(app.text("Library settings")).toBeVisible();
    await expect(subtitle).toBeHidden();
  });

  test("the editor stacks details, Markdown, and history in one column", async ({ app, library }) => {
    await library.seed("long", { content: `# Long\n\n${Array.from({ length: 80 }, (_, index) => `Line ${index + 1}`).join("\n")}` });
    await app.openLibrary();
    await app.openPrompt("Long");
    await app.showDetails();
    await app.button("Version history").click();
    const description = (await app.field("Prompt description").boundingBox())!;
    const editor = (await app.field("Prompt Markdown").boundingBox())!;
    expect(editor.y).toBeGreaterThan(description.y);
    expect(Math.abs(editor.x - description.x)).toBeLessThan(20);
    // History sits below the editor and is reached by scrolling the one column.
    const history = app.text("Version history");
    await history.scrollIntoViewIfNeeded();
    await expect(history).toBeInViewport();
    expect((await history.boundingBox())!.y).toBeGreaterThan((await app.field("Prompt Markdown").boundingBox())!.y);
  });
});
