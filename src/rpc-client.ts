import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { InputError } from "./errors.js";
import type { McpTool } from "./types.js";
import { parseMessage, readLines, writeLine } from "./proxy/jsonrpc.js";

interface Pending {
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/** A tiny line-based JSON-RPC client for MCP stdio servers (used by `simulate` and the tests; no SDK needed). */
export class RpcClient {
  private nextId = 1;
  private readonly pending = new Map<number | string, Pending>();

  constructor(
    input: Readable,
    private readonly output: Writable,
    private readonly timeoutMs = 60_000,
  ) {
    readLines(
      input,
      (line) => {
        const msg = parseMessage(line);
        if (!msg || msg.method !== undefined || msg.id === undefined || msg.id === null) return;
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(Object.assign(new Error("MCP error " + msg.error.code + ": " + msg.error.message), { code: msg.error.code }));
        else p.resolve(msg.result ?? {});
      },
      () => this.rejectAll(new Error("The MCP server closed the connection.")),
    );
  }

  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error("Timed out after " + this.timeoutMs + " ms waiting for " + method + ". A slow server is not an error; raise the timeout."), { timedOutMethod: method }));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      writeLine(this.output, JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  notify(method: string, params?: Record<string, unknown>): void {
    writeLine(this.output, JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  /** MCP handshake. */
  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "mcp-schema-shim", version: "0.2.0" },
    });
    this.notify("notifications/initialized");
  }

  private rejectAll(err: Error): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }

  close(): void {
    this.rejectAll(new Error("client closed"));
  }
}

export interface ServerConnection {
  client: RpcClient;
  close(): Promise<void>;
  /** The error from spawning the process (for example ENOENT), if there was one. */
  spawnError(): Error | undefined;
  /** Resolves with the exit code once the process is gone (or after `ms`); null when killed by a signal or still running. */
  waitForExit(ms: number): Promise<number | null>;
}

/** Spawn an MCP server and connect an RpcClient to its stdio. */
export function connectServer(command: string, args: string[], timeoutMs?: number): ServerConnection {
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
  let failed: Error | undefined;
  let gone = false;
  child.on("error", (e) => {
    failed = e;
    gone = true;
  });
  child.on("close", () => {
    gone = true;
  });
  child.stdin.on("error", () => undefined);
  const client = new RpcClient(child.stdout, child.stdin, timeoutMs);
  const finished = (): boolean => gone || child.exitCode !== null || child.signalCode !== null;
  return {
    client,
    spawnError: () => failed,
    waitForExit: (ms) =>
      new Promise<number | null>((resolve) => {
        if (finished()) return resolve(child.exitCode);
        const timer = setTimeout(() => resolve(null), ms);
        const done = (): void => {
          clearTimeout(timer);
          resolve(child.exitCode);
        };
        child.once("close", done);
        child.once("error", done);
      }),
    close: () =>
      new Promise<void>((resolve) => {
        client.close();
        if (finished()) return resolve();
        const timers: NodeJS.Timeout[] = [];
        child.once("close", () => {
          timers.forEach(clearTimeout);
          resolve();
        });
        child.once("error", () => {
          timers.forEach(clearTimeout);
          resolve();
        });
        child.stdin.end();
        // Ask politely first, then force: a silent server that ignores SIGTERM must not outlive the command.
        timers.push(
          setTimeout(() => {
            child.kill("SIGTERM");
            timers.push(setTimeout(() => child.kill("SIGKILL"), 1000));
          }, 1000),
        );
      }),
  };
}

const MAX_PAGES = 100;

/** Handshake and read every `tools/list` page from a connected server. Failures become InputError (exit 2). */
export async function listAllTools(conn: ServerConnection, command: string, timeoutMs: number): Promise<McpTool[]> {
  const fail = async (e: unknown): Promise<never> => {
    const spawnErr = conn.spawnError();
    if (spawnErr) throw new InputError("Could not start the server command `" + command + "`: " + spawnErr.message);
    const err = e instanceof Error ? e : new Error(String(e));
    const method = (err as { timedOutMethod?: string }).timedOutMethod;
    if (method) throw new InputError("The server did not answer " + method + " within " + timeoutMs + " ms. Raise --timeout if the server is slow to start.");
    const code = (err as { code?: unknown }).code;
    if (err.message.startsWith("MCP error ")) {
      throw new InputError("The server answered " + (lastMethod ?? "a request") + " with MCP error " + String(code) + ": " + err.message.replace(/^MCP error -?\d+: /, ""));
    }
    if (err.message.includes("closed the connection")) {
      const exit = await conn.waitForExit(1000);
      const spawnLate = conn.spawnError();
      if (spawnLate) throw new InputError("Could not start the server command `" + command + "`: " + spawnLate.message);
      throw new InputError("The server exited" + (exit === null ? "" : " (code " + exit + ")") + " before tools/list finished.");
    }
    throw err;
  };
  let lastMethod: string | undefined;
  const call = (method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> => {
    lastMethod = method;
    return conn.client.request(method, params);
  };
  try {
    await call("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "mcp-schema-shim", version: "0.2.0" },
    });
    conn.client.notify("notifications/initialized");
    const tools: McpTool[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await call("tools/list", cursor === undefined ? {} : { cursor });
      if (!Array.isArray(result.tools)) throw new InputError("The server answered tools/list without a tools array.");
      tools.push(...(result.tools as McpTool[]));
      const next = result.nextCursor;
      if (typeof next !== "string" || next === "") return tools;
      if (seen.has(next)) throw new InputError("The server repeated a tools/list cursor; stopping to avoid an endless loop.");
      seen.add(next);
      cursor = next;
    }
    throw new InputError("The server returned more than " + MAX_PAGES + " tools/list pages; stopping.");
  } catch (e) {
    if (e instanceof InputError) throw e;
    return fail(e);
  }
}
