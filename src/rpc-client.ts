import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
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
        reject(new Error("Timed out after " + this.timeoutMs + " ms waiting for " + method + ". A slow server is not an error; raise the timeout."));
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
      clientInfo: { name: "mcp-schema-shim", version: "0.1.2" },
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
}

/** Spawn an MCP server and connect an RpcClient to its stdio. */
export function connectServer(command: string, args: string[], timeoutMs?: number): ServerConnection {
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
  child.on("error", () => undefined);
  child.stdin.on("error", () => undefined);
  const client = new RpcClient(child.stdout, child.stdin, timeoutMs);
  return {
    client,
    close: () =>
      new Promise<void>((resolve) => {
        client.close();
        if (child.exitCode !== null) return resolve();
        child.once("close", () => resolve());
        child.stdin.end();
        setTimeout(() => child.kill("SIGTERM"), 1000).unref();
      }),
  };
}
