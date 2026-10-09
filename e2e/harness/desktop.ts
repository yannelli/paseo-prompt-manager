import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { _electron, type ElectronApplication, type Page } from "@playwright/test";
import type { TestDaemon } from "./daemon.ts";

export interface DesktopClient {
  app: ElectronApplication;
  page: Page;
  /** Origin of the renderer, used to build in-app routes. */
  origin: string;
  close(): Promise<void>;
}

/**
 * Launches the packaged Paseo desktop app named by PASEO_DESKTOP_BIN. The app attaches to the
 * running daemon recorded in the test daemon's PASEO_HOME instead of starting its own.
 */
export async function launchDesktop(daemon: TestDaemon): Promise<DesktopClient> {
  const executablePath = process.env.PASEO_DESKTOP_BIN;
  if (!executablePath) throw new Error("Set PASEO_DESKTOP_BIN to the Paseo desktop executable. See docs/e2e.md.");
  const userData = await mkdtemp(join(daemon.root, "electron-"));
  const app = await _electron.launch({
    executablePath,
    args: ["--no-sandbox"],
    env: {
      ...process.env,
      PASEO_HOME: daemon.home,
      PASEO_ELECTRON_USER_DATA_DIR: userData,
      PASEO_DISABLE_SINGLE_INSTANCE_LOCK: "1",
    } as Record<string, string>,
    timeout: 120_000,
  });
  const page = await app.firstWindow({ timeout: 120_000 });
  await page.waitForLoadState("domcontentloaded");
  const origin = new URL(page.url()).origin;
  return {
    app, page, origin: origin === "null" ? "paseo://app" : origin,
    close: async () => {
      await app.close().catch(() => undefined);
      await rm(userData, { recursive: true, force: true });
    },
  };
}
