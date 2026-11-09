import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ProfileId } from "../src/index.js";
import { startProxy } from "../src/proxy/proxy.js";
import { LineReader } from "../src/proxy/jsonrpc.js";
import { connectServer, RpcClient } from "../src/rpc-client.js";

const file = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));
const V1 = file("../examples/server-v1.mjs");
const V2 = file("../examples/server-v2.mjs");
const FAKE = file("./helpers/fake-server.mjs");

/** Start the proxy in-process in front of a real server and return a connected client. */
async function withProxy(serverFile: string, profile: ProfileId): Promise<{ client: RpcClient; logs: string[]; close: () => Promise<void> }> {
  const input = new PassThrough();
  const output = new PassThrough();
  const logs: string[] = [];
  const proxy = startProxy({ profile, command: process.execPath, args: [serverFile], input, output, log: (l) => logs.push(l) });
  const client = new RpcClient(output, input);
  await client.initialize();
  return {
    client,
    logs,
    close: async () => {
      input.end();
      client.close();
      await proxy.exit;
    },
  };
}

async function callText(client: RpcClient, name: string, args: unknown): Promise<{ isError: boolean; text: string }> {
  const r = await client.request("tools/call", { name, arguments: args as Record<string, unknown> });
  const content = r.content as { text: string }[];
  return { isError: r.isError === true, text: content[0].text };
}

const NULLS = { query: "bug", limit: null, state: null, since: null, filters: null, sort: null };

describe.each([
  ["v1", V1],
  ["v2", V2],
])("%s server end to end", (label, serverFile) => {
  // AC-6 (v1) / AC-7 (v2)
  it(label + " server: null optionals fail direct, pass via proxy", async () => {
    const direct = connectServer(process.execPath, [serverFile]);
    const shim = await withProxy(serverFile, "openai-strict");
    try {
      await direct.client.initialize();
      const rejected = await callText(direct.client, "search_issues", NULLS);
      expect(rejected.isError).toBe(true);
      // v1 prefixes the JSON-RPC code (MCP error -32602); v2 reports the failure only as an isError tool
      // result ("Input validation error: ...") without the code string.
      if (label === "v1") expect(rejected.text).toContain("-32602");
      else expect(rejected.text).toContain("Input validation error");
      expect(rejected.text).toContain("received null");

      // Like any MCP client, list the tools first: that is when the proxy learns the transform map.
      const tools = (await shim.client.request("tools/list")).tools as { name: string; inputSchema: Record<string, unknown> }[];
      const accepted = await callText(shim.client, "search_issues", NULLS);
      expect(accepted.isError).toBe(false);
      expect(accepted.text).toBe('{"query":"bug"}');

      const schema = tools.find((t) => t.name === "search_issues")!.inputSchema;
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toEqual(["query", "limit", "state", "since", "filters", "sort"]);
    } finally {
      await shim.close();
      await direct.close();
    }
  });

  it(label + " server: gemini-parameters drops $schema", async () => {
    const shim = await withProxy(serverFile, "gemini-parameters");
    try {
      const tools = (await shim.client.request("tools/list")).tools as { name: string; inputSchema: Record<string, unknown> }[];
      for (const t of tools) expect(t.inputSchema).not.toHaveProperty("$schema");
      const state = (tools[0].inputSchema.properties as Record<string, Record<string, unknown>>).state;
      expect(state.const).toBeUndefined();
      expect(state.enum).toEqual(["open"]);
      // The model sends the enum value; the server gets the original arguments.
      expect((await callText(shim.client, "search_issues", { query: "x", state: "open" })).text).toBe('{"query":"x","state":"open"}');
    } finally {
      await shim.close();
    }
  });
});

describe("proxy behaviour", () => {
  // AC-8
  it("passthrough, name mapping and restore errors", async () => {
    const shim = await withProxy(V1, "anthropic-strict");
    const direct = connectServer(process.execPath, [V1]);
    try {
      await direct.client.initialize();
      // ping and unknown methods behave exactly like the bare server.
      expect(await shim.client.request("ping")).toEqual(await direct.client.request("ping"));
      const viaShim = await shim.client.request("no/such/method").catch((e: Error & { code?: number }) => e);
      const bare = await direct.client.request("no/such/method").catch((e: Error & { code?: number }) => e);
      expect((viaShim as { code?: number }).code).toBe(-32601);
      expect((viaShim as Error).message).toBe((bare as Error).message);

      // The dotted name is exposed with an allowed name and mapped back on call.
      const names = ((await shim.client.request("tools/list")).tools as { name: string }[]).map((t) => t.name);
      expect(names).toContain("issues_search");
      expect(names).not.toContain("issues.search");
      const ok = await callText(shim.client, "issues_search", { query: "x" });
      expect(ok).toEqual({ isError: false, text: '{"query":"x"}' });

      // Arguments that break the ORIGINAL schema never reach the server.
      const bad = await callText(shim.client, "issues_search", { query: "" });
      expect(bad.isError).toBe(true);
      expect(bad.text).toContain("/query");
      expect(shim.logs.some((l) => l.includes("rejected before reaching the server"))).toBe(true);
    } finally {
      await shim.close();
      await direct.close();
    }
  });

  it("forwards unchanged lines byte for byte and does not call the server for rejected calls", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const proxy = startProxy({ profile: "anthropic-strict", command: process.execPath, args: [FAKE], input, output });
    const client = new RpcClient(output, input);
    try {
      const odd = '{ "jsonrpc":"2.0",  "id": 99, "method":"custom/odd",\t"params": {"b":1,"a":[1, 2]} }';
      input.write(odd + "\n");
      await new Promise((r) => setTimeout(r, 300));
      const result = await client.request("test/calls");
      expect(result.calls).toBe(0);

      // paged tools/list: both pages are transformed and both tools are callable under their exposed names
      const first = await client.request("tools/list");
      expect((first.tools as { name: string }[])[0].name).toBe("dotted_tool");
      expect(first.nextCursor).toBe("p2");
      const second = await client.request("tools/list", { cursor: "p2" });
      expect((second.tools as { name: string }[])[0].name).toBe("second");

      const ok = await client.request("tools/call", { name: "dotted_tool", arguments: { query: "x" } });
      expect(JSON.parse((ok.content as { text: string }[])[0].text)).toEqual({ name: "dotted.tool", arguments: { query: "x" } });
      const rejected = await client.request("tools/call", { name: "dotted_tool", arguments: { query: "" } });
      expect(rejected.isError).toBe(true);
      expect((await client.request("test/calls")).calls).toBe(1);

      // unknown tool names go to the server untouched (it decides what to answer)
      const unknown = await client.request("tools/call", { name: "other", arguments: { x: 1 } });
      expect(JSON.parse((unknown.content as { text: string }[])[0].text)).toEqual({ name: "other", arguments: { x: 1 } });

      // echo of a raw request line: the proxy must not re-serialize requests it does not change
      const echo = await client.request("custom/odd2", { z: 1, a: [1, 2] });
      expect(typeof echo.raw).toBe("string");
      expect(JSON.parse(echo.raw as string)).toMatchObject({ method: "custom/odd2", params: { z: 1, a: [1, 2] } });
    } finally {
      input.end();
      client.close();
      await proxy.exit;
    }
  });

  it("reports a server that cannot be started and exits with 127", async () => {
    const logs: string[] = [];
    const proxy = startProxy({ profile: "openai-strict", command: "/definitely/not/here", args: [], input: new PassThrough(), output: new PassThrough(), log: (l) => logs.push(l) });
    expect(await proxy.exit).toBe(127);
    expect(logs[0]).toContain("cannot start");
  });

  it("rejects an unknown profile and a missing command with helpful messages", () => {
    expect(() => startProxy({ profile: "x" as ProfileId, command: "node", args: [] })).toThrow(/Choose one of/);
    expect(() => startProxy({ profile: "openai-strict", command: "", args: [] })).toThrow(/after `--`/);
  });
});

describe("LineReader", () => {
  it("buffers partial lines and multi-byte characters", () => {
    const r = new LineReader();
    const bytes = Buffer.from('{"a":"한"}\n{"b":2}\n{"c"', "utf8");
    expect(r.push(bytes.subarray(0, 8))).toEqual([]);
    expect(r.push(bytes.subarray(8))).toEqual(['{"a":"한"}', '{"b":2}']);
    expect(r.push(":3}")).toEqual([]);
    expect(r.flush()).toEqual(['{"c":3}']);
  });
});
