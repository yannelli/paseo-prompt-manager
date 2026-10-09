// Temporary iOS pipeline smoke: harness daemon + seeded prompt + Maestro flow.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { startDaemon } from "../harness/daemon.ts";
import { TestLibrary } from "../harness/library.ts";

const daemon = await startDaemon();
let status = 1;
try {
  const library = new TestLibrary(daemon, "ios-smoke");
  await library.activate();
  await library.seed("smoke", { content: "# Smoke prompt\n\nSmoke body", description: "d" });
  const result = spawnSync(
    "maestro",
    ["test", "-e", `PASEO_E2E_ENDPOINT=${daemon.endpoint}`, "--debug-output", join(import.meta.dirname, "../.results/maestro"), join(import.meta.dirname, "smoke.yaml")],
    { stdio: "inherit" },
  );
  status = result.status ?? 1;
} finally {
  await daemon.stop();
}
process.exit(status);
