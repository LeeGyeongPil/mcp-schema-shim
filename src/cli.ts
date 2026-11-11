#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { Diagnostic, McpTool, ProfileId } from "./types.js";
import { InputError } from "./errors.js";
import { PROFILE_IDS, isProfileId } from "./profiles/index.js";
import { transformTools } from "./transform.js";
import { formatDiagnostics, type ReportFormat } from "./report.js";
import { startProxy } from "./proxy/proxy.js";
import { connectServer, listAllTools } from "./rpc-client.js";
import { simulate } from "./simulate.js";
import { isObj } from "./walk.js";

export interface CliIo {
  stdout: { write(s: string): unknown };
  stderr: { write(s: string): unknown };
}

const HELP = `mcp-schema-shim - make MCP tool schemas fit Gemini / OpenAI strict / Anthropic strict, and restore the arguments

Usage:
  mcp-schema-shim check <tools.json> (--profile <id> ... | --all) [--format text|json|markdown]
  mcp-schema-shim check (--profile <id> ... | --all) [--format text|json|markdown] [--timeout <ms>] -- <server command> [args...]
  mcp-schema-shim fix <tools.json> --profile <id> [--map <file>] [-o <file>]
  mcp-schema-shim proxy --profile <id> [--log <file>] -- <server command> [args...]
  mcp-schema-shim simulate --profile <id> [--tool <name>] [--args <json>] -- <server command> [args...]

Profiles: ${PROFILE_IDS.join(", ")}

Exit codes: 0 ok, 1 findings of error severity (check) / unfixable errors (fix), 2 bad input or usage.
  check with a server command: 2 if the server cannot be started, times out or answers with an error.
`;

function readTools(file: string): McpTool[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    throw new InputError("Cannot read " + file + ": " + (e instanceof Error ? e.message : String(e)));
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new InputError(file + " is not valid JSON: " + (e instanceof Error ? e.message : String(e)));
  }
  if (Array.isArray(data)) return data as McpTool[];
  if (isObj(data) && Array.isArray(data.tools)) return data.tools as McpTool[];
  if (isObj(data) && typeof data.name === "string") return [data as McpTool];
  throw new InputError(file + ' must contain a tools/list result ({"tools":[...]}), an array of tools, or one tool object.');
}

function profilesFrom(values: string[] | undefined, all: boolean | undefined): ProfileId[] {
  if (all) return [...PROFILE_IDS];
  if (!values || values.length === 0) throw new InputError("Choose a profile with --profile <id> (repeatable) or use --all. Profiles: " + PROFILE_IDS.join(", ") + ".");
  for (const v of values) if (!isProfileId(v)) throw new InputError('Unknown profile "' + v + '". Choose one of: ' + PROFILE_IDS.join(", ") + ".");
  return values as ProfileId[];
}

function formatFrom(value: string | undefined): ReportFormat {
  const f = value ?? "text";
  if (f !== "text" && f !== "json" && f !== "markdown") throw new InputError('Unknown --format "' + f + '". Use text, json or markdown.');
  return f;
}

export async function main(argv: string[], io: CliIo = { stdout: process.stdout, stderr: process.stderr }): Promise<number> {
  try {
    return await run(argv, io);
  } catch (e) {
    if (e instanceof InputError) {
      io.stderr.write("mcp-schema-shim: " + e.message + "\n");
      return 2;
    }
    // parseArgs reports unknown options / missing values with a coded TypeError.
    if (e instanceof TypeError && (e as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      io.stderr.write("mcp-schema-shim: " + e.message + "\nRun `mcp-schema-shim --help` for usage.\n");
      return 2;
    }
    throw e;
  }
}

/** Start the server, read every tools/list page, and always stop the child process. */
async function fetchTools(
  command: string,
  args: string[],
  timeoutMs: number,
  profile: string[] | undefined,
  all: boolean | undefined,
  format: string | undefined,
): Promise<McpTool[]> {
  // Validate cheap options first so a typo does not start a server.
  profilesFrom(profile, all);
  formatFrom(format);
  const conn = connectServer(command, args, timeoutMs);
  try {
    return await listAllTools(conn, command, timeoutMs);
  } finally {
    await conn.close();
  }
}

async function run(argv: string[], io: CliIo): Promise<number> {
  const sep = argv.indexOf("--");
  const own = sep >= 0 ? argv.slice(0, sep) : argv;
  const rest = sep >= 0 ? argv.slice(sep + 1) : [];
  const { values, positionals } = parseArgs({
    args: own,
    allowPositionals: true,
    options: {
      profile: { type: "string", multiple: true },
      all: { type: "boolean" },
      format: { type: "string" },
      timeout: { type: "string" },
      map: { type: "string" },
      output: { type: "string", short: "o" },
      log: { type: "string" },
      tool: { type: "string" },
      args: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...operands] = positionals;
  if (values.help || command === undefined || command === "help") {
    io.stdout.write(HELP);
    return command === undefined && !values.help ? 2 : 0;
  }

  if (command === "check") {
    const serverMode = rest.length > 0;
    if (serverMode && operands.length > 0) throw new InputError("check takes either a tools file or a server command after `--`, not both.");
    if (!serverMode && operands.length === 0) {
      throw new InputError(
        "check needs a tools file or a server command: mcp-schema-shim check <tools.json> --profile <id>  |  mcp-schema-shim check --profile <id> -- node server.js",
      );
    }
    if (!serverMode && operands.length !== 1) throw new InputError("check needs exactly one tools file: mcp-schema-shim check <tools.json> --profile <id>");
    if (!serverMode && values.timeout !== undefined) throw new InputError("--timeout only applies with a server command after `--`.");
    let timeoutMs = 10_000;
    if (values.timeout !== undefined) {
      timeoutMs = Number(values.timeout);
      if (!/^\d+$/.test(values.timeout) || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new InputError("--timeout must be a positive number of milliseconds.");
    }
    const tools = serverMode ? await fetchTools(rest[0], rest.slice(1), timeoutMs, values.profile, values.all, values.format) : readTools(operands[0]);
    const profiles = profilesFrom(values.profile, values.all);
    const diags: Diagnostic[] = profiles.flatMap((p) => transformTools(tools, p).diagnostics);
    io.stdout.write(formatDiagnostics(diags, formatFrom(values.format)));
    return diags.some((d) => d.severity === "error") ? 1 : 0;
  }

  if (command === "fix") {
    if (operands.length !== 1) throw new InputError("fix needs exactly one tools file: mcp-schema-shim fix <tools.json> --profile <id>");
    const profiles = profilesFrom(values.profile, false);
    if (profiles.length !== 1) throw new InputError("fix takes exactly one --profile.");
    const result = transformTools(readTools(operands[0]), profiles[0]);
    const json = JSON.stringify({ tools: result.tools }, null, 2) + "\n";
    if (values.output) writeFileSync(values.output, json);
    else io.stdout.write(json);
    if (values.map) writeFileSync(values.map, JSON.stringify(result.map, null, 2) + "\n");
    io.stderr.write(formatDiagnostics(result.diagnostics, "text"));
    return result.diagnostics.some((d) => d.severity === "error" && !d.fixable) ? 1 : 0;
  }

  if (command === "proxy") {
    const profiles = profilesFrom(values.profile, false);
    if (profiles.length !== 1) throw new InputError("proxy takes exactly one --profile.");
    if (rest.length === 0) throw new InputError("proxy needs the original server command after `--`, e.g. proxy --profile openai-strict -- node server.js");
    const logFile = values.log;
    const handle = startProxy({
      profile: profiles[0],
      command: rest[0],
      args: rest.slice(1),
      log: (line) => {
        io.stderr.write(line + "\n");
        if (logFile) appendFileSync(logFile, new Date().toISOString() + " " + line + "\n");
      },
    });
    const stop = (): void => handle.stop();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    const code = await handle.exit;
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    return code;
  }

  if (command === "simulate") {
    const profiles = profilesFrom(values.profile, false);
    if (profiles.length !== 1) throw new InputError("simulate takes exactly one --profile.");
    if (rest.length === 0) throw new InputError("simulate needs the server command after `--`, e.g. simulate --profile openai-strict -- node examples/server-v1.mjs");
    let callArgs: Record<string, unknown> | undefined;
    if (values.args !== undefined) {
      try {
        const parsed: unknown = JSON.parse(values.args);
        if (!isObj(parsed)) throw new Error("not an object");
        callArgs = parsed;
      } catch {
        throw new InputError('--args must be a JSON object, e.g. --args \'{"query":"bug"}\'.');
      }
    }
    await simulate({ profile: profiles[0], command: rest[0], args: rest.slice(1), tool: values.tool, callArgs, write: (l) => io.stdout.write(l + "\n") });
    return 0;
  }

  throw new InputError('Unknown command "' + command + '". Use check, fix, proxy or simulate (see --help).');
}

// Run when executed directly (also through the npm bin symlink).
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      process.stderr.write("mcp-schema-shim: unexpected error: " + (e instanceof Error ? e.stack ?? e.message : String(e)) + "\n");
      process.exitCode = 70;
    },
  );
}
