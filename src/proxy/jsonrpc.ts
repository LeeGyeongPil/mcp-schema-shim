import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

/** Splits a byte stream into newline-delimited messages, buffering partial lines. */
export class LineReader {
  private buffer = "";
  private readonly decoder = new StringDecoder("utf8");

  /** Feed a chunk; returns the complete lines found so far (without line terminators). */
  push(chunk: Buffer | string): string[] {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    const lines: string[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(idx + 1);
      if (line.length > 0) lines.push(line);
    }
    return lines;
  }

  /** Remaining text without a trailing newline (call when the stream ends). */
  flush(): string[] {
    const rest = (this.buffer + this.decoder.end()).replace(/\r$/, "");
    this.buffer = "";
    return rest.length > 0 ? [rest] : [];
  }
}

/** Call `onLine` for every message on a stream (including an unterminated last one). */
export function readLines(stream: Readable, onLine: (line: string) => void, onEnd?: () => void): void {
  const reader = new LineReader();
  stream.on("data", (chunk: Buffer | string) => {
    for (const line of reader.push(chunk)) onLine(line);
  });
  stream.on("end", () => {
    for (const line of reader.flush()) onLine(line);
    onEnd?.();
  });
}

/** Write one JSON-RPC message as a line. Silently ignores closed streams (the peer is gone). */
export function writeLine(stream: Writable, line: string): void {
  if (stream.destroyed || stream.writableEnded) return;
  stream.write(line + "\n");
}

export interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
  [k: string]: unknown;
}

/** Parse a line as a JSON-RPC object; undefined when it is not one (the caller passes it through unchanged). */
export function parseMessage(line: string): JsonRpcMessage | undefined {
  try {
    const v: unknown = JSON.parse(line);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as JsonRpcMessage) : undefined;
  } catch {
    return undefined;
  }
}
