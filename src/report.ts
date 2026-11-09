import type { Diagnostic } from "./types.js";

export type ReportFormat = "text" | "json" | "markdown";

function summary(diags: Diagnostic[]): string {
  const count = (s: Diagnostic["severity"]): number => diags.filter((d) => d.severity === s).length;
  return count("error") + " error(s), " + count("warning") + " warning(s), " + count("info") + " info";
}

/** Render diagnostics as a table (text / markdown) or JSON. */
export function formatDiagnostics(diags: Diagnostic[], format: ReportFormat): string {
  if (format === "json") return JSON.stringify(diags, null, 2) + "\n";
  if (format === "markdown") {
    const lines = ["| Tool | Pointer | Rule | Severity | Fixable | Docs |", "|---|---|---|---|---|---|"];
    for (const d of diags) {
      lines.push("| " + [d.tool, "`" + (d.pointer || "(root)") + "`", "`" + d.ruleId + "`", d.severity, d.fixable ? "yes" : "no", d.docUrl].join(" | ") + " |");
    }
    lines.push("", "**" + summary(diags) + "**", "");
    return lines.join("\n");
  }
  if (diags.length === 0) return "No findings. " + summary(diags) + "\n";
  const rows = diags.map((d) => [d.severity, d.ruleId, d.tool, d.pointer || "(root)", d.fixable ? "fixable" : "NOT fixable"]);
  const header = ["SEVERITY", "RULE", "TOOL", "POINTER", "FIX"];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (r: string[]): string => r.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  const lines = [fmt(header)];
  diags.forEach((d, i) => {
    lines.push(fmt(rows[i]));
    lines.push("    " + d.message);
    lines.push("    " + d.docUrl);
  });
  lines.push("", summary(diags));
  return lines.join("\n") + "\n";
}
