// Tiny line-based MCP stdio server for the `check` server-mode tests (no SDK).
// Usage: node check-server.mjs [ok|silent|exit|rpc-error]
import { createInterface } from "node:readline";

const mode = process.argv[2] ?? "ok";
const log = (text) => process.stderr.write("check-server[" + mode + "]: " + text + "\n");
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");

const pageOne = [
  {
    name: "find_items",
    description: "Find items",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer" } }, required: ["query"] },
  },
];
const pageTwo = [
  {
    name: "list_labels",
    description: "List labels",
    inputSchema: { type: "object", properties: { page: { type: "integer" } }, required: [] },
  },
];

if (mode === "silent") {
  // Ignore SIGTERM and never answer: only SIGKILL stops this process.
  process.on("SIGTERM", () => log("ignoring SIGTERM"));
  setInterval(() => undefined, 1000);
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  log("got " + msg.method);
  if (mode === "silent" || msg.id === undefined) return;
  if (msg.method === "initialize") {
    if (mode === "exit") process.exit(3);
    send({ id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "check-server", version: "0.0.1" } } });
  } else if (msg.method === "tools/list") {
    if (mode === "rpc-error") return send({ id: msg.id, error: { code: -32603, message: "listing failed" } });
    if (msg.params?.cursor === "page-2") send({ id: msg.id, result: { tools: pageTwo } });
    else send({ id: msg.id, result: { tools: pageOne, nextCursor: "page-2" } });
  }
});
