import type { JsonSchema } from "./types.js";

export function isObj(x: unknown): x is JsonSchema {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Escape one segment for a JSON Pointer. */
export function esc(seg: string): string {
  return seg.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Escape one segment for an argument path (`*` is reserved as wildcard). */
export function escArg(seg: string): string {
  return esc(seg).replace(/\*/g, "~2");
}

export function unescArg(seg: string): string {
  return seg.replace(/~2/g, "*").replace(/~1/g, "/").replace(/~0/g, "~");
}

export type Visit = (node: JsonSchema, pointer: string, argPath: string) => JsonSchema;

/**
 * Apply `visit` to every direct sub-schema of `node` and return a shallow copy with the results.
 * Tracks both the schema pointer and the path the value will have inside the call arguments.
 */
export function mapChildren(node: JsonSchema, pointer: string, argPath: string, visit: Visit): JsonSchema {
  const out: JsonSchema = { ...node };
  const sub = (child: unknown, p: string, a: string): unknown => (isObj(child) ? visit(child, p, a) : child);

  if (isObj(node.properties)) {
    const props: JsonSchema = {};
    for (const [k, v] of Object.entries(node.properties)) {
      props[k] = sub(v, pointer + "/properties/" + esc(k), argPath + "/" + escArg(k));
    }
    out.properties = props;
  }
  if (isObj(node.patternProperties)) {
    const props: JsonSchema = {};
    for (const [k, v] of Object.entries(node.patternProperties)) {
      props[k] = sub(v, pointer + "/patternProperties/" + esc(k), argPath + "/*");
    }
    out.patternProperties = props;
  }
  if (isObj(node.items)) {
    out.items = visit(node.items, pointer + "/items", argPath + "/*");
  } else if (Array.isArray(node.items)) {
    out.items = node.items.map((v: unknown, i: number) => sub(v, pointer + "/items/" + i, argPath + "/*"));
  }
  if (Array.isArray(node.prefixItems)) {
    out.prefixItems = node.prefixItems.map((v: unknown, i: number) => sub(v, pointer + "/prefixItems/" + i, argPath + "/*"));
  }
  if (isObj(node.additionalProperties)) {
    out.additionalProperties = visit(node.additionalProperties, pointer + "/additionalProperties", argPath + "/*");
  }
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(node[key])) {
      out[key] = node[key].map((v: unknown, i: number) => sub(v, pointer + "/" + key + "/" + i, argPath));
    }
  }
  for (const key of ["not", "if", "then", "else"]) {
    if (isObj(node[key])) out[key] = visit(node[key], pointer + "/" + key, argPath);
  }
  return out;
}
