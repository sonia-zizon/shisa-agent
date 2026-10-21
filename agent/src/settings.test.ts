import { IS_WIN } from "./plat.ts";
import { test } from "node:test";
import { resolveConnectors } from "./connectors.ts";
import { briefingTask } from "./briefing-sources.ts";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type Config } from "./config.ts";
import { Settings, excludeBriefingSources, mergeConfigFile, validatePatch, validatePhrases, modelOptions, SettingsError } from "./settings.ts";
import { phrase, setPhrases } from "./phrases.ts";
import { BRIEFING_TASK } from "./brain.ts";
import { Bus } from "./bus.ts";
import { Store } from "./store.ts";
import { Chat, type Converse, type ChatReply } from "./chat.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "cy-settings-"));
const cfgOf = (f: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = {}) => loadConfig(env, f);

test("config: models.quick 기본 Sonnet · config.json · env 순으로 이긴다", () => {
  assert.equal(cfgOf().models.quick, "claude-sonnet-5-5");
  assert.equal(cfgOf({ models: { quick: "claude-haiku-5-5" } }).models.quick, "claude-haiku-5-5");
  assert.equal(cfgOf({ models: { quick: "claude-haiku-5-5" } }, { CY_AGENT_MODEL_QUICK: "claude-opus-5-5" }).models.quick, "claude-opus-5-5");
  // 다른 역할과 따로: general 을 바꿔도 quick 은 그대로
  assert.equal(cfgOf({ models: { general: "claude-opus-5-5" } }).models.quick, "claude-sonnet-5-5");
  assert.deepEqual(cfgOf().briefing, { exclude: [] });
  assert.deepEqual(cfgOf({ briefing: { exclude: ["issues", 3] } }).briefing, { exclude: ["issues"] });
});

test("hover(캐릭터 빠른 대화)는 models.quick, 패널 대화는 general(모델 안 고르면), 고르면 그것", async () => {
  const cfg = cfgOf({ models: { general: "claude-opus-5-5", quick: "claude-sonnet-5-5" } });
  const seen: (string | undefined)[] = [];
  const converse: Converse = async (_c, _s, _h, _t, _o, _sum, _f, _tid, model) => { seen.push(model); return { reply_md: "응", bubble: "응", show: null, proposals: [] } as ChatReply; };
  const chat = new Chat(cfg, new Store(":memory:"), { emit: () => {}, openPanel: () => {}, changed: () => {}, propose: async () => {} }, converse);
  chat.send("캐릭터에서", { kind: "hover" });
  chat.send("패널에서");
  chat.send("패널에서 고름", { model: "claude-haiku-5-5" });
  chat.send("캐릭터에서 고름", { kind: "hover", model: "claude-haiku-5-5" });
  await chat.idle();
  assert.deepEqual(seen, ["claude-sonnet-5-5", undefined, "claude-haiku-5-5", "claude-haiku-5-5"]);
  // 설정 창이 바꾸면(메모리 cfg) 다음 hover 부터 바로
  cfg.models.quick = "claude-haiku-5-5";
  chat.send("또", { kind: "hover" });
  await chat.idle();
  assert.equal(seen.at(-1), "claude-haiku-5-5");
});

test("validatePatch: 앱이 내주는 모델·아는 출처만, 모르는 키는 거절", () => {
  const cfg = cfgOf();
  assert.deepEqual(modelOptions(cfg).map((o) => o.id), ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
  assert.deepEqual(validatePatch({ models: { quick: "claude-haiku-5-5" }, briefing: { exclude: ["issues", "issues"] } }, cfg), { models: { quick: "claude-haiku-5-5" }, briefing: { exclude: ["issues"] } });
  for (const bad of [null, [], { port: 1 }, { models: { quick: "gpt-4" } }, { models: { other: "claude-opus-5-5" } }, { briefing: { exclude: ["mail", "twitter"] } }, { briefing: { only: [] } }, { models: "x" }]) {
    assert.throws(() => validatePatch(bad, cfg), SettingsError, JSON.stringify(bad));
  }
});

test("mergeConfigFile: 다른 키(토큰 등)는 그대로, models·briefing 은 합치고, 원자적으로 쓴다", () => {
  const d = tmp(), p = join(d, "config.json");
  writeFileSync(p, JSON.stringify({ slackBotToken: "xoxb-keep", repoRoots: ["/a"], models: { code: "claude-opus-5-5" }, briefing: { exclude: ["mail"], other: 1 } }));
  mergeConfigFile(p, { models: { quick: "claude-haiku-5-5" }, briefing: { exclude: ["issues"] } });
  assert.deepEqual(JSON.parse(readFileSync(p, "utf8")), { slackBotToken: "xoxb-keep", repoRoots: ["/a"], models: { code: "claude-opus-5-5", quick: "claude-haiku-5-5" }, briefing: { exclude: ["issues"], other: 1 } });
  assert.deepEqual(readdirSync(d), ["config.json"], "임시 파일이 남지 않는다");
  // 없는 파일이면 새로
  const q = join(d, "sub", "config.json");
  mergeConfigFile(q, { models: { general: "claude-opus-5-5" } });
  assert.deepEqual(JSON.parse(readFileSync(q, "utf8")), { models: { general: "claude-opus-5-5" } });
  // 깨진 파일은 덮어쓰지 않는다
  const r = join(d, "broken.json");
  writeFileSync(r, "{ not json");
  assert.throws(() => mergeConfigFile(r, { models: { quick: "claude-haiku-5-5" } }), /덮어쓰지 않았어요/);
  assert.equal(readFileSync(r, "utf8"), "{ not json");
});

test("Settings.put: 메모리 cfg 바로 반영 + 파일, env 가 정한 역할은 알린다, 잘못된 값은 아무것도 안 바꾼다", () => {
  const d = tmp(), p = join(d, "config.json");
  writeFileSync(p, JSON.stringify({ slackAppToken: "xapp-keep" }));
  const cfg = cfgOf();
  const s = new Settings(cfg, { path: p, env: { CY_AGENT_MODEL_CODE: "claude-opus-5-5" } });
  assert.deepEqual(s.view().envLocked, ["code"]);
  const r = s.put({ models: { quick: "claude-haiku-5-5", code: "claude-sonnet-5-5" }, briefing: { exclude: ["issues"] } });
  assert.ok(r.ok);
  assert.equal(r.restartNeeded, false);
  assert.match(r.note!, /CY_AGENT_MODEL_CODE/);
  assert.equal(cfg.models.quick, "claude-haiku-5-5");
  assert.equal(cfg.models.code, "claude-sonnet-5-5");
  assert.deepEqual(cfg.briefing, { exclude: ["issues"] });
  assert.deepEqual(JSON.parse(readFileSync(p, "utf8")), { slackAppToken: "xapp-keep", models: { quick: "claude-haiku-5-5", code: "claude-sonnet-5-5" }, briefing: { exclude: ["issues"] } });
  const bad = s.put({ models: { quick: "nope" } });
  assert.deepEqual(bad, { ok: false, status: 400, error: "models.quick must be one of the offered models" });
  assert.equal(cfg.models.quick, "claude-haiku-5-5");
  // 파일을 못 쓰면 메모리도 그대로
  writeFileSync(p, "[broken");
  const fail = s.put({ models: { quick: "claude-opus-5-5" } });
  assert.equal(fail.ok, false);
  assert.equal(cfg.models.quick, "claude-haiku-5-5");
  assert.ok(existsSync(p));
});

test("PUT /settings: 헤더 필수, 메모리 cfg 를 바로 바꾸고 GET 이 새 값, 잘못된 값은 400", async () => {
  const d = tmp(), p = join(d, "config.json");
  const cfg = cfgOf();
  const s = new Settings(cfg, { path: p, env: {} });
  const bus = new Bus();
  await bus.listen(0, {
    approve: async () => "", hold: async () => "", briefing: async () => "", dashboard: async () => ({}), todoDone: () => true, chat: () => "c", chatHistory: () => [],
    settings: { get: () => s.view(), put: (b) => s.put(b) },
  });
  const base = `http://127.0.0.1:${(bus.server!.address() as any).port}`;
  const put = (body: unknown, headers: Record<string, string> = { "x-cy-agent": "1" }) =>
    fetch(`${base}/settings`, { method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    const g = await (await fetch(`${base}/settings`)).json();
    assert.equal(g.models.quick, "claude-sonnet-5-5");
    assert.equal((await put({ models: { quick: "claude-haiku-5-5" } }, {})).status, 403);
    assert.equal((await put({ models: { quick: "claude-haiku-5-5" } }, { "x-cy-agent": "1", origin: "https://evil.example" })).status, 403);
    assert.equal(cfg.models.quick, "claude-sonnet-5-5");
    const r = await put({ models: { quick: "claude-haiku-5-5" } });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).settings.models.quick, "claude-haiku-5-5");
    assert.equal(cfg.models.quick, "claude-haiku-5-5", "데몬 메모리에 바로");
    assert.equal((await (await fetch(`${base}/settings`)).json()).models.quick, "claude-haiku-5-5");
    assert.equal((await put({ models: { quick: "gpt" } })).status, 400);
    assert.equal((await put({ nope: 1 })).status, 400);
  } finally {
    bus.close();
  }
});

test("excludeBriefingSources: 뺀 출처는 줄을 빼고 못 박는다 · 안 뺐으면 원래 글 그대로", () => {
  const conns = resolveConnectors({}, { connectors: { calendar: { mode: "api", icsUrl: "https://cal.example.com/a.ics" }, mail: { mode: "mcp", preset: "gmail" }, slack: { mode: "api", userToken: "xoxp-real" }, issues: { mode: "mcp", preset: "github" } } });
  const task = briefingTask(conns);
  assert.equal(excludeBriefingSources(task, []), task);
  const t = excludeBriefingSources(task, ["issues"]);
  assert.doesNotMatch(t, /\d\) 이슈:/);
  assert.match(t, /사용자가 브리핑에서 뺀 출처: 이슈/);
  assert.match(t, /1\) 캘린더: .*\n2\) 메일: 최근 24시간 받은 메일/);
  assert.match(t, /4\) 위 최근 세션 맥락/); // 번호를 다시 매긴다
  assert.match(t, /^정기 브리핑\./);
  assert.match(t, /우선순위: 1=오늘 꼭/); // 꼬리는 그대로
  const m = excludeBriefingSources(task, ["mail", "slack"]);
  assert.match(m, /1\) 캘린더: .*\n2\) 이슈:/);
  assert.doesNotMatch(m, /받은 메일/);
  assert.doesNotMatch(m, /Slack DM·멘션/);
  assert.match(m, /뺀 출처: 메일, Slack/);
});

test("브리핑은 설정의 제외 출처를 따른다(think 가 cfg.briefing.exclude 로 과제 글을 바꾼다)", async () => {
  // brain.think 는 SDK 를 부르니, 같은 규칙을 쓰는지만 소스로 확인 + 실제 변환은 위 시험
  const src = readFileSync(new URL("./brain.ts", import.meta.url), "utf8");
  assert.match(src, /if \(task\.startsWith\(BRIEFING_HEAD\)\) task = excludeBriefingSources\(task, briefingExcludeOf\(cfg\)\)/);
  const cfg = cfgOf({ briefing: { exclude: ["issues"] } }) as Config;
  assert.doesNotMatch(excludeBriefingSources(BRIEFING_TASK, cfg.briefing!.exclude), /나에게 할당된 열린 이슈/);
});

test("validatePhrases: 아는 키만, 모르는 자리표시는 거절(줄 수·길이 제한 없음), 빈 글·기본값과 같은 글은 null(기본값으로)", () => {
  assert.deepEqual(validatePhrases({ dance: "춤!\n 얍 \n", todo_new_one: ["새: {title}"], hello: "", mcp_back: null, merge_done: "머지했어요 🎉 (스이시~사)" }),
    { dance: ["춤!", "얍"], todo_new_one: ["새: {title}"], hello: null, mcp_back: null, merge_done: null });
  for (const bad of [[], "x", { nope: "a" }, { dance: 3 }, { dance: ["a", 1] }, { todo_new_one: "{title} {pr}" }, { dance: "{title}" }]) {
    assert.throws(() => validatePhrases(bad), SettingsError, JSON.stringify(bad).slice(0, 60));
  }
  const many = Array.from({ length: 50 }, (_, i) => `줄${i} ${"x".repeat(2000)}`);
  assert.deepEqual(validatePhrases({ dance: many.join("\n") }), { dance: many }, "줄 수·길이 제한 없음");
  assert.throws(() => validatePhrases({ todo_new_one: "{pr}" }), /모르는 자리표시 \{pr\} — 쓸 수 있는 것: \{title\}/);
  assert.throws(() => validatePatch({ phrases: { dance: "{x}" } }, cfgOf()), /이 문구는 자리표시를 못 써요/);
  assert.deepEqual(validatePatch({ phrases: { dance: "춤" } }, cfgOf()), { phrases: { dance: ["춤"] } });
});

test("config: phrases 는 글·줄 배열을 줄들로, 이상한 값은 건너뛴다", () => {
  assert.deepEqual(cfgOf().phrases, {});
  assert.deepEqual(cfgOf({ phrases: { dance: "a\nb", hello: ["안녕"], x: 3, merge_done: "" } }).phrases, { dance: ["a", "b"], hello: ["안녕"] });
  assert.deepEqual(cfgOf({ phrases: "nope" }).phrases, {});
});

test("Settings: 문구 고치기 — 파일에 키 단위로 합치고 메모리·말풍선에 바로, null 이면 기본값으로(파일에서 빠짐)", () => {
  const d = tmp(), p = join(d, "config.json");
  writeFileSync(p, JSON.stringify({ slackBotToken: "xoxb-keep", phrases: { hello: ["반가워요"] } }));
  const cfg = cfgOf({ phrases: { hello: ["반가워요"] } });
  try {
    const s = new Settings(cfg, { path: p, env: {} });
    assert.equal(phrase("hello"), "반가워요", "켤 때 config.json 의 고친 문구");
    const v = s.view().phrases.find((x) => x.key === "todo_new_one")!;
    assert.deepEqual(v, { key: "todo_new_one", group: "할 일", label: "새 할 일 하나", vars: ["title"], default: ["새 할 일이 생겼어요: '{title}'"], value: null });
    assert.deepEqual(s.view().phrases.find((x) => x.key === "hello")!.value, ["반가워요"]);
    const r = s.put({ phrases: { dance: "춤!\n얍", hello: null } });
    assert.ok(r.ok);
    assert.equal(phrase("dance", {}, 0), "춤!", "바로 적용");
    assert.equal(phrase("hello"), "안녕하세요! 곧 브리핑할게요");
    assert.deepEqual(JSON.parse(readFileSync(p, "utf8")), { slackBotToken: "xoxb-keep", phrases: { dance: ["춤!", "얍"] } });
    assert.deepEqual(r.ok && r.settings.phrases.find((x) => x.key === "dance")!.value, ["춤!", "얍"]);
    // 잘못된 자리표시면 아무것도 안 바뀐다
    const bad = s.put({ phrases: { dance: "{title}" } });
    assert.equal(bad.ok, false);
    assert.equal(phrase("dance", {}, 0), "춤!");
    // 다 기본값으로 돌리면 phrases 키가 파일에서 빠진다
    assert.ok(s.put({ phrases: { dance: "" } }).ok);
    assert.deepEqual(JSON.parse(readFileSync(p, "utf8")), { slackBotToken: "xoxb-keep" });
    assert.equal(phrase("dance"), "💃 춤춰요!");
  } finally {
    setPhrases({});
  }
});

test("Settings: 뇌·이름·레포 폴더 — 바로 반영, 키 지우기·모델 기본으로, 다른 칸은 그대로, 잘못된 값은 400", () => {
  const d = tmp(), p = join(d, "config.json");
  writeFileSync(p, JSON.stringify({ slackAppToken: "xapp-keep", brain: { provider: "openai", openaiApiKey: "sk-old-key-1234567890abcdef" }, user: { aliases: ["gildong"] } }));
  const cfg = cfgOf({ brain: { provider: "openai", openaiApiKey: "sk-old-key-1234567890abcdef" } });
  const s = new Settings(cfg, { path: p, env: {} });
  assert.deepEqual(s.view().brain.keys, { gemini: false, openai: true, anthropic: false, genspark: false });
  const r = s.put({ brain: { provider: "anthropic", keys: { anthropic: " sk-ant-new-1234567890 ", openai: null }, model: "claude-haiku-5-5" }, user: { name: "  홍  길동 " }, repoRoots: IS_WIN ? ["C:\\Users\\me\\code\\", "c:/users/me/code", "/C:/Users/me/code"] : ["/Users/me/code/", "/Users/me/code"] });
  assert.ok(r.ok);
  assert.equal(cfg.brain.provider, "anthropic");
  assert.equal(cfg.brain.anthropicApiKey, "sk-ant-new-1234567890");
  assert.equal(cfg.brain.openaiApiKey, undefined);
  assert.equal(cfg.models.general, "claude-haiku-5-5");
  assert.equal(cfg.user.name, "홍 길동");
  assert.deepEqual(cfg.user.aliases, []);
  assert.deepEqual(cfg.repoRoots, [IS_WIN ? "C:\\Users\\me\\code" : "/Users/me/code"]);
  const file = JSON.parse(readFileSync(p, "utf8"));
  assert.deepEqual(file.brain, { provider: "anthropic", anthropicApiKey: "sk-ant-new-1234567890" });
  assert.deepEqual(file.user, { aliases: ["gildong"], name: "홍 길동" });
  assert.deepEqual(file.models, { general: "claude-haiku-5-5" });
  assert.equal(file.slackAppToken, "xapp-keep");
  assert.equal(JSON.stringify(s.view()).includes("sk-ant"), false, "보기에는 키가 없다");
  assert.ok(s.put({ brain: { model: "default" } }).ok);
  assert.equal(cfg.models.general, "claude-sonnet-5-5");
  assert.equal(JSON.parse(readFileSync(p, "utf8")).models, undefined);
  for (const bad of [{ brain: { provider: "gpt" } }, { brain: { keys: { gemini: "has space" } } }, { brain: { keys: { other: "x" } } }, { brain: { model: "a b" } }, { repoRoots: ["relative/dir"] }, { user: { name: 3 } }]) {
    const x = s.put(bad);
    assert.equal(x.ok, false, JSON.stringify(bad));
  }
  const e = s.put({ brain: { keys: { gemini: "AIza secret" } } });
  assert.equal(!e.ok && e.error.includes("AIza"), false, "오류 글에 키가 없다");
});

test("Settings: 오늘 할 일 알림: 기본은 아침 한 번, 고치면 파일·메모리에 바로, 잘못된 값은 400", () => {
  const dir = tmp();
  const p = join(dir, "config.json");
  writeFileSync(p, JSON.stringify({ slackBotToken: "xoxb-keep" }));
  const cfg = cfgOf();
  assert.deepEqual(cfg.todayReminder, { mode: "auto", everyHours: 0, times: [] });
  const s = new Settings(cfg, { path: p, env: {} });
  assert.deepEqual(s.view().todayReminder, { mode: "auto", everyHours: 0, times: [] });
  const r = s.put({ todayReminder: { mode: "auto", everyHours: 3, times: ["14:00", "09:30"] } });
  assert.equal(r.ok, true);
  assert.deepEqual(cfg.todayReminder, { mode: "auto", everyHours: 3, times: ["09:30", "14:00"] });
  const file = JSON.parse(readFileSync(p, "utf8"));
  assert.deepEqual(file.todayReminder, { mode: "auto", everyHours: 3, times: ["09:30", "14:00"] });
  assert.equal(file.slackBotToken, "xoxb-keep");
  assert.deepEqual(cfgOf(file).todayReminder, cfg.todayReminder, "다시 켜도 같은 값");
  assert.equal(s.put({ todayReminder: { mode: "off" } }).ok, true);
  assert.equal(cfg.todayReminder?.mode, "off");
  const bad = s.put({ todayReminder: { mode: "loud" } });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.status, 400);
  assert.equal(s.put({ todayReminder: { times: ["9시"] } }).ok, false);
  assert.equal(cfg.todayReminder?.mode, "off", "잘못된 값은 아무것도 안 바꾼다");
});

test("Settings: 일정 알림: 기본 10분 전, 여러 번·끔, 파일·메모리에 바로, 잘못된 값은 400", () => {
  const dir = tmp();
  const p = join(dir, "config.json");
  writeFileSync(p, JSON.stringify({ slackBotToken: "xoxb-keep" }));
  const cfg = cfgOf();
  assert.deepEqual(cfg.calendarAlert, { minutesBefore: [10] });
  const changed: string[][] = [];
  const s = new Settings(cfg, { path: p, env: {}, onChange: (k) => changed.push(k) });
  assert.deepEqual(s.view().calendarAlert, { minutesBefore: [10] });
  const big = s.put({ calendarAlert: { minutesBefore: [1, 2, 3, 4, 1440] } });
  assert.equal(big.ok, true, "개수·크기 상한 없음(하루 전도)");
  assert.deepEqual(cfg.calendarAlert, { minutesBefore: [1440, 4, 3, 2, 1] });
  const r = s.put({ calendarAlert: { minutesBefore: [5, 15, 5] } });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.settings.calendarAlert, { minutesBefore: [15, 5] });
  assert.deepEqual(cfg.calendarAlert, { minutesBefore: [15, 5] });
  assert.deepEqual(changed.at(-1), ["calendarAlert"]);
  const file = JSON.parse(readFileSync(p, "utf8"));
  assert.deepEqual(file.calendarAlert, { minutesBefore: [15, 5] });
  assert.equal(file.slackBotToken, "xoxb-keep");
  assert.deepEqual(cfgOf(file).calendarAlert, cfg.calendarAlert, "다시 켜도 같은 값");
  // 끔: 빈 목록도 그대로 남는다(기본으로 돌아가지 않게)
  assert.equal(s.put({ calendarAlert: { minutesBefore: [] } }).ok, true);
  assert.deepEqual(cfg.calendarAlert, { minutesBefore: [] });
  assert.deepEqual(cfgOf(JSON.parse(readFileSync(p, "utf8"))).calendarAlert, { minutesBefore: [] });
  for (const bad of [{ minutesBefore: [0] }, { minutesBefore: [-1] }, { minutesBefore: [2.5] }, { minutesBefore: ["10"] }, { minutes: [10] }, { minutesBefore: 10 }, [10], null]) {
    const e = s.put({ calendarAlert: bad });
    assert.equal(e.ok, false, JSON.stringify(bad));
    if (!e.ok) assert.equal(e.status, 400);
  }
  assert.deepEqual(cfg.calendarAlert, { minutesBefore: [] }, "잘못된 값은 아무것도 안 바꾼다");
});

test("config: calendarAlert 읽기, 이상한 값은 빼고 모양이 틀리면 기본", () => {
  assert.deepEqual(cfgOf({ calendarAlert: { minutesBefore: [30, "x", 0, 5, 5, 2880, 60, 1] } }).calendarAlert, { minutesBefore: [2880, 60, 30, 5, 1] });
  assert.deepEqual(cfgOf({ calendarAlert: "loud" }).calendarAlert, { minutesBefore: [10] });
  assert.deepEqual(cfgOf({ calendarAlert: { minutesBefore: [] } }).calendarAlert, { minutesBefore: [] });
});

test("Settings: repoRoots 는 Windows 경로를 받아 정상 형태로 저장, 맥 경로는 Windows 에서 거절", () => {
  const d = tmp(), p = join(d, "config.json");
  writeFileSync(p, "{}");
  const cfg = cfgOf({});
  const s = new Settings(cfg, { path: p, env: {} });
  if (IS_WIN) {
    assert.ok(s.put({ repoRoots: ["C:\\a\\b", "C:/c/d/", "/D:/e"] }).ok);
    assert.deepEqual(cfg.repoRoots, ["C:\\a\\b", "C:\\c\\d", "D:\\e"]);
    assert.deepEqual(JSON.parse(readFileSync(p, "utf8")).repoRoots, ["C:\\a\\b", "C:\\c\\d", "D:\\e"]);
    for (const bad of ["/Users/me", "C:\\", "rel", "\\\\srv\\x"]) assert.equal(s.put({ repoRoots: [bad] }).ok, false, bad);
  } else {
    assert.ok(s.put({ repoRoots: ["/a/b/"] }).ok);
    assert.deepEqual(cfg.repoRoots, ["/a/b"]);
    assert.equal(s.put({ repoRoots: ["C:\\a"] }).ok, false);
  }
});

test("Settings: in 자동반영은 기본 끔, 채널·멤버 ID 가 둘 다 올바를 때만 켜지고 아니면 끔으로 저장", () => {
  const d = tmp(), p = join(d, "config.json");
  writeFileSync(p, "{}");
  const cfg = cfgOf({});
  const s = new Settings(cfg, { path: p, env: {} });
  assert.equal(s.view().autoWorkHours, false);
  assert.equal(s.view().leaveInChannel, "");
  let r = s.put({ autoWorkHours: true });
  assert.ok(r.ok);
  assert.equal(cfg.autoWorkHours, false, "채널·ID 없이는 켜지지 않는다");
  r = s.put({ autoWorkHours: true, leaveInChannel: " https://x.slack.com/archives/CABC12345 ", leaveInUser: " UABC12345 " });
  assert.ok(r.ok);
  assert.equal(cfg.autoWorkHours, true);
  assert.equal(cfg.leaveInUser, "UABC12345");
  assert.equal(JSON.parse(readFileSync(p, "utf8")).autoWorkHours, true);
  r = s.put({ leaveInUser: "" });
  assert.ok(r.ok);
  assert.equal(cfg.autoWorkHours, false, "ID 를 비우면 끔");
  assert.equal(JSON.parse(readFileSync(p, "utf8")).autoWorkHours, false);
  assert.equal(s.put({ leaveInChannel: 5 }).ok, false);
  assert.equal(s.put({ leaveInChannel: "x".repeat(301) }).ok, false);
});
