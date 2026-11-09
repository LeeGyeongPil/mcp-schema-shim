// A scripted MCP-like stdio server for proxy tests:
// - tools/list is paged (cursor) and exposes tools with names/schemas the tests need
// - tools/call answers with the arguments it received and counts calls
// - every other request is answered with the exact raw line it received (so tests can check pass-through)
import { createInterface } from "node:readline";

const pages = {
  "": {
    tools: [
      { name: "dotted.tool", description: "page one", inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1 } }, required: ["query"] } },
    ],
    nextCursor: "p2",
  },
  p2: {
    tools: [{ name: "second", description: "page two", inputSchema: { type: "object", properties: { n: { type: "integer" } } } }],
  },
};
let calls = 0;

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined) return; // notification
  const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n");
  if (msg.method === "tools/list") return reply(pages[msg.params?.cursor ?? ""]);
  if (msg.method === "tools/call") {
    calls += 1;
    return reply({ content: [{ type: "text", text: JSON.stringify({ name: msg.params.name, arguments: msg.params.arguments }) }] });
  }
  if (msg.method === "test/calls") return reply({ calls });
  reply({ raw: line });
});
