import { Ajv, type ValidateFunction } from "ajv";
import Ajv2020Default from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { JsonSchema, ShimMap, ToolMap } from "./types.js";
import { InputError, RestoreError, UnknownToolError } from "./errors.js";
import { isObj, unescArg } from "./walk.js";

// ajv-formats and ajv/dist/2020 are CommonJS; unwrap the default export under NodeNext.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ?? addFormatsModule) as (ajv: Ajv) => Ajv;
const Ajv2020 = ((Ajv2020Default as unknown as { default?: unknown }).default ?? Ajv2020Default) as typeof Ajv;

const validators = new WeakMap<object, ValidateFunction>();

/** Compile (and cache) a validator for a JSON Schema; `$schema` decides between draft-07 and 2019/2020 semantics. */
export function compileSchema(schema: JsonSchema): ValidateFunction {
  const cached = validators.get(schema);
  if (cached) return cached;
  const { $schema, ...body } = schema;
  const modern = typeof $schema === "string" && /2019-09|2020-12/.test($schema);
  const ajv = new (modern ? Ajv2020 : Ajv)({ allErrors: true, strict: false, validateFormats: true });
  addFormats(ajv);
  let validate: ValidateFunction;
  try {
    validate = ajv.compile(body);
  } catch (e) {
    throw new InputError("The original input schema cannot be compiled for validation: " + (e instanceof Error ? e.message : String(e)));
  }
  validators.set(schema, validate);
  return validate;
}

function forEachAt(node: unknown, segs: string[], cb: (holder: Record<string, unknown>, key: string) => void): void {
  if (segs.length === 0 || typeof node !== "object" || node === null) return;
  const [head, ...rest] = segs;
  const holder = node as Record<string, unknown>;
  const keys = head === "*" ? Object.keys(holder) : Object.prototype.hasOwnProperty.call(holder, head) ? [head] : [];
  for (const k of keys) {
    if (rest.length === 0) cb(holder, k);
    else forEachAt(holder[k], rest, cb);
  }
}

function parseArgPath(path: string): string[] {
  return path === "" ? [] : path.split("/").slice(1).map(unescArg);
}

function applyEntries(args: Record<string, unknown>, tm: ToolMap): void {
  for (const e of tm.entries) {
    if (e.op === "nullable-optional") {
      // Optional property that was sent as null: drop it so the original schema sees it as absent.
      forEachAt(args, parseArgPath(e.argPath), (holder, key) => {
        if (holder[key] === null && !Array.isArray(holder)) delete holder[key];
      });
    } else if (e.op === "enum-stringified" && e.values) {
      // enum/const values were sent as strings: put the original typed value back.
      const originals = e.values;
      forEachAt(args, parseArgPath(e.argPath), (holder, key) => {
        const v = holder[key];
        if (typeof v !== "string") return;
        const idx = originals.findIndex((o) => String(o) === v);
        if (idx >= 0) holder[key] = originals[idx];
      });
    }
  }
}

/**
 * Undo the transform for one tool call: original tool name, null/enum/const values put back in their original
 * shape, then validation against the ORIGINAL input schema.
 *
 * @throws UnknownToolError when `name` is not in the map
 * @throws RestoreError when the restored arguments break the original schema
 */
export function restore(name: string, args: unknown, map: ShimMap): { name: string; args: Record<string, unknown> } {
  const tm = map.tools[name];
  if (!tm) throw new UnknownToolError(name, Object.keys(map.tools));
  const source = args === undefined || args === null ? {} : args;
  if (!isObj(source)) {
    throw new RestoreError(tm.originalName, [{ pointer: "", keyword: "type", message: "arguments must be a JSON object" }]);
  }
  const out = structuredClone(source) as Record<string, unknown>;
  applyEntries(out, tm);
  const validate = compileSchema(tm.originalSchema);
  if (!validate(out)) {
    const issues = (validate.errors ?? []).map((er) => ({
      pointer: er.instancePath,
      keyword: er.keyword,
      message: er.message ?? "is invalid",
    }));
    throw new RestoreError(tm.originalName, issues);
  }
  return { name: tm.originalName, args: out };
}
