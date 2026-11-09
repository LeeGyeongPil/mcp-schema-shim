import { describe, expect, it } from "vitest";
import { restore, RestoreError, transformTools, transformTool, UnknownToolError, PROFILE_IDS, type McpTool } from "../src/index.js";
import { compileSchema } from "../src/restore.js";
import { makeRng, sampleArgs } from "../src/sample.js";
import { FIXTURES, loadFixture, mockModelCall } from "./helpers/mock-model.js";

/** Deterministic, de-duplicated samples that are valid for the ORIGINAL schema. */
function validSamples(tool: McpTool, wanted: number): Record<string, unknown>[] {
  const validate = compileSchema(tool.inputSchema);
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (let seed = 1; seed <= 200 && out.length < wanted; seed++) {
    const args = sampleArgs(tool.inputSchema, makeRng(seed), seed === 1 ? "minimal" : "random");
    const key = JSON.stringify(args);
    if (seen.has(key) || !validate(args)) continue;
    seen.add(key);
    out.push(args);
  }
  return out;
}

describe("round trip", () => {
  // AC-4
  it("restore(encode(args)) equals args for every profile", () => {
    for (const profile of PROFILE_IDS) {
      let total = 0;
      for (const fixture of FIXTURES) {
        const tools = loadFixture(fixture);
        const result = transformTools(tools, profile);
        const blocked = new Set(result.diagnostics.filter((d) => d.severity === "error" && !d.fixable).map((d) => d.tool));
        tools.forEach((tool, i) => {
          if (blocked.has(tool.name)) return;
          const transformed = result.tools[i];
          const validForModel = compileSchema(transformed.inputSchema);
          for (const args of validSamples(tool, 12)) {
            const sent = mockModelCall(transformed, args);
            expect(validForModel(sent.arguments), profile + " " + tool.name + " " + JSON.stringify(sent.arguments)).toBe(true);
            const restored = restore(sent.name, sent.arguments, result.map);
            expect(restored.name).toBe(tool.name);
            expect(restored.args, profile + " " + tool.name).toEqual(args);
            total += 1;
          }
        });
      }
      expect(total, profile).toBeGreaterThanOrEqual(30);
    }
  });

  // AC-5
  it("restore rejects values that break the original schema", () => {
    const [tool] = loadFixture("sdk-v1-tools");
    const { map } = transformTools([tool], "anthropic-strict");
    let error: unknown;
    try {
      restore("search_issues", { query: "" }, map);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(RestoreError);
    expect((error as RestoreError).issues[0]).toMatchObject({ pointer: "/query", keyword: "minLength" });
    expect((error as RestoreError).message).toContain("/query");

    // Constraints that were moved into descriptions are enforced by the restore step.
    expect(() => restore("search_issues", { query: "x", limit: 0 }, map)).toThrow(RestoreError);
    expect(() => restore("search_issues", { query: "x", limit: 101 }, map)).toThrow(/maximum/);
  });

  it("restores stringified enum values to their original types (gemini-parameters)", () => {
    const tools = loadFixture("edge-cases").filter((t) => t.name === "types_tool");
    const { map } = transformTools(tools, "gemini-parameters");
    const restored = restore("types_tool", { id: "a", note: null, level: "2", priority: "3", scores: ["10", "20"] }, map);
    expect(restored.args).toEqual({ id: "a", note: null, level: 2, priority: 3, scores: [10, 20] });
  });

  it("removes null only where the original schema does not accept it", () => {
    const tool: McpTool = {
      name: "t",
      inputSchema: {
        type: "object",
        properties: { plain: { type: "string" }, nullable: { type: ["string", "null"] } },
      },
    };
    const { map } = transformTools([tool], "openai-strict");
    // `plain` was optional and not nullable: null is removed. `nullable` accepts null: null is kept (documented rule).
    expect(restore("t", { plain: null, nullable: null }, map).args).toEqual({ nullable: null });
    expect(restore("t", { plain: "x", nullable: "y" }, map).args).toEqual({ plain: "x", nullable: "y" });
  });

  it("removes nulls inside array items and nested objects", () => {
    const [tool] = loadFixture("sdk-v1-tools");
    const { map } = transformTools([tool], "openai-strict");
    const sent = { query: "q", limit: null, state: null, since: null, filters: [{ field: "a", op: "eq", value: 1 }], sort: { by: "x", dir: "asc" } };
    expect(restore("search_issues", sent, map).args).toEqual({ query: "q", filters: [{ field: "a", op: "eq", value: 1 }], sort: { by: "x", dir: "asc" } });
  });

  it("reports unknown tools and non-object arguments clearly", () => {
    const { map } = transformTools(loadFixture("sdk-v1-tools"), "openai-strict");
    expect(() => restore("nope", {}, map)).toThrow(UnknownToolError);
    expect(() => restore("nope", {}, map)).toThrow(/Known tools: search_issues/);
    expect(() => restore("search_issues", "text", map)).toThrow(RestoreError);
    expect(() => restore("search_issues", undefined, map)).toThrow(/query/); // missing required field
  });

  it("restores the tool name", () => {
    const tool: McpTool = { name: "a.b", inputSchema: { type: "object", properties: {} } };
    const r = transformTool(tool, "anthropic-strict");
    expect(r.tool.name).toBe("a_b");
    expect(restore("a_b", {}, { version: 1, profile: "anthropic-strict", tools: { a_b: r.toolMap } }).name).toBe("a.b");
  });
});
