#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { Diagnostic, McpTool, ProfileId } from "./types.js";
import { InputError } from "./errors.js";
import { inputError, isLang, langFlagFrom, localizeInput, resolveLang, t, type Lang } from "./i18n.js";
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

function help(lang: Lang): string {
  return t(lang, "help", { profiles: PROFILE_IDS.join(", ") });
}

function readTools(file: string): McpTool[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    throw inputError("err.cannotRead", { file, reason: e instanceof Error ? e.message : String(e) });
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw inputError("err.invalidJson", { file, reason: e instanceof Error ? e.message : String(e) });
  }
  if (Array.isArray(data)) return data as McpTool[];
  if (isObj(data) && Array.isArray(data.tools)) return data.tools as McpTool[];
  if (isObj(data) && typeof data.name === "string") return [data as McpTool];
  throw inputError("err.badToolsFile", { file });
}

function profilesFrom(values: string[] | undefined, all: boolean | undefined): ProfileId[] {
  if (all) return [...PROFILE_IDS];
  if (!values || values.length === 0) throw inputError("err.noProfile", { profiles: PROFILE_IDS.join(", ") });
  for (const v of values) if (!isProfileId(v)) throw inputError("err.unknownProfile", { name: v, profiles: PROFILE_IDS.join(", ") });
  return values as ProfileId[];
}

function formatFrom(value: string | undefined): ReportFormat {
  const f = value ?? "text";
  if (f !== "text" && f !== "json" && f !== "markdown") throw inputError("err.unknownFormat", { value: f });
  return f;
}

export async function main(
  argv: string[],
  io: CliIo = { stdout: process.stdout, stderr: process.stderr },
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  // --lang is read before parseArgs so that even option-parsing errors are shown in the chosen language.
  const flag = langFlagFrom(argv);
  const envLang = resolveLang(undefined, env);
  if (flag !== undefined && !isLang(flag)) {
    io.stderr.write("mcp-schema-shim: " + t(envLang, "err.badLang", { value: flag }) + "\n");
    return 2;
  }
  const lang = resolveLang(flag, env);
  try {
    return await run(argv, io, lang);
  } catch (e) {
    if (e instanceof InputError) {
      io.stderr.write("mcp-schema-shim: " + localizeInput(e, lang) + "\n");
      return 2;
    }
    // parseArgs reports unknown options / missing values with a coded TypeError.
    if (e instanceof TypeError && (e as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      io.stderr.write("mcp-schema-shim: " + parseArgsMessage(e, argv, lang) + "\n" + t(lang, "err.parseHint") + "\n");
      return 2;
    }
    throw e;
  }
}

/** Localize a node parseArgs error; fall back to the original message when the option name cannot be found. */
function parseArgsMessage(e: TypeError, argv: string[], lang: Lang): string {
  const code = (e as { code?: string }).code;
  const quoted = /'([^']*)'/.exec(e.message)?.[1];
  if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
    const option = quoted?.split(/[=\s]/)[0] ?? argv.find((a) => a.startsWith("-"));
    if (option) return t(lang, "err.parseUnknown", { option });
  } else if (code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE") {
    const option = quoted ? (/--[\w-]+/.exec(quoted)?.[0] ?? quoted.split(/\s/)[0]) : undefined;
    if (option) return t(lang, "err.parseMissingValue", { option });
  } else if (code === "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL") {
    if (quoted) return t(lang, "err.parseUnexpected", { value: quoted });
  }
  return e.message;
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

async function run(argv: string[], io: CliIo, lang: Lang): Promise<number> {
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
      lang: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...operands] = positionals;
  if (values.help || command === undefined || command === "help") {
    io.stdout.write(help(lang));
    return command === undefined && !values.help ? 2 : 0;
  }

  if (command === "check") {
    const serverMode = rest.length > 0;
    if (serverMode && operands.length > 0) throw inputError("err.checkBoth");
    if (!serverMode && operands.length === 0) {
      throw inputError("err.checkNeeds");
    }
    if (!serverMode && operands.length !== 1) throw inputError("err.checkOneFile");
    if (!serverMode && values.timeout !== undefined) throw inputError("err.timeoutFileMode");
    let timeoutMs = 10_000;
    if (values.timeout !== undefined) {
      timeoutMs = Number(values.timeout);
      if (!/^\d+$/.test(values.timeout) || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw inputError("err.timeoutPositive");
    }
    const tools = serverMode ? await fetchTools(rest[0], rest.slice(1), timeoutMs, values.profile, values.all, values.format) : readTools(operands[0]);
    const profiles = profilesFrom(values.profile, values.all);
    const diags: Diagnostic[] = profiles.flatMap((p) => transformTools(tools, p).diagnostics);
    io.stdout.write(formatDiagnostics(diags, formatFrom(values.format), lang));
    return diags.some((d) => d.severity === "error") ? 1 : 0;
  }

  if (command === "fix") {
    if (operands.length !== 1) throw inputError("err.fixOneFile");
    const profiles = profilesFrom(values.profile, false);
    if (profiles.length !== 1) throw inputError("err.fixOneProfile");
    const result = transformTools(readTools(operands[0]), profiles[0]);
    const json = JSON.stringify({ tools: result.tools }, null, 2) + "\n";
    if (values.output) writeFileSync(values.output, json);
    else io.stdout.write(json);
    if (values.map) writeFileSync(values.map, JSON.stringify(result.map, null, 2) + "\n");
    io.stderr.write(formatDiagnostics(result.diagnostics, "text", lang));
    return result.diagnostics.some((d) => d.severity === "error" && !d.fixable) ? 1 : 0;
  }

  if (command === "proxy") {
    const profiles = profilesFrom(values.profile, false);
    if (profiles.length !== 1) throw inputError("err.proxyOneProfile");
    if (rest.length === 0) throw inputError("err.proxyNeedsServer");
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
    if (profiles.length !== 1) throw inputError("err.simOneProfile");
    if (rest.length === 0) throw inputError("err.simNeedsServer");
    let callArgs: Record<string, unknown> | undefined;
    if (values.args !== undefined) {
      try {
        const parsed: unknown = JSON.parse(values.args);
        if (!isObj(parsed)) throw new Error("not an object");
        callArgs = parsed;
      } catch {
        throw inputError("err.argsJson");
      }
    }
    await simulate({ profile: profiles[0], command: rest[0], args: rest.slice(1), tool: values.tool, callArgs, write: (l) => io.stdout.write(l + "\n"), lang });
    return 0;
  }

  throw inputError("err.unknownCommand", { name: command });
}

// Run when executed directly (also through the npm bin symlink).
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      const lang = resolveLang(langFlagFrom(process.argv.slice(2)), process.env);
      process.stderr.write("mcp-schema-shim: " + t(lang, "err.unexpected", { detail: e instanceof Error ? e.stack ?? e.message : String(e) }) + "\n");
      process.exitCode = 70;
    },
  );
}
