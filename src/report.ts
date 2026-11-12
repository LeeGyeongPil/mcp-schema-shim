import type { Diagnostic } from "./types.js";
import { ruleSummary, t, type Lang, type MsgKey } from "./i18n.js";

export type ReportFormat = "text" | "json" | "markdown";

function summary(diags: Diagnostic[], lang: Lang): string {
  const count = (s: Diagnostic["severity"]): number => diags.filter((d) => d.severity === s).length;
  return t(lang, "rep.summary", { errors: count("error"), warnings: count("warning"), infos: count("info") });
}

/** Width on screen: Hangul and other wide characters take two columns, so Korean tables stay aligned. */
export function width(s: string): number {
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠]/.test(ch) ? 2 : 1;
  return w;
}

function pad(s: string, to: number): string {
  return s + " ".repeat(Math.max(0, to - width(s)));
}

/** The line that explains a finding: Korean summary per rule ID in Korean, otherwise the diagnostic's own (English) message. */
function describe(d: Diagnostic, lang: Lang): string {
  return ruleSummary(lang, d.ruleId) ?? d.message;
}

/** Render diagnostics as a table (text / markdown) or JSON. JSON never depends on the language. */
export function formatDiagnostics(diags: Diagnostic[], format: ReportFormat, lang: Lang = "en"): string {
  if (format === "json") return JSON.stringify(diags, null, 2) + "\n";
  const sev = (s: Diagnostic["severity"]): string => t(lang, ("rep." + s) as MsgKey);
  const root = t(lang, "rep.rootPointer");
  if (format === "markdown") {
    const head = [t(lang, "rep.mdTool"), t(lang, "rep.mdPointer"), t(lang, "rep.mdRule"), t(lang, "rep.mdSeverity"), t(lang, "rep.mdFixable"), t(lang, "rep.mdDocs")];
    const lines = ["| " + head.join(" | ") + " |", "|---|---|---|---|---|---|"];
    for (const d of diags) {
      const fixable = t(lang, d.fixable ? "rep.yes" : "rep.no");
      lines.push("| " + [d.tool, "`" + (d.pointer || root) + "`", "`" + d.ruleId + "`", sev(d.severity), fixable, d.docUrl].join(" | ") + " |");
    }
    lines.push("", "**" + summary(diags, lang) + "**", "");
    return lines.join("\n");
  }
  if (diags.length === 0) return t(lang, "rep.noFindings") + " " + summary(diags, lang) + "\n";
  const rows = diags.map((d) => [sev(d.severity), d.ruleId, d.tool, d.pointer || root, t(lang, d.fixable ? "rep.fixable" : "rep.notFixable")]);
  const header = [t(lang, "rep.colSeverity"), t(lang, "rep.colRule"), t(lang, "rep.colTool"), t(lang, "rep.colPointer"), t(lang, "rep.colFix")];
  const widths = header.map((h, i) => Math.max(width(h), ...rows.map((r) => width(r[i]))));
  const fmt = (r: string[]): string => r.map((c, i) => pad(c, widths[i])).join("  ").trimEnd();
  const lines = [fmt(header)];
  diags.forEach((d, i) => {
    lines.push(fmt(rows[i]));
    lines.push("    " + describe(d, lang));
    lines.push("    " + d.docUrl);
  });
  lines.push("", summary(diags, lang));
  return lines.join("\n") + "\n";
}
