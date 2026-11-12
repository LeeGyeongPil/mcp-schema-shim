import type { McpTool, ProfileId, ShimMap, TransformOptions, TransformResult, TransformToolResult } from "./types.js";
import { inputError } from "./i18n.js";
import { getProfile } from "./profiles/index.js";
import { createCtx } from "./profiles/common.js";
import { isObj } from "./walk.js";

function assertTool(tool: unknown, index: number | string): asserts tool is McpTool {
  if (!isObj(tool) || typeof tool.name !== "string" || tool.name.length === 0) {
    throw inputError("err.toolName", { index });
  }
  if (!isObj(tool.inputSchema)) {
    throw inputError("err.toolSchema", { index, name: tool.name });
  }
}

/** Transform one tool for a profile. The input is never mutated. */
export function transformTool(tool: McpTool, profile: ProfileId, opts: TransformOptions = {}): TransformToolResult {
  assertTool(tool, 0);
  const p = getProfile(profile);
  const ctx = createCtx(profile, p.rules, tool.name);
  const originalSchema = structuredClone(tool.inputSchema);

  let name = tool.name;
  if (p.mapToolName && p.nameRule) {
    const mapped = p.mapToolName(tool.name);
    if (mapped !== tool.name) {
      const used = opts.usedNames ?? new Set<string>();
      let candidate = mapped;
      for (let i = 2; used.has(candidate); i++) candidate = mapped.slice(0, 120) + "_" + i;
      ctx.emit(p.nameRule, "/name", 'Tool name "' + tool.name + '" is not allowed; it was renamed to "' + candidate + '"');
      ctx.record({ op: "name-mapped", schemaPointer: "/name", argPath: "", lossy: false, detail: tool.name + " -> " + candidate });
      name = candidate;
    }
  }

  const inputSchema = p.transformSchema(structuredClone(tool.inputSchema), ctx);
  return {
    tool: { ...structuredClone(tool), name, inputSchema },
    toolMap: { originalName: tool.name, originalSchema, entries: ctx.entries },
    diagnostics: ctx.diagnostics,
  };
}

/** Transform a list of tools (e.g. a `tools/list` result) and build the map `restore()` needs. */
export function transformTools(tools: McpTool[], profile: ProfileId, opts: TransformOptions = {}): TransformResult {
  if (!Array.isArray(tools)) throw inputError("err.toolsArray");
  const p = getProfile(profile);
  const used = new Set(opts.usedNames ?? []);
  // Names that stay as they are are reserved first, so a renamed tool can never take one of them.
  tools.forEach((tool, i) => {
    assertTool(tool, i);
    if (!p.mapToolName || p.mapToolName(tool.name) === tool.name) used.add(tool.name);
  });
  const map: ShimMap = { version: 1, profile, tools: {} };
  const out: McpTool[] = [];
  const diagnostics: TransformResult["diagnostics"] = [];
  tools.forEach((tool, i) => {
    assertTool(tool, i);
    const r = transformTool(tool, profile, { usedNames: used });
    used.add(r.tool.name);
    out.push(r.tool);
    map.tools[r.tool.name] = r.toolMap;
    diagnostics.push(...r.diagnostics);
  });
  if (p.checkToolList) {
    // List-wide (request-level) findings are reported on the transformed tools, under the pseudo tool "(all tools)".
    const byId = new Map(p.rules.map((r) => [r.id, r]));
    p.checkToolList(out, (ruleName, message) => {
      const rule = byId.get(profile + "/" + ruleName);
      if (!rule) throw new Error("internal: unknown rule " + profile + "/" + ruleName);
      diagnostics.push({ tool: "(all tools)", pointer: "", ruleId: rule.id, profile, severity: rule.severity, fixable: rule.fixable, message, docUrl: rule.docUrl });
    });
  }
  return { tools: out, map, diagnostics };
}
