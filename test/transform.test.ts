import { describe, expect, it } from "vitest";
import { check, transformTool, transformTools, PROFILE_IDS, type ProfileId } from "../src/index.js";
import { compileSchema } from "../src/restore.js";
import { FIXTURES, loadFixture } from "./helpers/mock-model.js";

// Errors no profile can repair automatically (kept visible so they are never silently "fixed").
const UNFIXABLE: Record<string, Record<ProfileId, string[]>> = {
  "sdk-v1-tools": { "gemini-parameters": [], "gemini-json-schema": [], "openai-strict": [], "anthropic-strict": [] },
  "sdk-v2-tools": { "gemini-parameters": [], "gemini-json-schema": [], "openai-strict": [], "anthropic-strict": [] },
  "edge-cases": {
    "gemini-parameters": ["recursive_tool gemini-parameters/ref-recursive", "root_anyof gemini-parameters/root-object"],
    "gemini-json-schema": ["root_anyof gemini-json-schema/root-object"],
    "openai-strict": [
      "freeform openai-strict/free-form-object",
      "recursive_tool openai-strict/ref-recursive",
      "root_anyof openai-strict/root-anyof",
    ],
    "anthropic-strict": [
      "freeform anthropic-strict/additional-properties-schema",
      "recursive_tool anthropic-strict/ref-recursive",
      "root_anyof anthropic-strict/root-object",
    ],
  },
};

describe("transform", () => {
  // AC-3
  it("transformed schemas re-check clean", () => {
    for (const fixture of FIXTURES) {
      const tools = loadFixture(fixture);
      for (const profile of PROFILE_IDS) {
        const first = transformTools(tools, profile);
        const unfixable = [...new Set(first.diagnostics.filter((d) => d.severity === "error" && !d.fixable).map((d) => d.tool + " " + d.ruleId))].sort();
        expect(unfixable, fixture + " / " + profile).toEqual(UNFIXABLE[fixture][profile]);

        const again = check(first.tools, profile);
        expect(again.filter((d) => d.fixable), fixture + " / " + profile).toEqual([]);

        for (const t of first.tools) {
          expect(() => compileSchema(t.inputSchema), t.name + " / " + profile).not.toThrow();
        }
      }
    }
  });

  it("does not mutate the input", () => {
    const tools = loadFixture("edge-cases");
    const snapshot = JSON.stringify(tools);
    for (const profile of PROFILE_IDS) transformTools(tools, profile);
    expect(JSON.stringify(tools)).toBe(snapshot);
  });

  it("keeps unrelated tool fields", () => {
    const [tool] = loadFixture("sdk-v1-tools");
    const r = transformTool({ ...tool, annotations: { readOnlyHint: true } }, "openai-strict");
    expect(r.tool.annotations).toEqual({ readOnlyHint: true });
    expect(r.tool.description).toBe(tool.description);
  });

  it("openai-strict: all properties required, nested objects closed, optional ones nullable", () => {
    const [tool] = loadFixture("sdk-v1-tools");
    const schema = transformTool(tool, "openai-strict").tool.inputSchema;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["query", "limit", "state", "since", "filters", "sort"]);
    expect(schema.properties.limit.type).toEqual(["integer", "null"]);
    expect(schema.properties.state.enum).toEqual(["open", null]);
    expect(schema.properties.sort.anyOf[1]).toEqual({ type: "null" });
    expect(schema.properties.filters.anyOf[0].items.additionalProperties).toBe(false);
  });

  it("gemini-parameters: removes $schema/const/type arrays and keeps description inside anyOf branches", () => {
    const edge = loadFixture("edge-cases");
    const r = transformTools(edge, "gemini-parameters");
    const byName = Object.fromEntries(r.tools.map((t) => [t.name, t.inputSchema]));
    expect(byName.refs_tool.$schema).toBeUndefined();
    expect(byName.refs_tool.$defs).toBeUndefined();
    expect(byName.refs_tool.properties.home.properties.street.type).toBe("string");
    expect(byName.types_tool.properties.id.anyOf).toEqual([{ type: "string" }, { type: "integer" }].map((b) => expect.objectContaining(b)));
    expect(byName.types_tool.properties.note).toMatchObject({ type: "string", nullable: true });
    expect(byName.types_tool.properties.level).toMatchObject({ type: "string", enum: ["2"] });
    expect(byName.union_siblings.properties.value.description).toBeUndefined();
    expect(byName.union_siblings.properties.value.anyOf.every((b: { description?: string }) => b.description === "text or number")).toBe(true);
    expect(byName.union_siblings.properties.combined.properties).toHaveProperty("b");
    expect(byName.union_siblings.properties.combined.required).toEqual(["a"]);
  });

  it("anthropic-strict: renames invalid tool names without collisions and moves constraints into descriptions", () => {
    const r = transformTools(loadFixture("edge-cases"), "anthropic-strict");
    const names = r.tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("fs_read_file");
    expect(names).toContain("fs_read_file_2");
    expect(r.map.tools["fs_read_file_2"].originalName).toBe("fs.read_file");
    const constraints = r.tools.find((t) => t.name === "constraints_tool")!.inputSchema;
    expect(constraints.properties.name.minLength).toBeUndefined();
    expect(constraints.properties.name.description).toContain("minLength 2");
    expect(constraints.properties.at.pattern).toBeUndefined();
  });

  it("records lossy changes in the map", () => {
    const r = transformTools(loadFixture("sdk-v1-tools"), "anthropic-strict");
    const entries = r.map.tools["search_issues"].entries;
    const lossy = entries.filter((e) => e.lossy).map((e) => e.detail);
    expect(lossy).toEqual(expect.arrayContaining(["minLength 1", "minimum 1", "maximum 100"]));
  });
});
