import type { JsonSchema, McpTool } from "../types.js";
import { defineRules } from "../rules/registry.js";
import { DOC_URLS } from "../rules/docs.js";
import { inlineRefs } from "../refs.js";
import { mapChildren, isObj } from "../walk.js";
import { appendDescription, brief, ensureObjectRoot, isObjectSchema, refHooks, type Ctx, type Profile } from "./common.js";

const DOC = DOC_URLS.anthropicStructured;

export const rules = defineRules("anthropic-strict", [
  { name: "unsupported-constraint", severity: "error", fixable: true, summary: "minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, minLength and maxLength, and array constraints (maxItems, uniqueItems, minItems of 2 or more; minItems 0 and 1 are fine) are rejected (400); they move into the description and the original schema re-checks them on restore.", docUrl: DOC },
  { name: "complex-pattern", severity: "error", fixable: true, summary: "Complex regular expressions (longer than 200 characters, back-references, look-around, word boundaries \\b and \\B) are rejected; the pattern moves into the description.", docUrl: DOC },
  { name: "unsupported-format", severity: "error", fixable: true, summary: "Only date-time, time, date, duration, email, hostname, uri, ipv4, ipv6 and uuid formats are supported; others are rejected (400) and move into the description.", docUrl: DOC },
  { name: "additional-properties", severity: "warning", fixable: true, summary: "Objects should set additionalProperties: false explicitly (true is rejected).", docUrl: DOC },
  { name: "additional-properties-schema", severity: "error", fixable: false, summary: "A schema-valued additionalProperties (map) is not supported; only false is.", docUrl: DOC },
  { name: "ref-recursive", severity: "error", fixable: false, summary: "Recursive $ref is not supported.", docUrl: DOC },
  { name: "ref-external", severity: "error", fixable: false, summary: "External $ref is not supported.", docUrl: DOC },
  { name: "tool-name", severity: "error", fixable: true, summary: "Tool names must match ^[a-zA-Z0-9_-]{1,128}$; the name is rewritten and the proxy maps it back.", docUrl: DOC_URLS.anthropicToolUse },
  { name: "root-type", severity: "warning", fixable: true, summary: 'The root schema needs type "object".', docUrl: DOC_URLS.anthropicToolUse },
  { name: "root-object", severity: "error", fixable: false, summary: "The root schema must be an object schema.", docUrl: DOC_URLS.anthropicToolUse },
  { name: "limit-tools", severity: "error", fixable: false, summary: "At most 20 strict tools are allowed in one request (docs: \"Maximum number of tools with `strict: true`\"). Counted over the whole tool list.", docUrl: DOC },
  { name: "limit-optional", severity: "error", fixable: false, summary: "At most 24 optional parameters are allowed across all strict tool schemas in one request (docs: \"Each parameter not listed in `required` counts toward this limit\"). Counted at every nesting level over the whole tool list.", docUrl: DOC },
]);

// Request-level limits from the Anthropic structured-outputs documentation (limits table), read 2026-11-12:
// https://platform.claude.com/docs/en/build-with-claude/structured-outputs
// Not verified against the live API.
const MAX_STRICT_TOOLS = 20;
const MAX_OPTIONAL_PARAMS = 24;

const CONSTRAINTS = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength"];

const FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);

/** Array keywords that are rejected; minItems is handled separately because 0 and 1 are allowed. */
const ARRAY_CONSTRAINTS = ["maxItems", "uniqueItems"];

/** True when the pattern has \b or \B that is not itself escaped (an escaped backslash followed by b is a literal). */
const WORD_BOUNDARY = /(?:^|[^\\])(?:\\\\)*\\[bB]/;

function isComplexPattern(p: string): boolean {
  return p.length > 200 || /\\[1-9]/.test(p) || /\(\?<?[=!]/.test(p) || WORD_BOUNDARY.test(p);
}

function visit(input: JsonSchema, pointer: string, argPath: string, ctx: Ctx): JsonSchema {
  const n: JsonSchema = { ...input };

  const moved: string[] = [];
  for (const k of CONSTRAINTS) {
    if (!(k in n)) continue;
    ctx.emit("unsupported-constraint", pointer + "/" + k, k + " is rejected by strict tool use; it moved into the description");
    ctx.record({ op: "constraint-to-description", schemaPointer: pointer, argPath, lossy: true, detail: k + " " + brief(n[k]) });
    moved.push(k + " " + brief(n[k]));
    delete n[k];
  }
  const arrayKeys = n.minItems !== undefined && !(typeof n.minItems === "number" && n.minItems <= 1) ? ["minItems", ...ARRAY_CONSTRAINTS] : ARRAY_CONSTRAINTS;
  for (const k of arrayKeys) {
    if (!(k in n)) continue;
    ctx.emit("unsupported-constraint", pointer + "/" + k, k + " is rejected by strict tool use; it moved into the description");
    ctx.record({ op: "constraint-to-description", schemaPointer: pointer, argPath, lossy: true, detail: k + " " + brief(n[k]) });
    moved.push(k + " " + brief(n[k]));
    delete n[k];
  }
  if (typeof n.format === "string" && !FORMATS.has(n.format)) {
    ctx.emit("unsupported-format", pointer + "/format", 'format "' + n.format + '" is not supported by strict tool use; it moved into the description');
    ctx.record({ op: "constraint-to-description", schemaPointer: pointer, argPath, lossy: true, detail: "format " + n.format });
    moved.push("format: " + n.format);
    delete n.format;
  }
  if (typeof n.pattern === "string" && isComplexPattern(n.pattern)) {
    ctx.emit("complex-pattern", pointer + "/pattern", "pattern is too complex for strict tool use; it moved into the description");
    ctx.record({ op: "constraint-to-description", schemaPointer: pointer, argPath, lossy: true, detail: "pattern (complex)" });
    moved.push("pattern " + brief(n.pattern, 80));
    delete n.pattern;
  }
  if (moved.length > 0) appendDescription(n, "constraints: " + moved.join(", "));

  if (isObjectSchema(n) && isObj(n.properties)) {
    if (n.additionalProperties === undefined) {
      ctx.emit("additional-properties", pointer + "/additionalProperties", "Object does not set additionalProperties: false; it was added");
      n.additionalProperties = false;
    } else if (n.additionalProperties === true) {
      ctx.emit("additional-properties", pointer + "/additionalProperties", "additionalProperties: true is not supported; it was set to false");
      ctx.record({ op: "dropped", schemaPointer: pointer, argPath, lossy: true, detail: "additionalProperties: true replaced by false" });
      n.additionalProperties = false;
    }
  }
  if (isObj(n.additionalProperties)) {
    ctx.emit("additional-properties-schema", pointer + "/additionalProperties", "A schema-valued additionalProperties (map) is not supported");
  }

  return mapChildren(n, pointer, argPath, (c, p, a) => visit(c, p, a, ctx));
}

export function transformSchema(root: JsonSchema, ctx: Ctx): JsonSchema {
  const inlined = inlineRefs(root, refHooks(ctx));
  return ensureObjectRoot(visit(inlined, "", "", ctx), ctx);
}

const VALID_NAME = /^[a-zA-Z0-9_-]{1,128}$/;

export function mapToolName(name: string): string {
  if (VALID_NAME.test(name)) return name;
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
  return cleaned.length > 0 ? cleaned : "tool";
}

/** Count keys of `properties` that are not listed in `required`, at every nesting level. `$defs`/`definitions` are skipped. */
function countOptional(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((sum: number, n) => sum + countOptional(n), 0);
  if (!isObj(node)) return 0;
  let total = 0;
  for (const [k, v] of Object.entries(node)) {
    if (k === "$defs" || k === "definitions") continue;
    if (k === "properties" && isObj(v)) {
      const required: unknown[] = Array.isArray(node.required) ? node.required : [];
      for (const [name, child] of Object.entries(v)) {
        if (!required.includes(name)) total++;
        total += countOptional(child);
      }
    } else if (k !== "required" && k !== "enum" && k !== "const" && k !== "default" && k !== "examples") {
      total += countOptional(v);
    }
  }
  return total;
}

/** List-wide checks: the API limits apply to the whole request, not to one tool. */
export function checkToolList(tools: McpTool[], emit: (name: string, message: string) => void): void {
  if (tools.length > MAX_STRICT_TOOLS) emit("limit-tools", tools.length + " strict tools in one request (limit " + MAX_STRICT_TOOLS + ")");
  const optional = tools.reduce((sum, t) => sum + countOptional(t.inputSchema), 0);
  if (optional > MAX_OPTIONAL_PARAMS) emit("limit-optional", optional + " optional parameters across all strict tool schemas (limit " + MAX_OPTIONAL_PARAMS + ")");
}

export const anthropicStrict: Profile = {
  id: "anthropic-strict",
  title: "Anthropic strict tool use",
  description: "`strict: true` tools reject numeric/length constraints and complex patterns, and tool names must match ^[a-zA-Z0-9_-]{1,128}$. Request limits: at most 20 strict tools and 24 optional parameters in total.",
  docUrl: DOC_URLS.anthropicStructured,
  rules,
  transformSchema,
  mapToolName,
  nameRule: "tool-name",
  checkToolList,
};
