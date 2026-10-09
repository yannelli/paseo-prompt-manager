import { join } from "node:path";
import { repoRoot } from "../harness/daemon.ts";

export type Platform = "android" | "ios";

const requested = process.env.PROMPT_E2E_PLATFORM ?? "android";
if (requested !== "android" && requested !== "ios") throw new Error(`PROMPT_E2E_PLATFORM must be android or ios, got "${requested}".`);

/** Platform under test. The Android and iOS tracks run the same flows and checks. */
export const platform: Platform = requested;
/** Bundle or package id of the installed Paseo app. */
export const appId = process.env.PROMPT_E2E_APP_ID ?? "sh.paseo";
/** Maestro CLI executable. */
export const maestroBin = process.env.MAESTRO_BIN ?? "maestro";
export const resultsDir = join(repoRoot, "e2e", ".results", "mobile");
export const flowsSource = join(import.meta.dirname, "flows");

/** The device under test: adb serial or simulator UDID. Filled in from `adb devices` when unset on Android. */
export const target: { serial: string | undefined } = { serial: process.env.PROMPT_E2E_DEVICE || undefined };

// The iOS XCUITest driver is built and launched by xcodebuild on every Maestro start; a loaded CI Mac can take longer than the default 120 s.
export const maestroEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  MAESTRO_CLI_NO_ANALYTICS: "1",
  MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: "true",
  ...(platform === "ios" ? { MAESTRO_DRIVER_STARTUP_TIMEOUT: "240000" } : {}),
});

/** Global Maestro options that select the device. */
export const maestroTarget = (): string[] => ["--platform", platform, ...(target.serial ? ["--udid", target.serial] : [])];
