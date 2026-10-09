import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium, type Browser, type Page } from "@playwright/test";
import { freePort, type TestDaemon } from "./daemon.ts";

export interface DesktopClient {
  /** The Paseo desktop process (Electron main). */
  app: ChildProcess;
  page: Page;
  /** Origin of the renderer, used to build in-app routes. */
  origin: string;
  close(): Promise<void>;
}

const RENDERER_ORIGIN = "paseo://app";

function exited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/**
 * Launches the packaged Paseo desktop app named by PASEO_DESKTOP_BIN and drives its renderer over
 * the Chrome DevTools Protocol (packaged builds do not accept Playwright's Node inspector). The app
 * attaches to the running daemon recorded in the test daemon's PASEO_HOME instead of starting its own.
 * Needs a display: run under xvfb-run on headless Linux.
 */
export async function launchDesktop(daemon: TestDaemon): Promise<DesktopClient> {
  const executablePath = process.env.PASEO_DESKTOP_BIN;
  if (!executablePath) throw new Error("Set PASEO_DESKTOP_BIN to the Paseo desktop executable. See docs/e2e.md.");
  const userData = await mkdtemp(join(daemon.root, "electron-"));
  const cdpPort = await freePort();
  const output: string[] = [];
  const app = spawn(executablePath, ["--no-sandbox"], {
    env: {
      ...process.env,
      PASEO_HOME: daemon.home,
      PASEO_ELECTRON_USER_DATA_DIR: userData,
      PASEO_DISABLE_SINGLE_INSTANCE_LOCK: "1",
      PASEO_ELECTRON_FLAGS: `--no-sandbox --remote-debugging-address=127.0.0.1 --remote-debugging-port=${cdpPort}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  for (const stream of [app.stdout, app.stderr]) stream?.on("data", (chunk: Buffer) => {
    output.push(chunk.toString());
    if (output.length > 200) output.shift();
  });

  let browser: Browser | undefined;
  const close = async () => {
    await browser?.close().catch(() => undefined);
    if (app.pid && !exited(app)) {
      try { process.kill(-app.pid, "SIGTERM"); } catch { /* already gone */ }
      const { promise: gone, resolve: done } = Promise.withResolvers<void>();
      app.once("exit", () => done());
      await Promise.race([gone, sleep(10_000)]);
      if (!exited(app)) try { process.kill(-app.pid, "SIGKILL"); } catch { /* already gone */ }
    }
    await rm(userData, { recursive: true, force: true });
  };

  try {
    const deadline = Date.now() + 120_000;
    let page: Page | undefined;
    while (!page) {
      if (exited(app)) throw new Error(`Paseo desktop exited early (${app.exitCode ?? app.signalCode}):\n${output.join("")}`);
      if (Date.now() > deadline) throw new Error(`Timed out waiting for the Paseo desktop renderer:\n${output.join("")}`);
      try {
        browser ??= await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
        page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().startsWith(RENDERER_ORIGIN));
      } catch {
        browser = undefined;
      }
      if (!page) await sleep(500);
    }
    await page.waitForLoadState("domcontentloaded");
    return { app, page, origin: RENDERER_ORIGIN, close };
  } catch (error) {
    await close();
    throw error;
  }
}
