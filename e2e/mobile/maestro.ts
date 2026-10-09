import { spawn } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resetMaestroDriver, stopIosDriver } from "./device.ts";
import { appId, flowsSource, maestroBin, maestroEnv, maestroTarget, platform, resultsDir } from "./config.ts";

const renderedFlows = join(resultsDir, "flows");
const FLOW_TIMEOUT_MS = 4 * 60_000;
let invocations = 0;
export const FLOW_END_LABEL = "e2e-flow-end";
export const FLOW_END_STEP = `- assertTrue:\n    condition: \${true}\n    label: ${FLOW_END_LABEL}`;
export const flowEnded = (output: string): boolean => new RegExp(`${FLOW_END_LABEL}[^\\n]*COMPLETED\\n$`).test(output) && !/FAILED|Exception/.test(output);
let reinstallDriver = true;

/** Copies the flows next to the results, pointing them at the app id under test. */
export async function renderFlows(): Promise<void> {
  await rm(resultsDir, { recursive: true, force: true });
  await mkdir(resultsDir, { recursive: true });
  await cp(flowsSource, renderedFlows, { recursive: true });
  for (const entry of await readdir(renderedFlows, { recursive: true })) {
    if (!entry.endsWith(".yaml")) continue;
    const file = join(renderedFlows, entry);
    let source = (await readFile(file, "utf8")).replace(/^appId: sh\.paseo$/m, `appId: ${appId}`);
    // Every flow ends with a labelled step, so a Maestro that hangs on shutdown can be told from one that stalled midway.
    if (!entry.startsWith("lib/")) source = `${source.trimEnd()}\n${FLOW_END_STEP}\n`;
    await writeFile(file, source);
  }
}

/**
 * Runs one Maestro flow against the connected device. Maestro keeps its debug output, screenshots,
 * and command log under the results folder. Rejects with the tail of Maestro's output when the flow fails.
 */
export async function runFlow(name: string, label: string, env: Record<string, string>): Promise<void> {
  // A flow that launches the app itself can run again from the start; one that continues a screen cannot.
  const restartable = /launchApp|lib\/(launch|open-library|open-agent)\.yaml/.test(await readFile(join(renderedFlows, name), "utf8"));
  try {
    await attemptFlow(name, label, env);
  } catch (error) {
    if (!restartable) throw error;
    await resetMaestroDriver();
    reinstallDriver = true;
    await attemptFlow(name, `${label}-retry`, env);
  }
}

async function attemptFlow(name: string, label: string, env: Record<string, string>): Promise<void> {
  const out = join(resultsDir, "runs", `${String(++invocations).padStart(3, "0")}-${label}`);
  await mkdir(out, { recursive: true });
  const args = [
    ...maestroTarget(), "--no-ansi", "test", join(renderedFlows, name),
    "--debug-output", join(out, "debug"), "--flatten-debug-output", "--test-output-dir", join(out, "output"),
    // The driver apps stay installed after the first successful run.
    ...(reinstallDriver ? [] : ["--no-reinstall-driver"]),
    ...Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
  ];
  const log: string[] = [];
  const child = spawn(maestroBin, args, { env: maestroEnv(), cwd: out, stdio: ["ignore", "pipe", "pipe"] });
  let lastData = Date.now();
  const collect = (chunk: Buffer) => {
    log.push(chunk.toString());
    lastData = Date.now();
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const timer = setTimeout(() => child.kill("SIGKILL"), FLOW_TIMEOUT_MS);
  // On iOS Maestro sometimes never exits after its last command, while it stops the XCUITest driver.
  // The sentinel step is the last one of every flow, so its finished line at the end of the output
  // means the flow passed and only the shutdown hangs. A flow that stalls earlier never gets there.
  // The driver is also given 150 s to print its first line; a start that never answers is killed early.
  let hungAfterFlow = false;
  let killedByUs = false;
  const startedAt = Date.now();
  const watchdog = platform === "ios"
    ? setInterval(() => {
      const text = log.join("");
      if (Date.now() - lastData > 45_000 && flowEnded(text)) {
        hungAfterFlow = true;
        killedByUs = true;
        child.kill("SIGKILL");
      } else if (!text && Date.now() - startedAt > 150_000) {
        killedByUs = true;
        child.kill("SIGKILL");
      }
    }, 5_000)
    : undefined;
  let code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  }).finally(() => {
    clearTimeout(timer);
    clearInterval(watchdog);
  });
  if (hungAfterFlow) {
    code = 0;
    log.push("\n[e2e] Maestro finished the flow but did not exit; stopped it.\n");
  }
  if (platform === "ios" && (killedByUs || code === null)) await stopIosDriver();
  reinstallDriver = code !== 0;
  const output = log.join("");
  await writeFile(join(out, "maestro.log"), `maestro ${args.join(" ")}\n\n${output}`);
  if (code !== 0) {
    throw new Error(`Maestro flow ${name} failed on ${platform} (exit ${code}). Output in ${out}\n${output.split("\n").slice(-60).join("\n")}`);
  }
}
