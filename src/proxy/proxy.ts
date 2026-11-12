import { spawn, type ChildProcess } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { McpTool, ProfileId, ShimMap } from "../types.js";
import { RestoreError, UnknownToolError } from "../errors.js";
import { inputError } from "../i18n.js";
import { getProfile } from "../profiles/index.js";
import { restore } from "../restore.js";
import { transformTools } from "../transform.js";
import { parseMessage, readLines, writeLine, type JsonRpcMessage } from "./jsonrpc.js";

export interface ProxyOptions {
  profile: ProfileId;
  /** The original MCP server command, e.g. `node` or `npx`. */
  command: string;
  args: string[];
  /** Client side: messages from the MCP client arrive here. Default: process.stdin. */
  input?: Readable;
  /** Client side: messages for the MCP client are written here. Default: process.stdout. */
  output?: Writable;
  /** Log sink (the CLI wires it to stderr / --log). Never write logs to `output`. */
  log?: (line: string) => void;
}

export interface ProxyHandle {
  /** Resolves with the exit code of the wrapped server. */
  exit: Promise<number>;
  /** Terminate the wrapped server (used for SIGINT/SIGTERM). */
  stop(): void;
}

/**
 * Start a stdio proxy: tools/list responses are rewritten for the profile, tools/call requests are restored
 * (and validated against the original schema), everything else passes through untouched.
 */
export function startProxy(opts: ProxyOptions): ProxyHandle {
  getProfile(opts.profile);
  if (!opts.command) throw inputError("err.proxyLibNeedsCommand");
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const log = opts.log ?? (() => undefined);

  const state: ShimMap = { version: 1, profile: opts.profile, tools: {} };
  const pendingLists = new Set<string | number>();

  const child: ChildProcess = spawn(opts.command, opts.args, { stdio: ["pipe", "pipe", "inherit"] });
  const toServer = (line: string): void => {
    if (child.stdin) writeLine(child.stdin, line);
  };
  const toClient = (line: string): void => writeLine(output, line);

  const exit = new Promise<number>((resolve) => {
    child.on("error", (err: NodeJS.ErrnoException) => {
      log("mcp-schema-shim: cannot start the wrapped server `" + opts.command + "`: " + err.message + ". Check the command after `--` and that it is installed.");
      resolve(127);
    });
    child.on("close", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  child.stdin?.on("error", () => undefined); // the server may exit before we finish writing

  // ---- client -> server
  const onClientLine = (line: string): void => {
    const msg = parseMessage(line);
    if (!msg || msg.method === undefined) return toServer(line);
    if (msg.method === "tools/list" && msg.id !== undefined && msg.id !== null) {
      pendingLists.add(msg.id);
      return toServer(line);
    }
    if (msg.method === "tools/call" && msg.params && typeof msg.params.name === "string") {
      return handleCall(msg, line);
    }
    return toServer(line);
  };

  const handleCall = (msg: JsonRpcMessage, line: string): void => {
    const params = msg.params as Record<string, unknown>;
    const name = params.name as string;
    try {
      const restored = restore(name, params.arguments, state);
      const forwarded = { ...msg, params: { ...params, name: restored.name, arguments: restored.args } };
      if (restored.name !== name) log("tools/call " + name + " -> " + restored.name);
      toServer(JSON.stringify(forwarded));
    } catch (e) {
      if (e instanceof UnknownToolError) return toServer(line); // not a tool we listed: let the server answer
      const text = (e instanceof RestoreError ? e.message : e instanceof Error ? e.message : String(e)) + "\nFix the arguments and call the tool again.";
      log("tools/call " + name + " rejected before reaching the server: " + text.split("\n")[0]);
      if (msg.id === undefined || msg.id === null) return; // notification-style call: nothing to answer
      toClient(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "mcp-schema-shim: " + text }], isError: true } }));
    }
  };

  // ---- server -> client
  const onServerLine = (line: string): void => {
    const msg = parseMessage(line);
    if (!msg || msg.method !== undefined || msg.id === undefined || msg.id === null || !pendingLists.has(msg.id)) return toClient(line);
    pendingLists.delete(msg.id);
    const tools = msg.result?.tools;
    if (!Array.isArray(tools)) return toClient(line);
    try {
      const pageNames = new Set((tools as McpTool[]).map((t) => t.name));
      const taken = new Set(Object.entries(state.tools).filter(([, t]) => !pageNames.has(t.originalName)).map(([n]) => n));
      const result = transformTools(tools as McpTool[], opts.profile, { usedNames: taken });
      Object.assign(state.tools, result.map.tools);
      const blocking = result.diagnostics.filter((d) => d.severity === "error" && !d.fixable);
      log("tools/list: " + result.tools.length + " tool(s) transformed for " + opts.profile + (blocking.length ? "; NOT fixable: " + blocking.map((d) => d.tool + " " + d.ruleId).join(", ") : ""));
      toClient(JSON.stringify({ ...msg, result: { ...msg.result, tools: result.tools } }));
    } catch (e) {
      log("tools/list passed through unchanged: " + (e instanceof Error ? e.message : String(e)));
      toClient(line);
    }
  };

  readLines(input, onClientLine, () => child.stdin?.end());
  if (child.stdout) readLines(child.stdout, onServerLine);

  return {
    exit,
    stop: () => {
      if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
    },
  };
}
