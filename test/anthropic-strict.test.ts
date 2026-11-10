import { describe, expect, it } from "vitest";
import { check, restore, RestoreError, transformTools, type McpTool } from "../src/index.js";

const RULE = "anthropic-strict/";

function tool(properties: Record<string, unknown>): McpTool {
  return {
    name: "t",
    inputSchema: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
  } as McpTool;
}

const ids = (t: McpTool): string[] => check(t, "anthropic-strict").map((d) => d.ruleId + " " + d.pointer).sort();

// Reproduction schemas from the bug report (arr.json / pat.json).
const arr = tool({
  tags: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
  link: { type: "string", format: "uri-reference" },
});
const pat = tool({ s: { type: "string", pattern: "\\bfoo\\b" } });

describe("anthropic-strict: array constraints, format, word boundary", () => {
  // AC-1
  it("AC1: reports maxItems, uniqueItems and minItems >= 2 as fixable errors", () => {
    const t = tool({ tags: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5, uniqueItems: true } });
    const diags = check(t, "anthropic-strict").filter((d) => d.ruleId === RULE + "unsupported-constraint");
    expect(diags.map((d) => d.pointer).sort()).toEqual(
      ["/properties/tags/maxItems", "/properties/tags/minItems", "/properties/tags/uniqueItems"].sort(),
    );
    expect(diags.every((d) => d.severity === "error" && d.fixable)).toBe(true);
  });

  it("AC1: fix removes them, moves them into the description and records a lossy entry", () => {
    const r = transformTools([arr], "anthropic-strict");
    const tags = r.tools[0].inputSchema.properties.tags;
    expect(tags.minItems).toBeUndefined();
    expect(tags.maxItems).toBeUndefined();
    expect(tags.description).toContain("constraints:");
    expect(tags.description).toContain("minItems 2");
    expect(tags.description).toContain("maxItems 5");
    const entries = r.map.tools["t"].entries.filter((e) => e.op === "constraint-to-description");
    expect(entries.every((e) => e.lossy)).toBe(true);
    expect(entries.map((e) => e.detail)).toEqual(expect.arrayContaining(["minItems 2", "maxItems 5"]));
    expect(check(r.tools[0], "anthropic-strict")).toEqual([]);
  });

  it("AC1 control: minItems 0 and 1 are left alone", () => {
    for (const minItems of [0, 1]) {
      const t = tool({ tags: { type: "array", items: { type: "string" }, minItems } });
      expect(ids(t)).toEqual([]);
      expect(transformTools([t], "anthropic-strict").tools[0].inputSchema.properties.tags.minItems).toBe(minItems);
    }
  });

  // AC-2
  it("AC2: reports a format outside the supported list and moves it into the description", () => {
    expect(ids(arr)).toContain(RULE + "unsupported-format /properties/link/format");
    const d = check(arr, "anthropic-strict").find((x) => x.ruleId === RULE + "unsupported-format")!;
    expect(d).toMatchObject({ severity: "error", fixable: true });
    const r = transformTools([arr], "anthropic-strict");
    const link = r.tools[0].inputSchema.properties.link;
    expect(link.format).toBeUndefined();
    expect(link.description).toContain("format: uri-reference");
    expect(r.map.tools["t"].entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ op: "constraint-to-description", lossy: true, detail: "format uri-reference" })]),
    );
  });

  it("AC2 control: every supported format is kept", () => {
    for (const format of ["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]) {
      const t = tool({ v: { type: "string", format } });
      expect(ids(t), format).toEqual([]);
      expect(transformTools([t], "anthropic-strict").tools[0].inputSchema.properties.v.format).toBe(format);
    }
  });

  // AC-3
  it("AC3: \\b and \\B patterns are complex-pattern errors and move into the description", () => {
    expect(ids(pat)).toEqual([RULE + "complex-pattern /properties/s/pattern"]);
    const b = tool({ s: { type: "string", pattern: "a\\Bb" } });
    expect(ids(b)).toEqual([RULE + "complex-pattern /properties/s/pattern"]);
    const s = transformTools([pat], "anthropic-strict").tools[0].inputSchema.properties.s;
    expect(s.pattern).toBeUndefined();
    expect(s.description).toContain("pattern");
  });

  it("AC3 control: simple patterns and an escaped backslash + b literal are kept", () => {
    expect(ids(tool({ s: { type: "string", pattern: "^[a-z]+$" } }))).toEqual([]);
    // JSON-decoded pattern \\b is a literal backslash followed by b, not a word boundary.
    expect(ids(tool({ s: { type: "string", pattern: "\\\\b" } }))).toEqual([]);
  });

  // AC-4
  it("AC4: restore still rejects values the moved constraints would have refused", () => {
    const { map } = transformTools([arr], "anthropic-strict");
    let error: unknown;
    try {
      restore("t", { tags: ["one"], link: "http://exa mple" }, map);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(RestoreError);
    const keywords = (error as RestoreError).issues.map((i) => i.keyword);
    expect(keywords).toContain("minItems");
    expect(keywords).toContain("format");
  });

  // AC-5
  it("AC5: control schema (minItems 1, date-time, simple pattern) checks clean and is unchanged by fix", () => {
    const ok = tool({
      a: { type: "array", items: { type: "string" }, minItems: 1 },
      d: { type: "string", format: "date-time" },
      p: { type: "string", pattern: "^[a-z]+$" },
    });
    expect(ids(ok)).toEqual([]);
    expect(transformTools([ok], "anthropic-strict").tools[0].inputSchema).toEqual(ok.inputSchema);
  });

  it("AC5: the fixed reproduction schemas re-check clean", () => {
    for (const t of [arr, pat]) {
      expect(check(transformTools([t], "anthropic-strict").tools[0], "anthropic-strict")).toEqual([]);
    }
  });
});
