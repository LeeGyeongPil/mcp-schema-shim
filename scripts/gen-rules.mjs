// Generates docs/rules.md from the rule registry (run with `npm run docs:rules`).
import { PROFILES, DOCS_CHECKED } from "../dist/index.js";

const out = [];
out.push("# Rules");
out.push("");
out.push("Every rule belongs to one profile, links to the provider documentation it is based on, and says whether `transform`/`fix` repairs it.");
out.push("");
out.push("> Based on the provider documentation as read on " + DOCS_CHECKED + ". The rules are **not** verified against the live APIs yet (a `--live` check is planned). Provider limits change; if a rule looks wrong, open an issue with the documentation link.");
out.push("");
for (const profile of Object.values(PROFILES)) {
  out.push("## `" + profile.id + "`");
  out.push("");
  out.push(profile.title + ". " + profile.description);
  out.push("");
  out.push("Documentation: " + profile.docUrl);
  out.push("");
  out.push("| Rule | Severity | Fixable | What it does | Documentation (checked " + DOCS_CHECKED + ") |");
  out.push("|---|---|---|---|---|");
  for (const r of profile.rules) {
    out.push("| `" + r.id + "` | " + r.severity + " | " + (r.fixable ? "yes" : "no") + " | " + r.summary.replace(/\|/g, "\\|") + " | " + r.docUrl + " |");
  }
  out.push("");
}
process.stdout.write(out.join("\n"));
