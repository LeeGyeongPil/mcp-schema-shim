import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { InputError } from "../src/errors.js";
import { LANG_ENV, MESSAGES, RULE_SUMMARIES_KO, hasKey, langFlagFrom, resolveLang, t } from "../src/i18n.js";
import { PROFILES, transformTools } from "../src/index.js";

const tools = fileURLToPath(new URL("../examples/tools.json", import.meta.url));
const v1 = fileURLToPath(new URL("../examples/server-v1.mjs", import.meta.url));

async function cli(env: Record<string, string>, ...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await main(argv, { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) } }, env);
  return { code, out, err };
}

const hangul = /[가-힣]/;
const noKorean = (s: string): boolean => !hangul.test(s);

describe("message tables", () => {
  it("en and ko have exactly the same keys", () => {
    expect(Object.keys(MESSAGES.ko).sort()).toEqual(Object.keys(MESSAGES.en).sort());
  });

  it("every placeholder in en also appears in ko", () => {
    const names = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(MESSAGES.en) as (keyof typeof MESSAGES.en)[]) {
      expect(names(MESSAGES.ko[key]), key).toEqual(names(MESSAGES.en[key]));
    }
  });

  it("has a Korean summary for every registered rule and no stray entries", () => {
    const ids = Object.values(PROFILES).flatMap((p) => p.rules.map((r) => r.id));
    expect(ids.length).toBeGreaterThanOrEqual(47);
    for (const id of ids) expect(RULE_SUMMARIES_KO[id], id).toBeTruthy();
    expect(Object.keys(RULE_SUMMARIES_KO).sort()).toEqual([...ids].sort());
  });

  it("Korean messages never put a fixed particle after a placeholder", () => {
    // e.g. "{name}가", "{n} 를", "{x}으로": the particle depends on the last syllable, so the sentence must avoid it.
    const bad = /\{\w+\}\s*(이|가|을|를|은|는|와|과|로|으로)(?![가-힣])/;
    for (const [key, text] of Object.entries(MESSAGES.ko)) expect(bad.test(text), key).toBe(false);
    expect(bad.test("{name} 가")).toBe(true); // the check itself works
    expect(Object.values(MESSAGES.ko).join("\n")).not.toMatch(/이\(가\)|을\(를\)|은\(는\)/);
  });

  it("fills placeholders", () => {
    expect(t("ko", "err.unknownProfile", { name: "x", profiles: "a, b" })).toBe('알 수 없는 프로필: "x". 고를 수 있는 값: a, b.');
    expect(t("en", "rep.summary", { errors: 1, warnings: 2, infos: 3 })).toBe("1 error(s), 2 warning(s), 3 info");
    expect(t("ko", "rep.summary", { errors: 1, warnings: 2, infos: 3 })).toBe("오류 1개, 경고 2개, 정보 3개");
  });
});

describe("resolveLang", () => {
  it("prefers --lang over every variable", () => {
    expect(resolveLang("en", { [LANG_ENV]: "ko", LC_ALL: "ko_KR.UTF-8" })).toBe("en");
    expect(resolveLang("ko", { LANG: "en_US.UTF-8" })).toBe("ko");
  });

  it("follows MCP_SCHEMA_SHIM_LANG > LC_ALL > LC_MESSAGES > LANG", () => {
    expect(resolveLang(undefined, { [LANG_ENV]: "ko", LC_ALL: "en_US", LC_MESSAGES: "en_US", LANG: "en_US" })).toBe("ko");
    expect(resolveLang(undefined, { [LANG_ENV]: "en", LC_ALL: "ko_KR", LANG: "ko_KR" })).toBe("en");
    expect(resolveLang(undefined, { LC_ALL: "ko_KR.UTF-8", LC_MESSAGES: "en_US", LANG: "en_US" })).toBe("ko");
    expect(resolveLang(undefined, { LC_ALL: "en_US", LC_MESSAGES: "ko_KR", LANG: "ko_KR" })).toBe("en");
    expect(resolveLang(undefined, { LC_MESSAGES: "ko_KR.UTF-8", LANG: "en_US" })).toBe("ko");
    expect(resolveLang(undefined, { LANG: "ko_KR.UTF-8" })).toBe("ko");
  });

  it("falls back to English for other languages, odd values and nothing", () => {
    expect(resolveLang(undefined, { LANG: "fr_FR.UTF-8" })).toBe("en");
    expect(resolveLang(undefined, { [LANG_ENV]: "klingon", LANG: "ko_KR" })).toBe("en");
    expect(resolveLang(undefined, { LC_ALL: "" , LANG: "ko_KR" })).toBe("ko");
    expect(resolveLang(undefined, {})).toBe("en");
  });

  it("reads --lang only before `--`", () => {
    expect(langFlagFrom(["check", "--lang", "ko"])).toBe("ko");
    expect(langFlagFrom(["check", "--lang=fr"])).toBe("fr");
    expect(langFlagFrom(["check", "--", "server", "--lang", "ko"])).toBeUndefined();
    expect(langFlagFrom(["check", "--lang"])).toBeUndefined();
  });
});

describe("Korean screen", () => {
  const ko = { LANG: "ko_KR.UTF-8" };

  // acceptance (a)
  it("LANG=ko_KR.UTF-8 prints a Korean report and exits 1; --lang en switches back", async () => {
    const r = await cli(ko, "check", tools, "--profile", "openai-strict");
    expect(r.code).toBe(1);
    expect(r.out).toContain("심각도");
    expect(r.out).toMatch(/오류 \d+개, 경고 \d+개, 정보 \d+개/);
    expect(r.out).toContain("수정 가능");
    expect(r.out).toContain("모든 객체에 additionalProperties: false 가 필요합니다.");
    expect(r.out).toContain("openai-strict/additional-properties"); // rule IDs stay
    expect(r.out).not.toContain("error(s)");
    expect(r.out).not.toContain("SEVERITY");
    const en = await cli(ko, "check", tools, "--profile", "openai-strict", "--lang", "en");
    expect(en.code).toBe(1);
    expect(en.out).toContain("SEVERITY");
    expect(en.out).toMatch(/\d+ error\(s\), \d+ warning\(s\), \d+ info/);
    expect(en.out).toContain("Object must set additionalProperties: false");
  });

  it("aligns the Korean table columns by screen width", async () => {
    const r = await cli(ko, "check", tools, "--profile", "openai-strict");
    const rows = r.out.split("\n").filter((l) => /^(오류|경고|정보) /.test(l) && l.includes("openai-strict/"));
    expect(rows.length).toBeGreaterThan(0);
    const col = (l: string): number => [...l.slice(0, l.indexOf("openai-strict/"))].reduce((w, ch) => w + (hangul.test(ch) ? 2 : 1), 0);
    expect(new Set(rows.map(col)).size).toBe(1);
  });

  // acceptance (b)
  it("--format json is byte-identical in both languages", async () => {
    const a = await cli({ LANG: "en_US.UTF-8" }, "check", tools, "--all", "--format", "json");
    const b = await cli(ko, "check", tools, "--all", "--format", "json");
    const c = await cli({}, "check", tools, "--all", "--format", "json", "--lang", "ko");
    expect(b.out).toBe(a.out);
    expect(c.out).toBe(a.out);
    expect(a.code).toBe(b.code);
    expect(noKorean(b.out)).toBe(true);
  });

  it("markdown and the 'no findings' line are Korean too", async () => {
    const md = await cli(ko, "check", tools, "--profile", "anthropic-strict", "--format", "markdown");
    expect(md.out).toContain("| 도구 | 위치 | 규칙 | 심각도 | 수정 가능 | 문서 |");
    expect(md.out).toMatch(/\*\*오류 \d+개/);
    const clean = await cli(ko, "check", tools, "--profile", "gemini-json-schema");
    expect(clean.out).toContain("정보");
    const empty = await cli(ko, "check", "--profile", "openai-strict", "--lang", "ko", "--", process.execPath, "-e", "0");
    expect(empty.code).toBe(2); // the child answers nothing, so this is the server error path (localized below)
  });

  it("falls back to the English message for a rule that has no Korean summary", async () => {
    const { formatDiagnostics } = await import("../src/report.js");
    const diag = { tool: "t", pointer: "", ruleId: "x/unknown-rule", severity: "error" as const, fixable: false, message: "English only text", docUrl: "https://example.test", profile: "openai-strict" as const };
    expect(formatDiagnostics([diag], "text", "ko")).toContain("English only text");
  });

  it("help, usage errors and InputError messages are Korean", async () => {
    const help = await cli(ko, "--help");
    expect(help.code).toBe(0);
    expect(help.out).toContain("사용법:");
    expect(help.out).toContain("종료 코드");
    expect(help.out).toContain("--lang en|ko");
    expect((await cli({}, "--help")).out).toContain("Usage:");

    const noProfile = await cli(ko, "check", tools);
    expect(noProfile.code).toBe(2);
    expect(noProfile.err).toContain("프로필");
    expect(noProfile.err).toContain("--profile");

    const unknown = await cli(ko, "check", tools, "--profile", "nope");
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain('알 수 없는 프로필: "nope". 고를 수 있는 값: ');

    const missing = await cli(ko, "check", "/no/such/file.json", "--profile", "openai-strict");
    expect(missing.err).toContain("파일을 읽을 수 없습니다 (/no/such/file.json)");

    expect((await cli(ko, "frobnicate")).err).toContain('알 수 없는 명령: "frobnicate"');
    expect((await cli(ko, "check", tools, "--profile", "openai-strict", "--format", "xml")).err).toContain("알 수 없는 --format 값");
    expect((await cli(ko, "check", tools, "--profile", "openai-strict", "--timeout", "5")).err).toContain("--timeout 은");
  });

  it("parseArgs errors are Korean and keep exit code 2", async () => {
    const unknown = await cli(ko, "check", tools, "--bogus");
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain("알 수 없는 옵션입니다: --bogus");
    expect(unknown.err).toContain("--help");
    expect(unknown.err).not.toContain("Unknown option");
    const missing = await cli(ko, "check", tools, "--profile");
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("옵션 --profile 에는 값이 필요합니다.");
    const en = await cli({}, "check", tools, "--bogus");
    expect(en.err).toContain("Unknown option {option}.".replace("{option}", "--bogus"));
  });

  it("library exceptions that reach the CLI are Korean while their message stays English", async () => {
    const timeout = await cli(ko, "check", "--profile", "openai-strict", "--timeout", "200", "--", process.execPath, "-e", "setInterval(()=>{},1000)");
    expect(timeout.code).toBe(2);
    expect(timeout.err).toContain("서버가");
    expect(timeout.err).toContain("--timeout");
    expect(timeout.err).not.toContain("did not answer");
    const enTimeout = await cli({}, "check", "--profile", "openai-strict", "--timeout", "200", "--", process.execPath, "-e", "setInterval(()=>{},1000)");
    expect(enTimeout.err).toContain("did not answer");

    const e = (() => {
      try {
        transformTools([{ inputSchema: {} }] as never, "openai-strict");
      } catch (x) {
        return x as InputError;
      }
      return undefined;
    })();
    expect(e).toBeInstanceOf(InputError);
    expect(e?.message).toContain('needs a string "name"'); // unchanged English message
    expect(e?.code).toBe("err.toolName");
    expect(hasKey(e?.code ?? "")).toBe(true);
    // a plain InputError without a code is printed as is
    expect(new InputError("plain").code).toBeUndefined();
  });

  it("simulate prints Korean labels and no English banner in ko, English only in en", async () => {
    const args = ["simulate", "--profile", "anthropic-strict", "--tool", "issues.search", "--", process.execPath, v1];
    const k = await cli(ko, ...args);
    expect(k.code).toBe(0);
    expect(k.out).toContain("연습용 목 모델 — 실제 모델 호출 없음");
    expect(k.out).toContain("의도한 인자:");
    expect(k.out).toContain("모델에 보이는 이름: issues_search");
    expect(k.out).toMatch(/직결: {5}실패 /);
    expect(k.out).toMatch(/shim 경유: 성공/);
    expect(k.out).not.toContain("mock model");
    const e = await cli({}, ...args);
    expect(e.out).toContain("mock model — no LLM is called");
    expect(noKorean(e.out)).toBe(true);
    expect(e.out).toMatch(/via shim: OK/);
  });

  it("fix prints its diagnostics to stderr in Korean", async () => {
    const r = await cli(ko, "fix", tools, "--profile", "openai-strict");
    expect(r.code).toBe(0);
    expect(r.err).toContain("심각도");
    expect(JSON.parse(r.out)).toHaveProperty("tools");
  });
});

describe("--lang validation", () => {
  // acceptance (c)
  it("rejects an unknown value with exit 2 and one error line", async () => {
    const r = await cli({}, "check", tools, "--profile", "openai-strict", "--lang", "fr");
    expect(r.code).toBe(2);
    expect(r.out).toBe("");
    expect(r.err.trim().split("\n")).toHaveLength(1);
    expect(r.err).toContain('"fr"');
    const eq = await cli({}, "check", tools, "--profile", "openai-strict", "--lang=fr");
    expect(eq.code).toBe(2);
    expect(eq.err.trim().split("\n")).toHaveLength(1);
  });

  it("shows that error in the language of the environment", async () => {
    const r = await cli({ LANG: "ko_KR.UTF-8" }, "--lang", "fr");
    expect(r.code).toBe(2);
    expect(r.err).toContain("알 수 없는 --lang 값");
    expect(r.err.trim().split("\n")).toHaveLength(1);
  });

  it("ignores an odd value in the environment without any error", async () => {
    const r = await cli({ [LANG_ENV]: "fr" }, "check", tools, "--profile", "gemini-json-schema");
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
    expect(r.out).toContain("SEVERITY");
  });

  it("does not read --lang after `--` (those arguments belong to the server)", async () => {
    const r = await cli({}, "check", "--profile", "openai-strict", "--", process.execPath, v1, "--lang", "fr");
    expect(r.err).not.toContain("--lang");
  });
});

describe("simulate continuation alignment", () => {
  const screenWidth = (s: string): number => [...s].reduce((n, ch) => n + (/[가-힣]/.test(ch) ? 2 : 1), 0);
  const args = ["simulate", "--profile", "openai-strict", "--tool", "search_issues", "--args", '{"query":"bug"}', "--", process.execPath, v1];

  for (const [name, env, head] of [["en", {}, "direct:   FAIL "], ["ko", { [LANG_ENV]: "ko" }, "직결:     실패 "]] as const) {
    it(`${name}: follow-up lines of a multi-line result start under the message`, async () => {
      const r = await cli(env, ...args);
      const lines = r.out.split("\n");
      const first = lines.findIndex((l) => l.startsWith(head));
      expect(first).toBeGreaterThan(-1);
      const indent = lines[first + 1].length - lines[first + 1].trimStart().length;
      expect(indent).toBe(screenWidth(head));
    });
  }
});
