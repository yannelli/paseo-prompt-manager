import { defineConfig } from "@playwright/test";
import type { ClientOptions } from "./e2e/specs/fixtures.ts";

const ci = Boolean(process.env.CI);

export default defineConfig<ClientOptions>({
  testDir: "e2e/specs",
  outputDir: "e2e/.results/artifacts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Each worker owns one daemon and runs one test at a time; every test gets its own library and agent.
  fullyParallel: true,
  workers: ci ? 2 : 3,
  retries: ci ? 1 : 0,
  forbidOnly: ci,
  reporter: ci ? [["list"], ["html", { outputFolder: "e2e/.results/report", open: "never" }], ["github"]] : [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
  },
  projects: [
    { name: "web", use: { client: "web", viewport: { width: 1280, height: 800 } } },
    { name: "web-compact", use: { client: "web", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "desktop", use: { client: "desktop" } },
  ],
});
