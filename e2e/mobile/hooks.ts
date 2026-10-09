import { createServer, type Server } from "node:http";
import { selectAll } from "./device.ts";

/** Device actions that flows trigger over HTTP (`http.get` in `evalScript`) because Maestro has no command for them. */
const actions: Record<string, () => Promise<void>> = {
  "/select-all": selectAll,
};

let server: Server | undefined;

/** Starts the hook server on a free local port and returns the port for the flows' HOOK_PORT variable. */
export async function startHooks(): Promise<number> {
  server = createServer((request, response) => {
    const action = actions[request.url ?? ""];
    if (!action) {
      response.writeHead(404).end("unknown hook");
      return;
    }
    action().then(
      () => response.writeHead(200).end("ok"),
      (error: unknown) => response.writeHead(500).end(String(error)),
    );
  });
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => resolve((server!.address() as { port: number }).port));
  return promise;
}

export async function stopHooks(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  if (!server) return;
  server.close(() => resolve());
  server.closeAllConnections();
  await promise;
}
