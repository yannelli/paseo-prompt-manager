import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import type { TestDaemon } from "../harness/daemon.ts";
import { appId, maestroBin, maestroEnv, maestroTarget, platform, resultsDir, target } from "./config.ts";

const execute = promisify(execFile);

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface UiNode {
  id: string;
  text: string;
  label: string;
  hint: string;
  focused: boolean;
  bounds: Bounds | null;
}

async function adb(args: string[], timeout = 60_000): Promise<string> {
  const serial = target.serial ? ["-s", target.serial] : [];
  const { stdout } = await execute("adb", [...serial, ...args], { timeout, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/** Host and port the app's direct connection form takes. The Android emulator reaches the daemon through `adb reverse`. */
export function appEndpoint(daemon: TestDaemon): { HOST: string; PORT: string } {
  return { HOST: "127.0.0.1", PORT: String(daemon.port) };
}

/**
 * Makes the daemon reachable from the device and, when PROMPT_E2E_APP_PATH is set, installs the app.
 * Android: `adb reverse`, optional `adb install`. iOS simulators share the host network.
 */
export async function prepareDevice(daemon: TestDaemon): Promise<void> {
  const appPath = process.env.PROMPT_E2E_APP_PATH;
  if (platform === "android") {
    if (!target.serial) {
      const devices = (await adb(["devices"])).split("\n").slice(1).map((line) => line.split("\t")).filter(([, state]) => state?.trim() === "device");
      if (!devices.length) throw new Error("No Android device or emulator is connected (adb devices is empty).");
      target.serial = devices[0][0];
    }
    await adb(["reverse", `tcp:${daemon.port}`, `tcp:${daemon.port}`]);
    // Show the soft keyboard even though the emulator reports a hardware keyboard.
    await adb(["shell", "settings", "put", "secure", "show_ime_with_hard_keyboard", "1"]);
    if (appPath) await adb(["install", "-r", "-g", "-t", appPath], 600_000);
    const installed = await adb(["shell", "pm", "list", "packages", appId]);
    if (!installed.split("\n").some((line) => line.trim() === `package:${appId}`)) {
      throw new Error(`${appId} is not installed on the device. Installed: ${installed.trim() || "(none)"}`);
    }
  } else if (appPath) {
    await execute("xcrun", ["simctl", "install", target.serial ?? "booted", appPath], { timeout: 600_000 });
  }
}

/** Screen size in pixels, the same coordinate space as the bounds Maestro reports. */
export async function screenSize(): Promise<{ width: number; height: number }> {
  if (platform !== "android") throw new Error("screenSize is implemented for Android only.");
  const out = await adb(["shell", "wm", "size"]);
  const override = /Override size: (\d+)x(\d+)/.exec(out) ?? /Physical size: (\d+)x(\d+)/.exec(out);
  if (!override) throw new Error(`Cannot read the screen size from: ${out}`);
  return { width: Number(override[1]), height: Number(override[2]) };
}

/** Text that appeared in the Maestro view hierarchy attributes of `node`. */
function nodeFrom(attributes: Record<string, unknown>): UiNode {
  const text = (key: string) => (typeof attributes[key] === "string" ? (attributes[key] as string) : "");
  const bounds = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(text("bounds"));
  return {
    id: text("resource-id"),
    text: text("text"),
    label: text("accessibilityText") || text("content-desc"),
    hint: text("hintText"),
    focused: attributes.focused === true || attributes.focused === "true",
    bounds: bounds ? { left: Number(bounds[1]), top: Number(bounds[2]), right: Number(bounds[3]), bottom: Number(bounds[4]) } : null,
  };
}

function collect(value: unknown, into: UiNode[]) {
  if (Array.isArray(value)) return value.forEach((entry) => collect(entry, into));
  if (!value || typeof value !== "object") return;
  const record = value as { attributes?: Record<string, unknown>; children?: unknown };
  if (record.attributes && typeof record.attributes === "object") into.push(nodeFrom(record.attributes));
  collect(record.children, into);
}

/** Flat list of the nodes on screen, from `maestro hierarchy`. The raw dump lands in the results folder. */
export async function hierarchy(label: string): Promise<UiNode[]> {
  const args = [...maestroTarget(), "hierarchy"];
  const { stdout } = await execute(maestroBin, args, { env: maestroEnv(), timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  const start = stdout.indexOf("{");
  if (start < 0) throw new Error(`maestro hierarchy printed no JSON:\n${stdout.slice(0, 2000)}`);
  const raw = stdout.slice(start);
  await mkdir(join(resultsDir, "checks"), { recursive: true });
  await writeFile(join(resultsDir, "checks", `${label}.hierarchy.json`), raw);
  const nodes: UiNode[] = [];
  collect(JSON.parse(raw), nodes);
  return nodes;
}

/** First node whose resource id, label, text, or hint equals `name`. */
export function find(nodes: UiNode[], name: string): UiNode | undefined {
  return nodes.find((node) => node.id === name || node.label === name || node.text === name || node.hint === name);
}

async function dump(label: string, args: string[]): Promise<string> {
  const out = await adb(args);
  await mkdir(join(resultsDir, "checks"), { recursive: true });
  await writeFile(join(resultsDir, "checks", `${label}.txt`), out);
  return out;
}

/** Whether the soft keyboard is up, from `dumpsys input_method`. Null where the platform has no such check. */
export async function keyboardShown(label: string): Promise<boolean | null> {
  if (platform !== "android") return null;
  const out = await dump(`${label}.input_method`, ["shell", "dumpsys", "input_method"]);
  const shown = /mInputShown=(true|false)/.exec(out);
  if (shown) return shown[1] === "true";
  const visible = /mImeWindowVis=(?:0x)?([0-9a-f]+)/i.exec(out);
  if (visible) return (parseInt(visible[1], 16) & 0x2) !== 0;
  throw new Error(`dumpsys input_method reports neither mInputShown nor mImeWindowVis (${label}).`);
}

/** Polls until the keyboard reaches the wanted state. */
export async function waitForKeyboard(want: boolean, label: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: boolean | null = null;
  while (Date.now() < deadline) {
    last = await keyboardShown(label);
    if (last === null || last === want) return;
    await sleep(500);
  }
  throw new Error(`Expected the keyboard to be ${want ? "shown" : "hidden"} but dumpsys input_method says ${last}.`);
}

/** Top edge of the soft keyboard in screen pixels, from the InputMethod window frame. */
export async function keyboardTop(label: string): Promise<number> {
  if (platform !== "android") throw new Error("keyboardTop is implemented for Android only.");
  const out = await dump(`${label}.windows`, ["shell", "dumpsys", "window", "windows"]);
  const lines = out.split("\n");
  const start = lines.findIndex((line) => /^\s*Window #\d+ Window\{[^}]*InputMethod\}/.test(line));
  if (start < 0) throw new Error(`No InputMethod window in dumpsys window (${label}).`);
  const block: string[] = [];
  for (let index = start + 1; index < lines.length && !/^\s*Window #\d+ Window\{/.test(lines[index]); index++) block.push(lines[index]);
  const text = block.join("\n");
  const frame = /Frames:[^\n]*?\bframe=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(text)
    ?? /\bmFrame=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(text)
    ?? /\bframe=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(text);
  if (!frame) throw new Error(`Cannot find the InputMethod frame in dumpsys window (${label}):\n${text.slice(0, 1500)}`);
  return Number(frame[2]);
}
