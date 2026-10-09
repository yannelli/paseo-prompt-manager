import { spawn } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { appId, flowsSource, maestroBin, maestroEnv, maestroTarget, platform, resultsDir } from "./config.ts";

const renderedFlows = join(resultsDir, "flows");
const FLOW_TIMEOUT_MS = 6 * 60_000;
let invocations = 0;

/** Copies the flows next to the results, pointing them at the app id under test. */
export async function renderFlows(): Promise<void> {
  await rm(resultsDir, { recursive: true, force: true });
  await mkdir(resultsDir, { recursive: true });
  await cp(flowsSource, renderedFlows, { recursive: true });
  if (appId === "sh.paseo") return;
  for (const entry of await readdir(renderedFlows, { recursive: true })) {
    if (!entry.endsWith(".yaml")) continue;
    const file = join(renderedFlows, entry);
    await writeFile(file, (await readFile(file, "utf8")).replace(/^appId: sh\.paseo$/m, `appId: ${appId}`));
  }
}

/**
 * Runs one Maestro flow against the connected device. Maestro keeps its debug output, screenshots,
 * and command log under the results folder. Rejects with the tail of Maestro's output when the flow fails.
 */
export async function runFlow(name: string, label: string, env: Record<string, string>): Promise<void> {
  const out = join(resultsDir, "runs", `${String(++invocations).padStart(3, "0")}-${label}`);
  await mkdir(out, { recursive: true });
  const args = [
    ...maestroTarget(), "--no-ansi", "test", join(renderedFlows, name),
    "--debug-output", join(out, "debug"), "--flatten-debug-output", "--test-output-dir", join(out, "output"),
    // The driver apps stay installed after the first run.
    ...(invocations > 1 ? ["--no-reinstall-driver"] : []),
    ...Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
  ];
  const log: string[] = [];
  const child = spawn(maestroBin, args, { env: maestroEnv(), cwd: out, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk: Buffer) => log.push(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => log.push(chunk.toString()));
  const timer = setTimeout(() => child.kill("SIGKILL"), FLOW_TIMEOUT_MS);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  }).finally(() => clearTimeout(timer));
  const output = log.join("");
  await writeFile(join(out, "maestro.log"), `maestro ${args.join(" ")}\n\n${output}`);
  if (code !== 0) {
    throw new Error(`Maestro flow ${name} failed on ${platform} (exit ${code}). Output in ${out}\n${output.split("\n").slice(-60).join("\n")}`);
  }
}
