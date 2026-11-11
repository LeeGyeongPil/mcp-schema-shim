import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";

const tools = fileURLToPath(new URL("../examples/tools.json", import.meta.url));
const v1 = fileURLToPath(new URL("../examples/server-v1.mjs", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/check-server.mjs", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "mcp-schema-shim-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

async function cli(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await main(argv, { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) } });
  return { code, out, err };
}

describe("cli", () => {
  // AC-10 (in-process variant; the built binary is covered by the acceptance command)
  it("check exits 1 and prints a table with documentation URLs", async () => {
    const r = await cli("check", tools, "--profile", "openai-strict");
    expect(r.code).toBe(1);
    expect(r.out).toContain("openai-strict/additional-properties");
    expect(r.out).toContain("developers.openai.com");
  });

  it("check exits 0 when only warnings/info remain", async () => {
    const r = await cli("check", tools, "--profile", "gemini-json-schema");
    expect(r.code).toBe(0);
    expect(r.out).toContain("gemini-json-schema/ignored-keyword");
  });

  it("supports json and markdown output and --all", async () => {
    const json = await cli("check", tools, "--all", "--format", "json");
    const parsed = JSON.parse(json.out) as { profile: string }[];
    expect(new Set(parsed.map((d) => d.profile)).size).toBe(4);
    const md = await cli("check", tools, "--profile", "anthropic-strict", "--format", "markdown");
    expect(md.out).toContain("| Tool | Pointer | Rule |");
  });

  it("fix writes tools and a map that restore can use", async () => {
    const out = join(tmp, "fixed.json");
    const mapFile = join(tmp, "map.json");
    const r = await cli("fix", tools, "--profile", "openai-strict", "-o", out, "--map", mapFile);
    expect(r.code).toBe(0);
    const fixed = JSON.parse(readFileSync(out, "utf8")) as { tools: { inputSchema: { additionalProperties: boolean } }[] };
    expect(fixed.tools[0].inputSchema.additionalProperties).toBe(false);
    const map = JSON.parse(readFileSync(mapFile, "utf8")) as { version: number; tools: Record<string, { entries: { op: string }[] }> };
    expect(map.version).toBe(1);
    expect(map.tools["search_issues"].entries.some((e) => e.op === "nullable-optional")).toBe(true);
  });

  it("fix exits 1 when an error cannot be repaired", async () => {
    const file = join(tmp, "anyof.json");
    writeFileSync(file, JSON.stringify([{ name: "t", inputSchema: { anyOf: [{ type: "object" }, { type: "object" }] } }]));
    const r = await cli("fix", file, "--profile", "openai-strict");
    expect(r.code).toBe(1);
    expect(r.err).toContain("NOT fixable");
  });

  it("returns 2 with a fix hint for bad input", async () => {
    expect((await cli("check", join(tmp, "missing.json"), "--profile", "openai-strict")).err).toContain("Cannot read");
    const bad = join(tmp, "bad.json");
    writeFileSync(bad, "{not json");
    const r1 = await cli("check", bad, "--profile", "openai-strict");
    expect(r1.code).toBe(2);
    expect(r1.err).toContain("not valid JSON");
    const r2 = await cli("check", tools);
    expect(r2.code).toBe(2);
    expect(r2.err).toContain("--profile");
    const r3 = await cli("check", tools, "--profile", "nope");
    expect(r3.code).toBe(2);
    expect(r3.err).toContain("Choose one of");
    expect((await cli("check", tools, "--bogus")).code).toBe(2);
    expect((await cli("frobnicate")).code).toBe(2);
    expect((await cli("proxy", "--profile", "openai-strict")).err).toContain("after `--`");
    expect((await cli()).code).toBe(2);
    expect((await cli("--help")).out).toContain("Usage:");
  });

  // AC-9 (in-process; `npm run demo` runs the same code through the built binary)
  it("simulate shows the direct failure and the shim success with the mock banner", async () => {
    const r = await cli("simulate", "--profile", "openai-strict", "--tool", "search_issues", "--args", '{"query":"bug"}', "--", process.execPath, v1);
    expect(r.code).toBe(0);
    expect(r.out).toContain("mock model");
    expect(r.out).toMatch(/direct: {3}FAIL .*-32602/);
    expect(r.out).toContain('via shim: OK   {"query":"bug"}');
  });

  it("simulate prints every line of a restore error", async () => {
    const r = await cli("simulate", "--profile", "anthropic-strict", "--tool", "issues.search", "--args", '{"query":""}', "--", process.execPath, v1);
    expect(r.out).toContain("/query");
    expect(r.out).toContain("minLength");
    expect(r.out).toContain("Fix the arguments and call the tool again.");
  });

  it("simulate shows the renamed tool for anthropic-strict", async () => {
    const r = await cli("simulate", "--profile", "anthropic-strict", "--tool", "issues.search", "--", process.execPath, v1);
    expect(r.out).toContain("exposed to the model as issues_search");
    expect(r.out).toMatch(/direct: {3}FAIL/);
    expect(r.out).toMatch(/via shim: OK/);
  });

  describe("check with a server command", () => {
    const server = (mode: string): string[] => ["--", process.execPath, fixture, mode];

    it("reads every tools/list page and exits 1 on errors", async () => {
      const r = await cli("check", "--profile", "openai-strict", ...server("ok"));
      expect(r.code).toBe(1);
      expect(r.out).toContain("find_items");
      expect(r.out).toContain("list_labels");
      expect(r.out).not.toContain("check-server["); // server stderr goes to the real stderr, never into the report
    });

    it("gives the same json as file mode for the same tools", async () => {
      const server1 = await cli("check", "--profile", "openai-strict", "--format", "json", ...server("ok"));
      const toolsFile = join(tmp, "paged.json");
      const all = [
        { name: "find_items", description: "Find items", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer" } }, required: ["query"] } },
        { name: "list_labels", description: "List labels", inputSchema: { type: "object", properties: { page: { type: "integer" } }, required: [] } },
      ];
      writeFileSync(toolsFile, JSON.stringify({ tools: all }));
      const file = await cli("check", toolsFile, "--profile", "openai-strict", "--format", "json");
      expect(JSON.parse(server1.out)).toEqual(JSON.parse(file.out));
    });

    it("exits 0 when the profile finds no errors", async () => {
      const r = await cli("check", "--profile", "gemini-json-schema", ...server("ok"));
      expect(r.code).toBe(0);
    });

    it("times out on a silent server that ignores SIGTERM and leaves no process", async () => {
      const started = Date.now();
      const r = await cli("check", "--profile", "openai-strict", "--timeout", "300", ...server("silent"));
      expect(r.code).toBe(2);
      expect(r.err).toContain("did not answer");
      expect(Date.now() - started).toBeLessThan(3500);
    }, 10_000);

    it("reports a missing command as exit 2 without an unexpected-error stack", async () => {
      const r = await cli("check", "--profile", "openai-strict", "--", "no-such-cmd-xyz");
      expect(r.code).toBe(2);
      expect(r.err).toContain("Could not start");
      expect(r.err).not.toContain("unexpected error");
    });

    it("reports an early exit and an MCP error response", async () => {
      const exited = await cli("check", "--profile", "openai-strict", ...server("exit"));
      expect(exited.code).toBe(2);
      expect(exited.err).toContain("exited (code 3)");
      const rpc = await cli("check", "--profile", "openai-strict", ...server("rpc-error"));
      expect(rpc.code).toBe(2);
      expect(rpc.err).toContain("MCP error -32603: listing failed");
    });

    it("rejects a tools file together with a server command, and --timeout in file mode", async () => {
      const both = await cli("check", tools, "--profile", "openai-strict", ...server("ok"));
      expect(both.code).toBe(2);
      expect(both.err).toContain("not both");
      const timeout = await cli("check", tools, "--profile", "openai-strict", "--timeout", "500");
      expect(timeout.code).toBe(2);
      expect(timeout.err).toContain("--timeout only applies");
      const bad = await cli("check", "--profile", "openai-strict", "--timeout", "0", ...server("ok"));
      expect(bad.code).toBe(2);
      expect(bad.err).toContain("positive number");
      expect((await cli("check", "--profile", "openai-strict")).err).toContain("a tools file or a server command");
    });
  });
});
