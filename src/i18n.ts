import { InputError } from "./errors.js";

/** Screen languages of the CLI. JSON output, rule IDs and exit codes never depend on it. */
export type Lang = "en" | "ko";
export const LANGS: readonly Lang[] = ["en", "ko"];

export function isLang(x: unknown): x is Lang {
  return x === "en" || x === "ko";
}

/** Environment variable that overrides LC_ALL / LC_MESSAGES / LANG. */
export const LANG_ENV = "MCP_SCHEMA_SHIM_LANG";

/**
 * Pick the screen language: `--lang` flag > MCP_SCHEMA_SHIM_LANG > LC_ALL > LC_MESSAGES > LANG.
 * The first variable that is set decides; a value starting with "ko" means Korean, anything else English.
 */
export function resolveLang(flag: string | undefined, env: Record<string, string | undefined>): Lang {
  if (isLang(flag)) return flag;
  for (const name of [LANG_ENV, "LC_ALL", "LC_MESSAGES", "LANG"]) {
    const v = env[name];
    if (v !== undefined && v !== "") return v.toLowerCase().startsWith("ko") ? "ko" : "en";
  }
  return "en";
}

/** Read the value of `--lang` from raw arguments (only the part before `--`). Undefined when absent. */
export function langFlagFrom(argv: string[]): string | undefined {
  const sep = argv.indexOf("--");
  const own = sep >= 0 ? argv.slice(0, sep) : argv;
  let found: string | undefined;
  for (let i = 0; i < own.length; i++) {
    const a = own[i];
    if (a === "--lang" && i + 1 < own.length) {
      found = own[i + 1];
      i++;
    } else if (a.startsWith("--lang=")) found = a.slice("--lang=".length);
  }
  return found;
}

const en = {
  // ---- help ----
  "help": `mcp-schema-shim - make MCP tool schemas fit Gemini / OpenAI strict / Anthropic strict, and restore the arguments

Usage:
  mcp-schema-shim check <tools.json> (--profile <id> ... | --all) [--format text|json|markdown]
  mcp-schema-shim check (--profile <id> ... | --all) [--format text|json|markdown] [--timeout <ms>] -- <server command> [args...]
  mcp-schema-shim fix <tools.json> --profile <id> [--map <file>] [-o <file>]
  mcp-schema-shim proxy --profile <id> [--log <file>] -- <server command> [args...]
  mcp-schema-shim simulate --profile <id> [--tool <name>] [--args <json>] -- <server command> [args...]

Profiles: {profiles}

Language: --lang en|ko, or the MCP_SCHEMA_SHIM_LANG / LC_ALL / LC_MESSAGES / LANG environment variable (default: English).

Exit codes: 0 ok, 1 findings of error severity (check) / unfixable errors (fix), 2 bad input or usage.
  check with a server command: 2 if the server cannot be started, times out or answers with an error.
`,
  // ---- CLI and library errors (InputError codes) ----
  "err.cannotRead": "Cannot read {file}: {reason}",
  "err.invalidJson": "{file} is not valid JSON: {reason}",
  "err.badToolsFile": '{file} must contain a tools/list result ({"tools":[...]}), an array of tools, or one tool object.',
  "err.noProfile": "Choose a profile with --profile <id> (repeatable) or use --all. Profiles: {profiles}.",
  "err.unknownProfile": 'Unknown profile "{name}". Choose one of: {profiles}.',
  "err.unknownFormat": 'Unknown --format "{value}". Use text, json or markdown.',
  "err.badLang": 'Unknown --lang "{value}". Use en or ko.',
  "err.checkBoth": "check takes either a tools file or a server command after `--`, not both.",
  "err.checkNeeds": "check needs a tools file or a server command: mcp-schema-shim check <tools.json> --profile <id>  |  mcp-schema-shim check --profile <id> -- node server.js",
  "err.checkOneFile": "check needs exactly one tools file: mcp-schema-shim check <tools.json> --profile <id>",
  "err.timeoutFileMode": "--timeout only applies with a server command after `--`.",
  "err.timeoutPositive": "--timeout must be a positive number of milliseconds.",
  "err.fixOneFile": "fix needs exactly one tools file: mcp-schema-shim fix <tools.json> --profile <id>",
  "err.fixOneProfile": "fix takes exactly one --profile.",
  "err.proxyOneProfile": "proxy takes exactly one --profile.",
  "err.proxyNeedsServer": "proxy needs the original server command after `--`, e.g. proxy --profile openai-strict -- node server.js",
  "err.proxyLibNeedsCommand": "proxy needs the original server command after `--`, e.g. `-- node server.js`.",
  "err.simOneProfile": "simulate takes exactly one --profile.",
  "err.simNeedsServer": "simulate needs the server command after `--`, e.g. simulate --profile openai-strict -- node examples/server-v1.mjs",
  "err.argsJson": '--args must be a JSON object, e.g. --args \'{"query":"bug"}\'.',
  "err.unknownCommand": 'Unknown command "{name}". Use check, fix, proxy or simulate (see --help).',
  "err.cannotCompile": "The original input schema cannot be compiled for validation: {reason}",
  "err.toolName": 'tools[{index}] needs a string "name". Pass MCP tool objects like {"name": "...", "inputSchema": {...}}.',
  "err.toolSchema": 'tools[{index}] ("{name}") needs an "inputSchema" object. Tools without arguments should use {"type":"object","properties":{}}.',
  "err.toolsArray": "transformTools() expects an array of MCP tools.",
  "err.spawn": "Could not start the server command `{command}`: {reason}",
  "err.rpcTimeout": "The server did not answer {method} within {ms} ms. Raise --timeout if the server is slow to start.",
  "err.rpcError": "The server answered {method} with MCP error {code}: {message}",
  "err.rpcErrorNoMethod": "The server answered a request with MCP error {code}: {message}",
  "err.serverExit": "The server exited before tools/list finished.",
  "err.serverExitCode": "The server exited (code {code}) before tools/list finished.",
  "err.noToolsArray": "The server answered tools/list without a tools array.",
  "err.cursorRepeat": "The server repeated a tools/list cursor; stopping to avoid an endless loop.",
  "err.tooManyPages": "The server returned more than {max} tools/list pages; stopping.",
  "err.noTools": "The server returned no tools.",
  "err.toolNotFound": 'Tool "{tool}" not found. Available: {available}',
  // ---- node parseArgs errors ----
  "err.parseUnknown": "Unknown option {option}.",
  "err.parseMissingValue": "Option {option} needs a value.",
  "err.parseUnexpected": "Unexpected argument {value}.",
  "err.parseHint": "Run `mcp-schema-shim --help` for usage.",
  "err.unexpected": "unexpected error: {detail}",
  // ---- report ----
  "rep.error": "error",
  "rep.warning": "warning",
  "rep.info": "info",
  "rep.summary": "{errors} error(s), {warnings} warning(s), {infos} info",
  "rep.noFindings": "No findings.",
  "rep.fixable": "fixable",
  "rep.notFixable": "NOT fixable",
  "rep.yes": "yes",
  "rep.no": "no",
  "rep.rootPointer": "(root)",
  "rep.colSeverity": "SEVERITY",
  "rep.colRule": "RULE",
  "rep.colTool": "TOOL",
  "rep.colPointer": "POINTER",
  "rep.colFix": "FIX",
  "rep.mdTool": "Tool",
  "rep.mdPointer": "Pointer",
  "rep.mdRule": "Rule",
  "rep.mdSeverity": "Severity",
  "rep.mdFixable": "Fixable",
  "rep.mdDocs": "Docs",
  // ---- simulate ----
  "sim.banner": "mock model — no LLM is called",
  "sim.note": "The server and its argument validation are real; only the model is imitated.",
  "sim.profile": "profile:            ",
  "sim.tool": "tool:               ",
  "sim.exposedAs": "  (exposed to the model as {name})",
  "sim.intended": "intended arguments: ",
  "sim.mockSends": "mock model sends:   ",
  "sim.direct": "direct:   ",
  "sim.viaShim": "via shim: ",
  "sim.ok": "OK   ",
  "sim.fail": "FAIL ",
} as const;

export type MsgKey = keyof typeof en;

const ko: Record<MsgKey, string> = {
  "help": `mcp-schema-shim - MCP 도구 스키마를 Gemini / OpenAI strict / Anthropic strict 에 맞게 고치고, 모델이 보낸 인자를 원래대로 되돌립니다

사용법:
  mcp-schema-shim check <tools.json> (--profile <id> ... | --all) [--format text|json|markdown]
  mcp-schema-shim check (--profile <id> ... | --all) [--format text|json|markdown] [--timeout <ms>] -- <서버 명령> [인자...]
  mcp-schema-shim fix <tools.json> --profile <id> [--map <파일>] [-o <파일>]
  mcp-schema-shim proxy --profile <id> [--log <파일>] -- <서버 명령> [인자...]
  mcp-schema-shim simulate --profile <id> [--tool <이름>] [--args <json>] -- <서버 명령> [인자...]

프로필: {profiles}

화면 언어: --lang en|ko, 또는 환경변수 MCP_SCHEMA_SHIM_LANG / LC_ALL / LC_MESSAGES / LANG (기본값은 영어).

종료 코드: 0 정상, 1 오류 등급 진단(check) 또는 못 고치는 오류(fix), 2 잘못된 입력·사용법.
  서버 명령으로 check 할 때는 서버를 못 띄우거나 시간 초과이거나 오류로 응답하면 2.
`,
  "err.cannotRead": "파일을 읽을 수 없습니다 ({file}): {reason}",
  "err.invalidJson": "올바른 JSON 이 아닙니다 ({file}): {reason}",
  "err.badToolsFile": '파일에는 tools/list 결과({"tools":[...]}), 도구 배열, 도구 객체 하나 중 하나가 들어 있어야 합니다 ({file}).',
  "err.noProfile": "--profile <id> (여러 번 가능) 로 프로필을 고르거나 --all 을 쓰세요. 프로필: {profiles}.",
  "err.unknownProfile": '알 수 없는 프로필: "{name}". 고를 수 있는 값: {profiles}.',
  "err.unknownFormat": '알 수 없는 --format 값: "{value}". text, json, markdown 중에서 고르세요.',
  "err.badLang": '알 수 없는 --lang 값: "{value}". en 또는 ko 를 쓰세요.',
  "err.checkBoth": "check 에는 도구 파일이나 `--` 뒤의 서버 명령 중 하나만 줄 수 있습니다. 둘 다는 안 됩니다.",
  "err.checkNeeds": "check 에는 도구 파일이나 서버 명령이 필요합니다: mcp-schema-shim check <tools.json> --profile <id>  |  mcp-schema-shim check --profile <id> -- node server.js",
  "err.checkOneFile": "check 에는 도구 파일이 정확히 하나 필요합니다: mcp-schema-shim check <tools.json> --profile <id>",
  "err.timeoutFileMode": "--timeout 은 `--` 뒤에 서버 명령을 줄 때만 쓸 수 있습니다.",
  "err.timeoutPositive": "--timeout 값은 0보다 큰 밀리초 숫자여야 합니다.",
  "err.fixOneFile": "fix 에는 도구 파일이 정확히 하나 필요합니다: mcp-schema-shim fix <tools.json> --profile <id>",
  "err.fixOneProfile": "fix 에는 --profile 을 정확히 하나만 줄 수 있습니다.",
  "err.proxyOneProfile": "proxy 에는 --profile 을 정확히 하나만 줄 수 있습니다.",
  "err.proxyNeedsServer": "proxy 에는 `--` 뒤에 원래 서버 명령이 필요합니다. 예: proxy --profile openai-strict -- node server.js",
  "err.proxyLibNeedsCommand": "proxy 에는 `--` 뒤에 원래 서버 명령이 필요합니다. 예: `-- node server.js`.",
  "err.simOneProfile": "simulate 에는 --profile 을 정확히 하나만 줄 수 있습니다.",
  "err.simNeedsServer": "simulate 에는 `--` 뒤에 서버 명령이 필요합니다. 예: simulate --profile openai-strict -- node examples/server-v1.mjs",
  "err.argsJson": '--args 는 JSON 객체여야 합니다. 예: --args \'{"query":"bug"}\'.',
  "err.unknownCommand": '알 수 없는 명령: "{name}". check, fix, proxy, simulate 중에서 고르세요 (--help 참고).',
  "err.cannotCompile": "원래 입력 스키마를 검증용으로 컴파일할 수 없습니다: {reason}",
  "err.toolName": 'tools[{index}] 에는 문자열 "name" 이 필요합니다. {"name": "...", "inputSchema": {...}} 형태의 MCP 도구 객체를 넘기세요.',
  "err.toolSchema": 'tools[{index}] ("{name}") 에는 "inputSchema" 객체가 필요합니다. 인자가 없는 도구에는 다음을 쓰세요: {"type":"object","properties":{}}',
  "err.toolsArray": "transformTools() 에는 MCP 도구 배열을 넘겨야 합니다.",
  "err.spawn": "서버 명령을 시작할 수 없습니다 (`{command}`): {reason}",
  "err.rpcTimeout": "서버가 {ms}ms 안에 {method} 요청에 응답하지 않았습니다. 서버가 느리게 시작한다면 --timeout 값을 늘리세요.",
  "err.rpcError": "서버가 {method} 요청에 MCP 오류로 응답했습니다 (코드 {code}): {message}",
  "err.rpcErrorNoMethod": "서버가 요청에 MCP 오류로 응답했습니다 (코드 {code}): {message}",
  "err.serverExit": "tools/list 를 끝내기 전에 서버가 종료되었습니다.",
  "err.serverExitCode": "tools/list 를 끝내기 전에 서버가 종료되었습니다 (종료 코드 {code}).",
  "err.noToolsArray": "서버가 tools 배열 없이 tools/list 에 응답했습니다.",
  "err.cursorRepeat": "서버가 tools/list 커서를 반복했습니다. 무한 반복을 막기 위해 중단합니다.",
  "err.tooManyPages": "서버가 tools/list 페이지를 {max}개보다 많이 돌려주었습니다. 중단합니다.",
  "err.noTools": "서버가 도구를 하나도 돌려주지 않았습니다.",
  "err.toolNotFound": '도구를 찾을 수 없습니다: "{tool}". 사용 가능한 도구: {available}',
  "err.parseUnknown": "알 수 없는 옵션입니다: {option}",
  "err.parseMissingValue": "옵션 {option} 에는 값이 필요합니다.",
  "err.parseUnexpected": "예상하지 못한 인자입니다: {value}",
  "err.parseHint": "사용법은 `mcp-schema-shim --help` 로 확인하세요.",
  "err.unexpected": "예상하지 못한 오류: {detail}",
  "rep.error": "오류",
  "rep.warning": "경고",
  "rep.info": "정보",
  "rep.summary": "오류 {errors}개, 경고 {warnings}개, 정보 {infos}개",
  "rep.noFindings": "발견된 문제가 없습니다.",
  "rep.fixable": "수정 가능",
  "rep.notFixable": "수정 불가",
  "rep.yes": "예",
  "rep.no": "아니오",
  "rep.rootPointer": "(루트)",
  "rep.colSeverity": "심각도",
  "rep.colRule": "규칙",
  "rep.colTool": "도구",
  "rep.colPointer": "위치",
  "rep.colFix": "수정",
  "rep.mdTool": "도구",
  "rep.mdPointer": "위치",
  "rep.mdRule": "규칙",
  "rep.mdSeverity": "심각도",
  "rep.mdFixable": "수정 가능",
  "rep.mdDocs": "문서",
  "sim.banner": "연습용 목 모델 — 실제 모델 호출 없음",
  "sim.note": "서버와 서버의 인자 검증은 실제이고, 모델만 흉내 냅니다.",
  "sim.profile": "프로필:        ",
  "sim.tool": "도구:          ",
  "sim.exposedAs": "  (모델에 보이는 이름: {name})",
  "sim.intended": "의도한 인자:   ",
  "sim.mockSends": "목 모델이 보냄: ",
  "sim.direct": "직결:     ",
  "sim.viaShim": "shim 경유: ",
  "sim.ok": "성공 ",
  "sim.fail": "실패 ",
};

/** Korean one-line summaries per rule ID, used by the text/markdown report in Korean. */
const ruleKo: Record<string, string> = {
  "anthropic-strict/unsupported-constraint": "minimum·maximum·multipleOf·minLength·maxLength 와 배열 제약(maxItems, uniqueItems, 2 이상의 minItems)은 거부(400)됩니다. 설명으로 옮겨집니다.",
  "anthropic-strict/complex-pattern": "복잡한 정규식(200자 초과, 역참조, look-around, 단어 경계)은 거부됩니다. 패턴은 설명으로 옮겨집니다.",
  "anthropic-strict/unsupported-format": "지원하는 format 은 date-time, time, date, duration, email, hostname, uri, ipv4, ipv6, uuid 뿐이며 나머지는 거부(400)됩니다. 설명으로 옮겨집니다.",
  "anthropic-strict/additional-properties": "객체에는 additionalProperties: false 를 명시해야 합니다 (true 는 거부됩니다).",
  "anthropic-strict/additional-properties-schema": "스키마 값의 additionalProperties(맵)는 지원하지 않으며 false 만 쓸 수 있습니다.",
  "anthropic-strict/ref-recursive": "재귀 $ref 는 지원하지 않습니다.",
  "anthropic-strict/ref-external": "외부 $ref 는 지원하지 않습니다.",
  "anthropic-strict/tool-name": "도구 이름은 ^[a-zA-Z0-9_-]{1,128}$ 에 맞아야 합니다. 이름을 바꾸고 프록시가 되돌립니다.",
  "anthropic-strict/root-type": 'root 스키마에는 type "object" 가 필요합니다.',
  "anthropic-strict/root-object": "root 스키마는 객체 스키마여야 합니다.",
  "anthropic-strict/limit-tools": "한 요청에서 strict 도구는 최대 20개까지 허용됩니다. 전체 도구 목록 기준입니다.",
  "anthropic-strict/limit-optional": "한 요청의 모든 strict 도구 스키마를 합쳐 선택(optional) 매개변수는 최대 24개까지 허용됩니다. 모든 중첩 수준을 셉니다.",
  "gemini-json-schema/root-type": 'root 스키마에는 type "object" 가 필요합니다.',
  "gemini-json-schema/root-object": "root 스키마는 객체를 설명해야 합니다.",
  "gemini-json-schema/ref-external": "스키마 밖을 가리키는 $ref 는 API 가 해석할 수 없습니다.",
  "gemini-json-schema/ignored-keyword": "minLength/maxLength 는 제거되어 무시됩니다. shim 이 인자를 복원할 때는 원래 스키마가 여전히 검사합니다.",
  "gemini-parameters/meta-keyword": "$schema/$id/$comment/$anchor 는 Schema 필드가 아니어서 요청이 실패합니다. 제거됩니다.",
  "gemini-parameters/const": "const 는 Schema 필드가 아닙니다. 값이 하나인 enum 으로 바뀝니다 (문자열이 아닌 값은 문자열로 바꿨다가 나중에 복원).",
  "gemini-parameters/enum-non-string": "enum 은 문자열에만 정의됩니다. 다른 값은 문자열로 바뀌고(type 이 string 이 됨) 나중에 복원됩니다.",
  "gemini-parameters/type-array": 'type 배열(예: ["string","null"])은 허용되지 않습니다. nullable 이나 형제 필드 없는 anyOf 로 바뀝니다.',
  "gemini-parameters/anyof-siblings": "anyOf 에는 형제 필드를 둘 수 없습니다. 형제 필드(description 포함)는 각 분기 안으로 옮겨집니다.",
  "gemini-parameters/one-of": "oneOf 는 Schema 필드가 아닙니다. anyOf 로 바뀝니다 (배타성은 상위에서 보장되지 않고 원래 스키마가 다시 검사).",
  "gemini-parameters/all-of": "allOf 는 Schema 필드가 아닙니다. 객체 분기가 노드 하나로 합쳐집니다.",
  "gemini-parameters/ref-inlined": "$ref/$defs 는 Schema 필드가 아닙니다. 로컬 참조는 인라인으로 펼쳐집니다.",
  "gemini-parameters/ref-recursive": "재귀 $ref 는 인라인으로 펼 수 없습니다. 대신 gemini-json-schema 프로필(parametersJsonSchema)을 쓰세요.",
  "gemini-parameters/ref-external": "스키마 밖을 가리키는 $ref 는 해석할 수 없습니다.",
  "gemini-parameters/unsupported-keyword": "Schema 객체 밖의 키워드(additionalProperties, not, if/then/else, patternProperties, multipleOf 등)는 제거됩니다. 단순 값은 설명에 남습니다.",
  "gemini-parameters/format-unsupported": "일부 format 만 허용됩니다 (문자열: enum, date-time / 숫자: int32, int64, float, double). 나머지 format 은 설명으로 옮겨집니다.",
  "gemini-parameters/missing-type": "type: object 없는 properties 는 거부됩니다. type 이 추가됩니다.",
  "gemini-parameters/array-items-missing": "배열 스키마에는 items 가 필요합니다. 문자열 항목 스키마가 추가됩니다 (값은 원래 스키마가 다시 검사).",
  "gemini-parameters/root-type": 'root 스키마에는 type "object" 가 필요합니다.',
  "gemini-parameters/root-object": "root 스키마는 조합 키워드나 다른 타입이 아닌 객체 스키마여야 합니다.",
  "openai-strict/additional-properties": "모든 객체에 additionalProperties: false 가 필요합니다.",
  "openai-strict/optional-property": "모든 속성이 required 에 있어야 합니다. 선택 속성은 nullable 로 바뀝니다 (인자를 복원할 때 shim 이 null 을 다시 제거).",
  "openai-strict/const": "const 는 지원 키워드 목록에 없습니다. 값이 하나인 enum 으로 바뀝니다.",
  "openai-strict/unsupported-keyword": "not, if/then/else, dependentRequired/dependentSchemas, patternProperties(및 합칠 수 없는 allOf)는 지원하지 않아 제거됩니다.",
  "openai-strict/unsupported-format": "지원하는 format 은 date-time, time, date, duration, email, hostname, ipv4, ipv6, uuid 뿐입니다. 나머지는 설명으로 옮겨집니다.",
  "openai-strict/all-of": "allOf 는 지원하지 않습니다. 객체 분기가 노드 하나로 합쳐집니다.",
  "openai-strict/free-form-object": "고정 속성이 없는 객체(자유 형식 맵)는 strict 모드에서 표현할 수 없습니다. 계획: JSON 문자열 필드로 변환.",
  "openai-strict/root-anyof": "root 스키마는 anyOf 이면 안 됩니다.",
  "openai-strict/root-type": 'root 스키마에는 type "object" 가 필요합니다.',
  "openai-strict/root-object": "root 스키마는 객체 스키마여야 합니다.",
  "openai-strict/ref-recursive": "재귀 $ref: 인자 복원이 아직 재귀 구조를 따라가지 못합니다.",
  "openai-strict/ref-external": "스키마 밖을 가리키는 $ref 는 해석할 수 없습니다.",
  "openai-strict/limit-depth": "중첩은 최대 10단계까지 허용됩니다.",
  "openai-strict/limit-properties": "속성은 전체 합쳐 최대 5000개까지 허용됩니다.",
  "openai-strict/limit-enum": "enum 값은 전체 합쳐 최대 1000개까지 허용됩니다.",
};

export const MESSAGES: Record<Lang, Record<MsgKey, string>> = { en, ko };
export const RULE_SUMMARIES_KO: Readonly<Record<string, string>> = ruleKo;

export function hasKey(key: string): key is MsgKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

/** Look up a message and fill `{name}` placeholders. Unknown keys return the key itself. */
export function t(lang: Lang, key: MsgKey, params: Record<string, string | number> = {}): string {
  return MESSAGES[lang][key].replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

/** Korean summary of a rule, or undefined when the language is English or the rule has no entry. */
export function ruleSummary(lang: Lang, ruleId: string): string | undefined {
  return lang === "ko" ? ruleKo[ruleId] : undefined;
}

/** Build an InputError whose `message` stays English while `code`/`params` let the CLI localize it. */
export function inputError(code: MsgKey, params: Record<string, string | number> = {}): InputError {
  return new InputError(t("en", code, params), code, params);
}

/** Message of an InputError in the given language (English `message` when it has no known code). */
export function localizeInput(e: InputError, lang: Lang): string {
  if (e.code !== undefined && hasKey(e.code)) return t(lang, e.code, e.params);
  return e.message;
}
