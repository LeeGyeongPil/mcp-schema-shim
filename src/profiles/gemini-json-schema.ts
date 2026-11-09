import type { JsonSchema } from "../types.js";
import { defineRules } from "../rules/registry.js";
import { DOC_URLS } from "../rules/docs.js";
import { mapChildren } from "../walk.js";
import { ensureObjectRoot, type Ctx, type Profile } from "./common.js";

const DOC = DOC_URLS.geminiStructured;

export const rules = defineRules("gemini-json-schema", [
  { name: "root-type", severity: "warning", fixable: true, summary: 'The root schema needs type "object".', docUrl: DOC_URLS.geminiFunctionCalling },
  { name: "root-object", severity: "error", fixable: false, summary: "The root schema must describe an object.", docUrl: DOC_URLS.geminiFunctionCalling },
  { name: "ref-external", severity: "error", fixable: false, summary: "$ref that points outside the schema cannot be resolved by the API.", docUrl: DOC },
  { name: "ignored-keyword", severity: "info", fixable: false, summary: "minLength/maxLength are stripped and ignored; the original schema still checks them when the shim restores arguments.", docUrl: DOC },
]);

const IGNORED = ["minLength", "maxLength"];

function visit(input: JsonSchema, pointer: string, argPath: string, ctx: Ctx): JsonSchema {
  if (typeof input.$ref === "string" && !input.$ref.startsWith("#")) {
    ctx.emit("ref-external", pointer + "/$ref", "$ref " + input.$ref + " points outside the schema");
  }
  for (const k of IGNORED) {
    if (k in input) ctx.emit("ignored-keyword", pointer + "/" + k, k + " is ignored by the API (the model is not constrained by it)");
  }
  return mapChildren(input, pointer, argPath, (c, p, a) => visit(c, p, a, ctx));
}

export function transformSchema(root: JsonSchema, ctx: Ctx): JsonSchema {
  // parametersJsonSchema is tolerant: no keyword rewriting is needed, only the root and diagnostics.
  return ensureObjectRoot(visit(root, "", "", ctx), ctx);
}

export const geminiJsonSchema: Profile = {
  id: "gemini-json-schema",
  title: "Gemini function declarations — parametersJsonSchema",
  description: "The newer `parametersJsonSchema` field takes real JSON Schema (including $ref/$defs and const) and ignores keywords it does not use.",
  docUrl: DOC_URLS.geminiFunctionCalling,
  rules,
  transformSchema,
};
