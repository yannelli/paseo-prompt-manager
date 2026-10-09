// Temporary iOS pipeline smoke: harness daemon + seeded prompt + Maestro flow.
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
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
    ["test", "-e", "HOST=127.0.0.1", "-e", `PORT=${daemon.port}`, "--debug-output", join(import.meta.dirname, "../.results/maestro"), join(import.meta.dirname, "smoke.yaml")],
    { stdio: "inherit", },
  );
  status = result.status ?? 1;
  // Exploration: capture the iOS view hierarchy with and without the keyboard.
  const results = join(import.meta.dirname, "../.results/probe");
  const run = (args: string[]) => spawnSync("maestro", args, { encoding: "utf8", env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: "1" } });
  await mkdir(results, { recursive: true });
  const sh = (name: string, cmd: string) => writeFile(join(results, name), String(spawnSync("bash", ["-c", cmd], { encoding: "utf8" }).stdout));
  await sh("launchctl-after-flow.txt", "xcrun simctl spawn booted launchctl list | grep -i -E 'paseo|UIKitApplication' ; date");
  await sh("crash-reports.txt", "ls -la ~/Library/Logs/DiagnosticReports/ 2>&1; ls -la /Users/runner/Library/Logs/DiagnosticReports/Retired 2>&1");
  const first = run(["hierarchy"]);
  await writeFile(join(results, "hierarchy-before.json"), `${first.stdout}\n---stderr---\n${first.stderr}`);
  await sh("launchctl-after-hierarchy.txt", "xcrun simctl spawn booted launchctl list | grep -i -E 'paseo|UIKitApplication'");
  await writeFile(join(results, "probe-flow.txt"), String(run(["test", "--debug-output", join(results, "probe-debug"), join(import.meta.dirname, "probe.yaml")]).stdout));
  await writeFile(join(results, "hierarchy-keyboard.json"), run(["hierarchy"]).stdout);
  spawnSync("xcrun", ["simctl", "io", "booted", "screenshot", join(results, "keyboard.png")]);
} finally {
  await daemon.stop();
}
process.exit(status);
