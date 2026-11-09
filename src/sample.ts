import type { JsonSchema } from "./types.js";
import { inlineRefs } from "./refs.js";
import { isObj } from "./walk.js";

/** Deterministic pseudo random numbers (mulberry32) so tests and demos are reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type SampleMode = "minimal" | "random";

const FORMAT_SAMPLES: Record<string, string> = {
  "date-time": "2024-05-01T10:00:00Z",
  date: "2024-05-01",
  time: "10:00:00Z",
  email: "a@example.com",
  uuid: "123e4567-e89b-42d3-a456-426614174000",
  uri: "https://example.com/x",
  hostname: "example.com",
  ipv4: "10.0.0.1",
};

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function gen(schema: JsonSchema, rng: () => number, mode: SampleMode, depth: number): unknown {
  if ("const" in schema) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return mode === "minimal" ? schema.enum[0] : pick(rng, schema.enum);
  for (const key of ["anyOf", "oneOf"]) {
    const branches = schema[key];
    if (Array.isArray(branches) && branches.length > 0) {
      const { [key]: _drop, ...rest } = schema;
      void _drop;
      const b = mode === "minimal" ? branches[0] : pick(rng, branches);
      return gen(isObj(b) ? { ...rest, ...b } : rest, rng, mode, depth + 1);
    }
  }
  if (Array.isArray(schema.allOf)) {
    const { allOf, ...rest } = schema;
    return gen(Object.assign({}, rest, ...(allOf as JsonSchema[])), rng, mode, depth + 1);
  }
  let type = schema.type;
  if (Array.isArray(type)) type = mode === "minimal" ? type[0] : pick(rng, type);
  if (type === undefined) type = isObj(schema.properties) ? "object" : "string";
  switch (type) {
    case "string": {
      if (typeof schema.format === "string" && schema.format in FORMAT_SAMPLES) return FORMAT_SAMPLES[schema.format];
      const min = typeof schema.minLength === "number" ? schema.minLength : 1;
      const max = typeof schema.maxLength === "number" ? schema.maxLength : 12;
      const len = Math.min(max, Math.max(min, mode === "minimal" ? min : 1 + Math.floor(rng() * 8)));
      return "abcdefghij".repeat(Math.ceil(len / 10) + 1).slice(0, len);
    }
    case "integer":
    case "number": {
      let lo = typeof schema.minimum === "number" ? schema.minimum : typeof schema.exclusiveMinimum === "number" ? schema.exclusiveMinimum + 1 : 0;
      let hi = typeof schema.maximum === "number" ? schema.maximum : typeof schema.exclusiveMaximum === "number" ? schema.exclusiveMaximum - 1 : lo + 50;
      lo = Math.ceil(lo);
      hi = Math.floor(hi);
      const v = mode === "minimal" ? lo : lo + Math.floor(rng() * (hi - lo + 1));
      const step = typeof schema.multipleOf === "number" ? schema.multipleOf : 0;
      return step > 0 ? Math.ceil(v / step) * step : v;
    }
    case "boolean":
      return mode === "minimal" ? true : rng() < 0.5;
    case "null":
      return null;
    case "array": {
      const min = typeof schema.minItems === "number" ? schema.minItems : 0;
      const count = mode === "minimal" || depth > 3 ? min : Math.max(min, Math.floor(rng() * 3));
      const items = isObj(schema.items) ? schema.items : {};
      return Array.from({ length: count }, () => gen(items, rng, mode, depth + 1));
    }
    case "object": {
      const out: Record<string, unknown> = {};
      const required: string[] = Array.isArray(schema.required) ? schema.required : [];
      for (const [key, child] of Object.entries(isObj(schema.properties) ? schema.properties : {})) {
        const include = required.includes(key) || (mode === "random" && depth <= 3 && rng() < 0.6);
        if (include && isObj(child)) out[key] = gen(child, rng, mode, depth + 1);
      }
      return out;
    }
    default:
      return null;
  }
}

/**
 * Produce an example argument object for an input schema (local `$ref`s are inlined first).
 * Values are plausible, not guaranteed valid: callers that need validity should validate and filter.
 */
export function sampleArgs(schema: JsonSchema, rng: () => number, mode: SampleMode = "minimal"): Record<string, unknown> {
  const flat = inlineRefs(schema, { onInlined: () => undefined, onRecursive: () => undefined, onExternal: () => undefined });
  const v = gen(flat, rng, mode, 0);
  return isObj(v) ? v : {};
}
