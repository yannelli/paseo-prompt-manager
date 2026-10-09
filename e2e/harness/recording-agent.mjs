#!/usr/bin/env node
// A minimal Agent Client Protocol agent for E2E tests. It records every prompt it receives to
// `<session cwd>/.received.jsonl` and answers each turn with a short message. Tests read the file
// to check exactly what a Paseo client sent, including attachments.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const sessions = new Map();
let nextSession = 0;

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

function handle(method, params) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: params?.protocolVersion ?? 1,
        agentCapabilities: { loadSession: false, promptCapabilities: { image: false, audio: false, embeddedContext: true } },
        authMethods: [],
        agentInfo: { name: "prompt-e2e-recorder", version: "1.0.0" },
      };
    case "session/new": {
      const sessionId = `prompt-e2e-${process.pid}-${++nextSession}`;
      sessions.set(sessionId, params.cwd);
      return { sessionId };
    }
    case "session/prompt": {
      const cwd = sessions.get(params.sessionId);
      if (!cwd) throw Object.assign(new Error(`Unknown session ${params.sessionId}`), { code: -32602 });
      appendFileSync(join(cwd, ".received.jsonl"), `${JSON.stringify({ prompt: params.prompt })}\n`);
      send({ method: "session/update", params: { sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Received." } } } });
      return { stopReason: "end_turn" };
    }
    case "session/set_mode":
    case "session/set_model":
    case "session/set_config_option":
      return {};
    default:
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  }
}

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  const message = JSON.parse(line);
  // Notifications (session/cancel) and responses need no reply.
  if (message.id === undefined || !message.method) continue;
  try {
    send({ id: message.id, result: handle(message.method, message.params) });
  } catch (error) {
    send({ id: message.id, error: { code: error.code ?? -32603, message: error.message } });
  }
}
