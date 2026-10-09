import { test as base, expect, type Page } from "@playwright/test";
import { startDaemon, type TestDaemon } from "../harness/daemon.ts";
import { launchDesktop, type DesktopClient } from "../harness/desktop.ts";
import { TestLibrary, createAgent, type TestAgent } from "../harness/library.ts";
import { PromptApp } from "./app.ts";

export interface ClientOptions {
  /** `web` drives the daemon's web UI in Chromium; `desktop` drives the packaged Electron app. */
  client: "web" | "desktop";
}

interface WorkerFixtures {
  daemon: TestDaemon;
  desktop: DesktopClient | null;
}

interface TestFixtures {
  library: TestLibrary;
  app: PromptApp;
  agent: TestAgent;
}

export const test = base.extend<TestFixtures, WorkerFixtures & ClientOptions>({
  client: ["web", { option: true, scope: "worker" }],
  daemon: [async ({}, use) => {
    const daemon = await startDaemon();
    await use(daemon);
    await daemon.stop();
  }, { scope: "worker", timeout: 180_000 }],

  desktop: [async ({ client, daemon }, use) => {
    if (client !== "desktop") return use(null);
    const desktop = await launchDesktop(daemon);
    await use(desktop);
    await desktop.close();
  }, { scope: "worker", timeout: 180_000 }],

  library: async ({ daemon }, use, testInfo) => {
    const library = new TestLibrary(daemon, `${testInfo.project.name}-${testInfo.testId}`);
    await library.activate();
    await use(library);
  },

  agent: async ({ daemon }, use, testInfo) => {
    await use(await createAgent(daemon, `agent-${testInfo.testId}`));
  },

  page: async ({ page, desktop }, use) => {
    await use(desktop ? desktop.page : page);
  },

  app: async ({ page, daemon, desktop, library: _library }, use, testInfo) => {
    const app = new PromptApp(page as Page, daemon, desktop ? desktop.origin : daemon.url, testInfo.project.name.endsWith("compact"));
    await use(app);
    if (testInfo.status !== testInfo.expectedStatus) await testInfo.attach("daemon.log", { path: daemon.logFile, contentType: "text/plain" });
  },
});

export { expect };
