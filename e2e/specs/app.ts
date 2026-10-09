import { expect, type Locator, type Page } from "@playwright/test";
import type { TestDaemon } from "../harness/daemon.ts";

/** First visible match; the app keeps covered screens mounted. */
function visible(locator: Locator): Locator {
  return locator.filter({ visible: true }).first();
}

/** Accessible-name queries inside one part of the UI. */
export class Scope {
  readonly root: Locator;

  constructor(root: Locator) {
    this.root = root;
  }

  button(name: string | RegExp): Locator {
    return visible(this.root.getByRole("button", { name, exact: typeof name === "string" }));
  }

  field(label: string): Locator {
    return visible(this.root.getByLabel(label, { exact: true }));
  }

  text(value: string | RegExp): Locator {
    return visible(this.root.getByText(value, { exact: typeof value === "string" }));
  }
}

/** Drives the plugin inside a Paseo client. Locators use the plugin's accessibility labels. */
export class PromptApp extends Scope {
  readonly page: Page;
  readonly daemon: TestDaemon;
  readonly origin: string;
  /** True when the client renders the phone layout: drawer sidebar and bottom sheets. */
  readonly compact: boolean;
  /** The whole client window, for host UI such as the sidebar, composer, and toasts. */
  readonly host: Scope;
  /** The prompt picker opened from the composer pill. */
  readonly picker: Scope;
  /** Buttons of the open confirmation dialog. The title renders in the host's sheet header. */
  readonly dialog: Scope;
  private connected = false;

  constructor(page: Page, daemon: TestDaemon, origin: string, compact: boolean) {
    super(visible(page.getByTestId("prompt-library")));
    this.page = page;
    this.daemon = daemon;
    this.origin = origin;
    this.compact = compact;
    this.host = new Scope(page.locator("body"));
    this.picker = new Scope(visible(page.getByTestId("prompt-picker")));
    this.dialog = new Scope(visible(page.getByTestId("prompt-confirm")));
  }

  /**
   * Loads a route. A client that has not registered the daemon yet redirects deep links home,
   * so the first load waits on the home screen until the daemon is in the host registry.
   */
  async goto(path: string) {
    if (!this.connected) {
      await this.page.goto(`${this.origin}/`);
      await this.page.waitForFunction(
        (serverId) => (localStorage.getItem("@paseo:daemon-registry") ?? "").includes(serverId),
        this.daemon.serverId, { timeout: 60_000 },
      );
      this.connected = true;
      if (path === "/") return;
    }
    await this.page.goto(`${this.origin}${path}`);
  }

  /** Opens the library from its sidebar header row, like a user would. */
  async openLibrary() {
    await this.goto("/");
    if (this.compact) await this.host.button("Open menu").click();
    await this.host.button("Prompts").click();
    await expect(this.button("New prompt")).toBeVisible({ timeout: 45_000 });
  }

  async openAgent(agentId: string) {
    await this.goto(`/h/${this.daemon.serverId}/agent/${agentId}`);
    await expect(this.composer()).toBeVisible({ timeout: 45_000 });
  }

  composer(): Locator {
    return visible(this.page.getByRole("textbox", { name: "Message agent..." }));
  }

  /** Phones show the editor in place of the list; desktop layouts show both. */
  async backToList() {
    if (!this.compact) return;
    const back = this.button("Back to library");
    if (await back.isVisible()) await back.click();
    await expect(this.button("New prompt")).toBeVisible();
  }

  promptRow(title: string): Locator {
    return this.button(`Open ${title}`);
  }

  async openPrompt(title: string) {
    await this.promptRow(title).click();
    await expect(this.field("Prompt Markdown")).toBeVisible();
  }

  /** Shows the details fields (description, tags, folder) when they are collapsed. */
  async showDetails() {
    const show = this.button("Show details");
    if (await show.isVisible()) await show.click();
    await expect(this.field("Prompt description")).toBeVisible();
  }

  async save() {
    await this.button("Save prompt").click();
    await expect(this.text("Saved")).toBeVisible();
  }

  async toast(message: string | RegExp) {
    await expect(this.host.text(message)).toBeVisible();
  }
}
