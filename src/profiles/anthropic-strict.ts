import type { JsonSchema } from "../types.js";
import { defineRules } from "../rules/registry.js";
import { DOC_URLS } from "../rules/docs.js";
import { inlineRefs } from "../refs.js";
import { mapChildren, isObj } from "../walk.js";
import { appendDescription, brief, ensureObjectRoot, isObjectSchema, refHooks, type Ctx, type Profile } from "./common.js";

const DOC = DOC_URLS.anthropicStructured;

export const rules = defineRules("anthropic-strict", [
  { name: "unsupported-constraint", severity: "error", fixable: true, summary: "minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, minLength and maxLength are rejected (400); they move into the description and the original schema re-checks them on restore.", docUrl: DOC },
  { name: "complex-pattern", severity: "error", fixable: true, summary: "Complex regular expressions (longer than 200 characters, back-references, look-around) are rejected; the pattern moves into the description.", docUrl: DOC },
  { name: "additional-properties", severity: "warning", fixable: true, summary: "Objects should set additionalProperties: false explicitly (true is rejected).", docUrl: DOC },
  { name: "additional-properties-schema", severity: "error", fixable: false, summary: "A schema-valued additionalProperties (map) is not supported; only false is.", docUrl: DOC },
  { name: "ref-recursive", severity: "error", fixable: false, summary: "Recursive $ref is not supported.", docUrl: DOC },
  { name: "ref-external", severity: "error", fixable: false, summary: "External $ref is not supported.", docUrl: DOC },
  { name: "tool-name", severity: "error", fixable: true, summary: "Tool names must match ^[a-zA-Z0-9_-]{1,128}$; the name is rewritten and the proxy maps it back.", docUrl: DOC_URLS.anthropicToolUse },
  { name: "root-type", severity: "warning", fixable: true, summary: 'The root schema needs type "object".', docUrl: DOC_URLS.anthropicToolUse },
  { name: "root-object", severity: "error", fixable: false, summary: "The root schema must be an object schema.", docUrl: DOC_URLS.anthropicToolUse },
]);

const CONSTRAINTS = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength"];

function isComplexPattern(p: string): boolean {
  return p.length > 200 || /\\[1-9]/.test(p) || /\(\?<?[=!]/.test(p);
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
  if (typeof n.pattern === "string" && isComplexPattern(n.pattern)) {
    ctx.emit("complex-pattern", pointer + "/pattern", "pattern is too complex for strict tool use; it moved into the description");
    ctx.record({ op: "constraint-to-description", schemaPointer: pointer, argPath, lossy: true, detail: "pattern (complex)" });
    moved.push(n.format ? "format " + n.format : "pattern " + brief(n.pattern, 80));
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

export const anthropicStrict: Profile = {
  id: "anthropic-strict",
  title: "Anthropic strict tool use",
  description: "`strict: true` tools reject numeric/length constraints and complex patterns, and tool names must match ^[a-zA-Z0-9_-]{1,128}$.",
  docUrl: DOC_URLS.anthropicStructured,
  rules,
  transformSchema,
  mapToolName,
  nameRule: "tool-name",
};
