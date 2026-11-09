import type { JsonSchema } from "../types.js";
import { defineRules } from "../rules/registry.js";
import { DOC_URLS } from "../rules/docs.js";
import { inlineRefs } from "../refs.js";
import { mapChildren, isObj } from "../walk.js";
import { appendDescription, brief, ensureObjectRoot, mergeAllOf, refHooks, type Ctx, type Profile } from "./common.js";

const DOC = DOC_URLS.geminiSchema;

export const rules = defineRules("gemini-parameters", [
  { name: "meta-keyword", severity: "error", fixable: true, summary: "$schema/$id/$comment/$anchor are not Schema fields and make the request fail; they are removed.", docUrl: DOC },
  { name: "const", severity: "error", fixable: true, summary: "const is not a Schema field; it becomes a one-value enum (non-string values are stringified and restored later).", docUrl: DOC },
  { name: "enum-non-string", severity: "error", fixable: true, summary: "enum is only defined for strings; other values are stringified (type becomes string) and restored later.", docUrl: DOC },
  { name: "type-array", severity: "error", fixable: true, summary: 'type arrays such as ["string","null"] are not allowed; they become nullable or a sibling-free anyOf.', docUrl: DOC },
  { name: "anyof-siblings", severity: "error", fixable: true, summary: "anyOf must not have sibling fields; siblings (including description) move into each branch.", docUrl: DOC },
  { name: "one-of", severity: "warning", fixable: true, summary: "oneOf is not a Schema field; it becomes anyOf (exclusivity is not enforced upstream, the original schema re-checks it).", docUrl: DOC },
  { name: "all-of", severity: "warning", fixable: true, summary: "allOf is not a Schema field; object branches are merged into the node.", docUrl: DOC },
  { name: "ref-inlined", severity: "error", fixable: true, summary: "$ref/$defs are not Schema fields; local references are inlined.", docUrl: DOC },
  { name: "ref-recursive", severity: "error", fixable: false, summary: "Recursive $ref cannot be inlined. Use the gemini-json-schema profile (parametersJsonSchema) instead.", docUrl: DOC },
  { name: "ref-external", severity: "error", fixable: false, summary: "$ref that points outside the schema cannot be resolved.", docUrl: DOC },
  { name: "unsupported-keyword", severity: "warning", fixable: true, summary: "Keywords outside the Schema object (additionalProperties, not, if/then/else, patternProperties, multipleOf, ...) are removed; primitive values are kept in the description.", docUrl: DOC },
  { name: "format-unsupported", severity: "warning", fixable: true, summary: "Only a few formats are accepted (string: enum, date-time; numbers: int32, int64, float, double); other formats move into the description.", docUrl: DOC },
  { name: "missing-type", severity: "warning", fixable: true, summary: "properties without type: object are rejected; type is added.", docUrl: DOC },
  { name: "array-items-missing", severity: "warning", fixable: true, summary: "An array schema needs items; a string item schema is added (the original schema re-checks the values).", docUrl: DOC },
  { name: "root-type", severity: "warning", fixable: true, summary: 'The root schema needs type "object".', docUrl: DOC },
  { name: "root-object", severity: "error", fixable: false, summary: "The root schema must be an object schema, not a combinator or another type.", docUrl: DOC },
]);

const ALLOWED = new Set([
  "type", "format", "title", "description", "nullable", "enum", "maxItems", "minItems", "properties", "required",
  "minProperties", "maxProperties", "minLength", "maxLength", "pattern", "example", "anyOf", "propertyOrdering",
  "default", "items", "minimum", "maximum",
]);
const META = ["$schema", "$id", "$comment", "$anchor"];
const STRING_FORMATS = new Set(["enum", "date-time"]);
const NUMBER_FORMATS = new Set(["int32", "int64", "float", "double"]);

function visit(input: JsonSchema, pointer: string, argPath: string, ctx: Ctx): JsonSchema {
  let n: JsonSchema = { ...input };

  for (const k of META) {
    if (k in n) {
      ctx.emit("meta-keyword", pointer + "/" + k, k + " is not supported in Gemini function declaration parameters");
      delete n[k];
    }
  }

  if (Array.isArray(n.allOf)) {
    const merged = mergeAllOf(n);
    ctx.emit("all-of", pointer + "/allOf", "allOf is not supported; its branches were merged");
    if (merged) {
      ctx.record({ op: "all-of-merged", schemaPointer: pointer, argPath, lossy: false, detail: "allOf branches merged into the node" });
      n = merged;
    } else {
      delete n.allOf;
      ctx.record({ op: "dropped", schemaPointer: pointer, argPath, lossy: true, detail: "allOf contained non-object branches and was dropped" });
    }
  }

  if (Array.isArray(n.oneOf)) {
    ctx.emit("one-of", pointer + "/oneOf", "oneOf is not supported; it was converted to anyOf");
    ctx.record({ op: "one-of-to-any-of", schemaPointer: pointer, argPath, lossy: true, detail: "oneOf became anyOf (exclusivity not enforced upstream)" });
    n.anyOf = Array.isArray(n.anyOf) ? [...n.anyOf, ...n.oneOf] : n.oneOf;
    delete n.oneOf;
  }

  // const -> enum
  let fromConst = false;
  if ("const" in n) {
    ctx.emit("const", pointer + "/const", "const is not supported; it was converted to a one-value enum");
    n.enum = [n.const];
    delete n.const;
    fromConst = true;
  }

  // type arrays
  if (Array.isArray(n.type)) {
    ctx.emit("type-array", pointer + "/type", "type arrays are not supported (" + brief(n.type) + ")");
    const nonNull: string[] = n.type.filter((t: string) => t !== "null");
    const hasNull = nonNull.length !== n.type.length;
    if (nonNull.length <= 1) {
      n.type = nonNull[0] ?? "string";
      if (hasNull) n.nullable = true;
    } else {
      const rest: JsonSchema = { ...n };
      delete rest.type;
      const branches = nonNull.map((t, i) => ({ ...rest, type: t, ...(hasNull && i === 0 ? { nullable: true } : {}) }));
      n = { anyOf: branches };
    }
  }

  // enum values must be strings
  if (Array.isArray(n.enum) && n.enum.some((v: unknown) => typeof v !== "string")) {
    if (!fromConst) ctx.emit("enum-non-string", pointer + "/enum", "enum values must be strings; " + brief(n.enum) + " were stringified");
    ctx.record({
      op: "enum-stringified",
      schemaPointer: pointer,
      argPath,
      lossy: false,
      detail: "enum values stringified: " + brief(n.enum),
      values: [...n.enum],
    });
    n.enum = n.enum.map((v: unknown) => String(v));
    n.type = "string";
  } else if (Array.isArray(n.enum) && n.type === undefined) {
    n.type = "string";
  }

  // anyOf siblings
  if (Array.isArray(n.anyOf)) {
    const { anyOf, ...rest } = n;
    if (Object.keys(rest).length > 0) {
      ctx.emit("anyof-siblings", pointer, "anyOf has sibling fields (" + Object.keys(rest).join(", ") + "); they were moved into each branch");
      n = { anyOf: (anyOf as unknown[]).map((b) => (isObj(b) ? { ...rest, ...b } : b)) };
    }
  }

  // format
  if (typeof n.format === "string") {
    const ok = n.type === "string" ? STRING_FORMATS.has(n.format) : n.type === "number" || n.type === "integer" ? NUMBER_FORMATS.has(n.format) : false;
    if (!ok) {
      ctx.emit("format-unsupported", pointer + "/format", 'format "' + n.format + '" is not accepted here; it moved into the description');
      ctx.record({ op: "constraint-to-description", schemaPointer: pointer, argPath, lossy: true, detail: "format " + n.format });
      appendDescription(n, "format: " + n.format);
      delete n.format;
    }
  }

  // structural repairs
  if (isObj(n.properties) && n.type === undefined && !Array.isArray(n.anyOf)) {
    ctx.emit("missing-type", pointer + "/type", 'properties without "type": "object"; type was added');
    n.type = "object";
  }
  if (n.type === "array" && !isObj(n.items)) {
    ctx.emit("array-items-missing", pointer + "/items", "array schema without items; a string item schema was added");
    ctx.record({ op: "dropped", schemaPointer: pointer, argPath: argPath + "/*", lossy: true, detail: "items was missing; string items added" });
    n.items = { type: "string" };
  }

  // whitelist of Schema fields
  for (const k of Object.keys(n)) {
    if (ALLOWED.has(k)) continue;
    const v = n[k];
    ctx.emit("unsupported-keyword", pointer + "/" + k, k + " is not part of the Gemini Schema object; it was removed");
    ctx.record({ op: "dropped", schemaPointer: pointer, argPath, lossy: true, detail: "removed keyword " + k });
    if (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length < 60)) appendDescription(n, k + ": " + brief(v));
    delete n[k];
  }

  return mapChildren(n, pointer, argPath, (c, p, a) => visit(c, p, a, ctx));
}

export function transformSchema(root: JsonSchema, ctx: Ctx): JsonSchema {
  const inlined = inlineRefs(root, refHooks(ctx));
  const visited = visit(inlined, "", "", ctx);
  return ensureObjectRoot(visited, ctx);
}

export const geminiParameters: Profile = {
  id: "gemini-parameters",
  title: "Gemini function declarations — parameters (OpenAPI Schema subset)",
  description: "The classic `parameters` field of a Gemini FunctionDeclaration. Accepts only an OpenAPI 3.0 Schema subset; one bad tool fails the whole request.",
  docUrl: DOC_URLS.geminiFunctionCalling,
  rules,
  transformSchema,
};
