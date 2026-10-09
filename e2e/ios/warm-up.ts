// Starts Maestro's iOS driver and launches the app once, before the suite, and retries on a stuck driver.
// The first Maestro start on a fresh CI simulator sometimes never answers; recovering here keeps that out of the tests.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { maestroBin, maestroEnv, maestroTarget } from "../mobile/config.ts";
import { rebootSimulator, stopIosDriver } from "../mobile/device.ts";
import { flowEnded } from "../mobile/maestro.ts";

const ATTEMPTS = 2;
const ATTEMPT_TIMEOUT_MS = 12 * 60_000;

async function attempt(): Promise<boolean> {
  const child = spawn(maestroBin, [...maestroTarget(), "--no-ansi", "test", join(import.meta.dirname, "warm-up.yaml")], { env: maestroEnv(), stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let lastData = Date.now();
  const collect = (chunk: Buffer) => {
    output += chunk.toString();
    process.stdout.write(chunk);
    lastData = Date.now();
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const started = Date.now();
  const exited = new Promise<number | null>((resolve) => child.on("close", resolve));
  let finished = false;
  while (true) {
    const winner = await Promise.race([exited, sleep(5_000).then(() => "tick" as const)]);
    if (winner !== "tick") return winner === 0;
    // Maestro can hang while stopping the driver after its last command; see e2e/mobile/maestro.ts.
    if (Date.now() - lastData > 45_000 && flowEnded(output)) finished = true;
    if (finished || Date.now() - started > ATTEMPT_TIMEOUT_MS) {
      child.kill("SIGKILL");
      await exited;
      return finished;
    }
  }
}

for (let index = 1; index <= ATTEMPTS; index++) {
  console.log(`Warm-up attempt ${index}/${ATTEMPTS}`);
  if (await attempt()) {
    await stopIosDriver();
    process.exit(0);
  }
  await rebootSimulator();
}
console.error("Maestro's iOS driver never became usable on this simulator.");
process.exit(1);
