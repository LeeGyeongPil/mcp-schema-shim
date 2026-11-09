import { PassThrough } from "node:stream";
import type { JsonSchema, McpTool, ProfileId } from "./types.js";
import { InputError } from "./errors.js";
import { compileSchema } from "./restore.js";
import { connectServer, RpcClient } from "./rpc-client.js";
import { makeRng, sampleArgs } from "./sample.js";
import { startProxy } from "./proxy/proxy.js";
import { isObj } from "./walk.js";

export const MOCK_BANNER = "mock model — no LLM is called (연습용 목 모델, 실제 모델 호출 없음)";

function fits(schema: JsonSchema, value: unknown): boolean {
  try {
    return compileSchema(schema)(value);
  } catch {
    return true;
  }
}

/**
 * Encode arguments the way a model that obeys the TRANSFORMED schema would send them:
 * required-but-absent properties are filled with null, enum values become strings when the enum is a string enum.
 * This is a practice mock, not a real model; it only imitates the schema-obeying behaviour.
 */
export function encodeArgs(schema: JsonSchema, value: unknown): unknown {
  if (!isObj(schema)) return value;
  if (Array.isArray(schema.anyOf)) {
    for (const branch of schema.anyOf) {
      const candidate = encodeArgs(branch, value);
      if (isObj(branch) && fits(branch, candidate)) return candidate;
    }
    return value;
  }
  if (isObj(value) && isObj(schema.properties)) {
    const required: string[] = Array.isArray(schema.required) ? schema.required : [];
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(schema.properties)) {
      if (key in value) out[key] = encodeArgs(child as JsonSchema, value[key]);
      else if (required.includes(key)) out[key] = null;
    }
    for (const key of Object.keys(value)) if (!(key in out)) out[key] = value[key];
    return out;
  }
  if (Array.isArray(value) && isObj(schema.items)) return value.map((v) => encodeArgs(schema.items as JsonSchema, v));
  if (Array.isArray(schema.enum) && schema.enum.every((e: unknown) => typeof e === "string") && value !== null && typeof value !== "string") {
    return String(value);
  }
  return value;
}

/** What the practice mock model would send for `args` given the transformed tool. */
export function mockModelCall(transformed: McpTool, args: Record<string, unknown>): { name: string; arguments: Record<string, unknown> } {
  return { name: transformed.name, arguments: encodeArgs(transformed.inputSchema, args) as Record<string, unknown> };
}

function textOf(result: Record<string, unknown>): string {
  const content = result.content;
  if (Array.isArray(content) && isObj(content[0]) && typeof content[0].text === "string") return content[0].text;
  return JSON.stringify(result);
}

export interface SimulateOptions {
  profile: ProfileId;
  command: string;
  args: string[];
  tool?: string;
  /** Original (valid) arguments; default: the smallest valid object (required properties only). */
  callArgs?: Record<string, unknown>;
  write: (line: string) => void;
}

async function call(client: RpcClient, name: string, args: unknown): Promise<{ ok: boolean; text: string }> {
  try {
    const r = await client.request("tools/call", { name, arguments: args as Record<string, unknown> });
    return { ok: r.isError !== true, text: textOf(r) };
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : String(e) };
  }
}

/** Compare "mock model -> server directly" with "mock model -> shim proxy -> server". */
export async function simulate(opts: SimulateOptions): Promise<void> {
  const w = opts.write;
  w(MOCK_BANNER);
  w("The server and its argument validation are real; only the model is imitated.");

  const direct = connectServer(opts.command, opts.args);
  const viaProxyIn = new PassThrough();
  const viaProxyOut = new PassThrough();
  const proxy = startProxy({ profile: opts.profile, command: opts.command, args: opts.args, input: viaProxyIn, output: viaProxyOut, log: () => undefined });
  const shimClient = new RpcClient(viaProxyOut, viaProxyIn);
  try {
    await direct.client.initialize();
    await shimClient.initialize();
    const original = (await direct.client.request("tools/list")).tools as McpTool[];
    const exposed = (await shimClient.request("tools/list")).tools as McpTool[];
    if (!Array.isArray(original) || original.length === 0) throw new InputError("The server returned no tools.");
    const index = opts.tool ? original.findIndex((t) => t.name === opts.tool) : 0;
    if (index < 0) throw new InputError('Tool "' + opts.tool + '" not found. Available: ' + original.map((t) => t.name).join(", "));

    const args = opts.callArgs ?? sampleArgs(original[index].inputSchema, makeRng(1), "minimal");
    const mock = mockModelCall(exposed[index], args);
    w("");
    w("profile:            " + opts.profile);
    w("tool:               " + original[index].name + (exposed[index].name !== original[index].name ? "  (exposed to the model as " + exposed[index].name + ")" : ""));
    w("intended arguments: " + JSON.stringify(args));
    w("mock model sends:   " + JSON.stringify(mock.arguments));
    w("");
    const d = await call(direct.client, mock.name, mock.arguments);
    w("direct:   " + (d.ok ? "OK   " : "FAIL ") + indentLines(d.text));
    const s = await call(shimClient, mock.name, mock.arguments);
    w("via shim: " + (s.ok ? "OK   " : "FAIL ") + indentLines(s.text));
  } finally {
    viaProxyIn.end();
    shimClient.close();
    await direct.close();
    proxy.stop();
    await proxy.exit;
  }
}

/** Keeps every line of a multi-line result (validation errors list one problem per line), indenting the follow-up lines. */
function indentLines(text: string): string {
  return text.split("\n").join("\n         ");
}
