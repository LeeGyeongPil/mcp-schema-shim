import type { ProfileId, Severity } from "../types.js";

export interface RuleDef {
  /** `<profile>/<name>` */
  id: string;
  profile: ProfileId;
  severity: Severity;
  /** True when `transform` repairs the problem automatically. */
  fixable: boolean;
  summary: string;
  docUrl: string;
}

export interface RuleSpec {
  name: string;
  severity: Severity;
  fixable: boolean;
  summary: string;
  docUrl: string;
}

/** Build rule definitions with `<profile>/<name>` ids. */
export function defineRules(profile: ProfileId, specs: RuleSpec[]): RuleDef[] {
  return specs.map((s) => ({
    id: profile + "/" + s.name,
    profile,
    severity: s.severity,
    fixable: s.fixable,
    summary: s.summary,
    docUrl: s.docUrl,
  }));
}
