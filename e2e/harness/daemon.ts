import { execFile, spawn, type ChildProcess } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);

export const repoRoot = resolve(import.meta.dirname, "../..");
export const pluginId = "paseo-prompt-manager";
/** ACP provider backed by `recording-agent.mjs`, which logs every prompt it receives. */
export const recordingProvider = "prompt-e2e";
const serverPackage = join(repoRoot, "node_modules", "@getpaseo", "server");
const cliBin = join(repoRoot, "node_modules", "@getpaseo", "cli", "bin", "paseo");

export interface DaemonOptions {
  /** Interface the daemon binds. Mobile emulators reach the host through it. */
  host?: string;
  port?: number;
  /** Keep the temporary home after stop, for CI artifacts. */
  keep?: boolean;
}

export interface TestDaemon {
  host: string;
  port: number;
  /** `host:port` for the Paseo CLI `--host` option and the app's direct connection form. */
  endpoint: string;
  url: string;
  root: string;
  /** PASEO_HOME of the daemon; the desktop app attaches to the daemon recorded here. */
  home: string;
  /** XDG_CONFIG_HOME of the daemon; the plugin keeps its settings and default library here. */
  configHome: string;
  serverId: string;
  logFile: string;
  cli(args: string[]): Promise<string>;
  stop(): Promise<void>;
}

export async function freePort(): Promise<number> {
  const { promise, resolve: resolvePort, reject } = Promise.withResolvers<number>();
  const server = createServer();
  server.unref();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => (typeof address === "object" && address ? resolvePort(address.port) : reject(new Error("No port"))));
  });
  return promise;
}

/**
 * Starts a Paseo daemon from the pinned `@getpaseo/server` package with its own home, this
 * checkout installed as a directory plugin, relay and speech off, and the recording ACP agent
 * registered as a provider.
 */
export async function startDaemon(options: DaemonOptions = {}): Promise<TestDaemon> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? await freePort();
  const root = await mkdtemp(join(process.env.PROMPT_E2E_TMP ?? tmpdir(), "prompt-e2e-"));
  const home = join(root, "home");
  const configHome = join(root, "config");
  const logFile = join(root, "daemon.log");
  await mkdir(home, { recursive: true });
  await mkdir(configHome, { recursive: true });
  await writeFile(join(home, "config.json"), JSON.stringify({
    version: 1,
    pluginsEnabled: true,
    plugins: { [pluginId]: { source: "directory", path: repoRoot, enabled: true } },
    agents: {
      providers: {
        [recordingProvider]: { extends: "acp", label: "Prompt E2E recorder", command: [process.execPath, join(import.meta.dirname, "recording-agent.mjs")] },
      },
    },
  }, null, 2));

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PASEO_HOME: home,
    PASEO_LISTEN: `${host}:${port}`,
    PASEO_RELAY_ENABLED: "0",
    PASEO_WEB_UI_ENABLED: "1",
    PASEO_CORS_ORIGINS: "*",
    PASEO_DICTATION_ENABLED: "0",
    PASEO_VOICE_MODE_ENABLED: "0",
    PASEO_DICTATION_STT_PROVIDER: "openai",
    PASEO_VOICE_TURN_DETECTION_PROVIDER: "openai",
    PASEO_VOICE_STT_PROVIDER: "openai",
    PASEO_VOICE_TTS_PROVIDER: "openai",
    XDG_CONFIG_HOME: configHome,
    // Git sync commits from the plugin's daemon process; CI runners have no global identity.
    GIT_AUTHOR_NAME: "Prompt E2E",
    GIT_AUTHOR_EMAIL: "prompt-e2e@example.invalid",
    GIT_COMMITTER_NAME: "Prompt E2E",
    GIT_COMMITTER_EMAIL: "prompt-e2e@example.invalid",
  };
  for (const key of ["PASEO_LOCAL_MODELS_DIR", "PASEO_DICTATION_LOCAL_STT_MODEL", "PASEO_VOICE_LOCAL_STT_MODEL", "PASEO_VOICE_LOCAL_TTS_MODEL"]) delete env[key];

  const log = openSync(logFile, "a");
  const child: ChildProcess = spawn(process.execPath, ["dist/scripts/supervisor-entrypoint.js"], {
    cwd: serverPackage, env, stdio: ["ignore", log, log], detached: true,
  });
  let exited: number | null = null;
  child.on("exit", (code) => { exited = code ?? -1; });

  const endpoint = `${host}:${port}`;
  const cli = async (args: string[]) => {
    const { stdout } = await execute(process.execPath, [cliBin, ...args, "--host", endpoint], {
      env: { ...process.env, PASEO_HOME: home }, maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  };

  const stop = async () => {
    if (exited === null && child.pid) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
      for (let i = 0; i < 50 && exited === null; i++) await delay(100);
      if (exited === null) try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
    }
    if (!options.keep && !process.env.PROMPT_E2E_KEEP) await rm(root, { recursive: true, force: true });
  };

  try {
    const deadline = Date.now() + 120_000;
    let status = "";
    while (Date.now() < deadline) {
      if (exited !== null) throw new Error(`Daemon exited with ${exited}`);
      try {
        const plugins = JSON.parse(await cli(["plugin", "ls", "--json"])) as { id: string; status: string; error?: string }[];
        const plugin = plugins.find((entry) => entry.id === pluginId);
        status = plugin?.status ?? "missing";
        if (status === "running") break;
        if (status === "failed" || status === "error") throw new Error(`Plugin failed to load: ${JSON.stringify(plugin)}`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Plugin failed")) throw error;
      }
      await delay(500);
    }
    if (status !== "running") throw new Error(`Plugin did not start (last status: ${status || "daemon unreachable"})`);
    const serverId = (await readFile(join(home, "server-id"), "utf8")).trim();
    return { host, port, endpoint, url: `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`, root, home, configHome, serverId, logFile, cli, stop };
  } catch (error) {
    const tail = (await readFile(logFile, "utf8").catch(() => "")).split("\n").slice(-40).join("\n");
    await stop();
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nDaemon log tail:\n${tail}`, { cause: error });
  }
}
