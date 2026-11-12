import type { ProfileId } from "../types.js";
import { inputError } from "../i18n.js";
import type { Profile, ProfileInfo } from "./common.js";
import { geminiParameters } from "./gemini-parameters.js";
import { geminiJsonSchema } from "./gemini-json-schema.js";
import { openaiStrict } from "./openai-strict.js";
import { anthropicStrict } from "./anthropic-strict.js";

const IMPL: Record<ProfileId, Profile> = {
  "gemini-parameters": geminiParameters,
  "gemini-json-schema": geminiJsonSchema,
  "openai-strict": openaiStrict,
  "anthropic-strict": anthropicStrict,
};

/** Public description of every profile (name, docs, rule list). */
export const PROFILES: Record<ProfileId, ProfileInfo> = Object.fromEntries(
  Object.entries(IMPL).map(([id, p]) => [id, { id: p.id, title: p.title, description: p.description, docUrl: p.docUrl, rules: p.rules }]),
) as Record<ProfileId, ProfileInfo>;

export const PROFILE_IDS = Object.keys(IMPL) as ProfileId[];

export function isProfileId(x: unknown): x is ProfileId {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(IMPL, x);
}

/** Internal: the executable profile. Throws a helpful InputError for unknown ids. */
export function getProfile(id: string): Profile {
  if (!isProfileId(id)) throw inputError("err.unknownProfile", { name: id, profiles: PROFILE_IDS.join(", ") });
  return IMPL[id];
}
