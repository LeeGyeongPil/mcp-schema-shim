import type { JsonSchema } from "../types.js";
import { defineRules } from "../rules/registry.js";
import { DOC_URLS } from "../rules/docs.js";
import { inlineRefs } from "../refs.js";
import { mapChildren, isObj, esc, escArg } from "../walk.js";
import { allowsNull, appendDescription, brief, ensureObjectRoot, isObjectSchema, mergeAllOf, refHooks, type Ctx, type Profile } from "./common.js";

const DOC = DOC_URLS.openaiStructured;

export const rules = defineRules("openai-strict", [
  { name: "additional-properties", severity: "error", fixable: true, summary: "Every object needs additionalProperties: false.", docUrl: DOC },
  { name: "optional-property", severity: "error", fixable: true, summary: "Every property must be listed in required; optional ones become nullable (the shim removes the null again when arguments are restored).", docUrl: DOC },
  { name: "const", severity: "warning", fixable: true, summary: "const is not in the list of supported keywords; it becomes a one-value enum.", docUrl: DOC },
  { name: "unsupported-keyword", severity: "warning", fixable: true, summary: "not, if/then/else, dependentRequired/dependentSchemas, patternProperties (and allOf that cannot be merged) are not supported; they are removed.", docUrl: DOC },
  { name: "unsupported-format", severity: "warning", fixable: true, summary: "Only date-time, time, date, duration, email, hostname, ipv4, ipv6 and uuid formats are supported; others move into the description.", docUrl: DOC },
  { name: "all-of", severity: "warning", fixable: true, summary: "allOf is not supported; object branches are merged into the node.", docUrl: DOC },
  { name: "free-form-object", severity: "error", fixable: false, summary: "Objects without fixed properties (free-form maps) cannot be expressed in strict mode. Planned: JSON-string field conversion.", docUrl: DOC },
  { name: "root-anyof", severity: "error", fixable: false, summary: "The root schema must not be an anyOf.", docUrl: DOC },
  { name: "root-type", severity: "warning", fixable: true, summary: 'The root schema needs type "object".', docUrl: DOC },
  { name: "root-object", severity: "error", fixable: false, summary: "The root schema must be an object schema.", docUrl: DOC },
  { name: "ref-recursive", severity: "error", fixable: false, summary: "Recursive $ref: argument restore cannot follow recursive structures yet.", docUrl: DOC },
  { name: "ref-external", severity: "error", fixable: false, summary: "$ref that points outside the schema cannot be resolved.", docUrl: DOC },
  { name: "limit-depth", severity: "error", fixable: false, summary: "At most 10 levels of nesting are allowed.", docUrl: DOC },
  { name: "limit-properties", severity: "error", fixable: false, summary: "At most 5000 properties in total are allowed.", docUrl: DOC },
  { name: "limit-enum", severity: "error", fixable: false, summary: "At most 1000 enum values in total are allowed.", docUrl: DOC },
]);

const FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "ipv4", "ipv6", "uuid"]);
const UNSUPPORTED = ["not", "if", "then", "else", "dependentRequired", "dependentSchemas", "patternProperties"];
const MAX_DEPTH = 10;

/** Make a schema accept null in addition to what it accepts now. */
function makeNullable(node: JsonSchema): JsonSchema {
  if (allowsNull(node)) return node;
  const t = node.type;
  if (Array.isArray(node.anyOf)) return { ...node, anyOf: [...node.anyOf, { type: "null" }] };
  if (typeof t === "string" && t !== "object" && t !== "array") {
    const out: JsonSchema = { ...node, type: [t, "null"] };
    if (Array.isArray(node.enum)) out.enum = [...node.enum, null];
    return out;
  }
  if (Array.isArray(t) && !t.includes("object") && !t.includes("array")) {
    const out: JsonSchema = { ...node, type: [...t, "null"] };
    if (Array.isArray(node.enum)) out.enum = [...node.enum, null];
    return out;
  }
  if (t === undefined && Array.isArray(node.enum)) return { ...node, enum: [...node.enum, null] };
  const { description, ...rest } = node;
  return { ...(description !== undefined ? { description } : {}), anyOf: [rest, { type: "null" }] };
}

interface Stats {
  properties: number;
  enumValues: number;
  depthReported: boolean;
}

function visit(input: JsonSchema, pointer: string, argPath: string, ctx: Ctx, depth: number, isRoot: boolean, stats: Stats): JsonSchema {
  let n: JsonSchema = { ...input };

  if (depth > MAX_DEPTH && !stats.depthReported) {
    stats.depthReported = true;
    ctx.emit("limit-depth", pointer, "Nesting is deeper than " + MAX_DEPTH + " levels");
  }

  if (Array.isArray(n.allOf)) {
    const merged = mergeAllOf(n);
    ctx.emit("all-of", pointer + "/allOf", "allOf is not supported; its branches were merged");
    if (merged) {
      ctx.record({ op: "all-of-merged", schemaPointer: pointer, argPath, lossy: false, detail: "allOf branches merged into the node" });
      n = merged;
    } else {
      delete n.allOf;
      ctx.record({ op: "dropped", schemaPointer: pointer, argPath, lossy: true, detail: "allOf with non-object branches dropped" });
    }
  }

  if ("const" in n) {
    ctx.emit("const", pointer + "/const", "const was converted to a one-value enum");
    n.enum = [n.const];
    delete n.const;
  }

  for (const k of UNSUPPORTED) {
    if (!(k in n)) continue;
    ctx.emit("unsupported-keyword", pointer + "/" + k, k + " is not supported in strict mode; it was removed");
    ctx.record({ op: "dropped", schemaPointer: pointer, argPath, lossy: true, detail: "removed keyword " + k });
    delete n[k];
  }

  if (typeof n.format === "string" && !FORMATS.has(n.format)) {
    ctx.emit("unsupported-format", pointer + "/format", 'format "' + n.format + '" is not supported; it moved into the description');
    ctx.record({ op: "constraint-to-description", schemaPointer: pointer, argPath, lossy: true, detail: "format " + n.format });
    appendDescription(n, "format: " + n.format);
    delete n.format;
  }

  if (Array.isArray(n.enum)) {
    stats.enumValues += n.enum.length;
  }

  if (isObjectSchema(n)) {
    const hasProps = isObj(n.properties);
    if (!hasProps && n.additionalProperties !== false) {
      if (isRoot && !isObj(n.additionalProperties)) {
        n.properties = {};
        ctx.emit("additional-properties", pointer + "/additionalProperties", "The root object has no properties; it was closed with additionalProperties: false");
        n.additionalProperties = false;
        n.required = [];
      } else {
        ctx.emit("free-form-object", pointer, "An object without fixed properties (free-form map) cannot be used in strict mode: " + brief(n, 80));
      }
    } else if (hasProps) {
      if (n.additionalProperties === undefined || n.additionalProperties === true) {
        ctx.emit("additional-properties", pointer + "/additionalProperties", "Object must set additionalProperties: false");
        if (n.additionalProperties === true) {
          ctx.record({ op: "dropped", schemaPointer: pointer, argPath, lossy: true, detail: "additionalProperties: true was replaced by false" });
        }
        n.additionalProperties = false;
      } else if (isObj(n.additionalProperties)) {
        ctx.emit("free-form-object", pointer + "/additionalProperties", "A schema-valued additionalProperties (map) cannot be used in strict mode");
      }
    }
  }

  const children = mapChildren(n, pointer, argPath, (c, p, a) => visit(c, p, a, ctx, depth + 1, false, stats));
  n = children;

  if (isObj(n.properties)) {
    const keys = Object.keys(n.properties);
    stats.properties += keys.length;
    const required: string[] = Array.isArray(n.required) ? n.required.filter((k: unknown): k is string => typeof k === "string") : [];
    const props: JsonSchema = { ...n.properties };
    for (const key of keys) {
      if (required.includes(key)) continue;
      ctx.emit("optional-property", pointer + "/properties/" + esc(key), 'Optional property "' + key + '" must be required in strict mode; it became nullable');
      const child = props[key];
      if (isObj(child)) {
        if (!allowsNull(child)) {
          ctx.record({
            op: "nullable-optional",
            schemaPointer: pointer + "/properties/" + esc(key),
            argPath: argPath + "/" + escArg(key),
            lossy: false,
            detail: "optional property became required + nullable; null is removed on restore",
          });
        }
        props[key] = makeNullable(child);
      }
    }
    n.properties = props;
    n.required = keys;
  }
  return n;
}

export function transformSchema(root: JsonSchema, ctx: Ctx): JsonSchema {
  const inlined = inlineRefs(root, refHooks(ctx));
  const stats: Stats = { properties: 0, enumValues: 0, depthReported: false };
  const visited = visit(inlined, "", "", ctx, 0, true, stats);
  if (stats.properties > 5000) ctx.emit("limit-properties", "", stats.properties + " properties in total (limit 5000)");
  if (stats.enumValues > 1000) ctx.emit("limit-enum", "", stats.enumValues + " enum values in total (limit 1000)");
  return ensureObjectRoot(visited, ctx);
}

export const openaiStrict: Profile = {
  id: "openai-strict",
  title: "OpenAI strict function calling (Structured Outputs)",
  description: "`strict: true` tools accept a JSON Schema subset: all properties required, additionalProperties: false everywhere, optional fields expressed as null unions.",
  docUrl: DOC,
  rules,
  transformSchema,
};
