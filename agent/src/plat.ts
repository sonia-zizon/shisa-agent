// 운영체제 차이(Windows · macOS · Linux)를 한곳에. POSIX 는 예전 동작 그대로 — Windows 일 때만 다르게 본다.
// 순수 도우미는 plat 인자를 받아(기본 process.platform) macOS 에서도 Windows 경우를 테스트할 수 있다.
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export type Plat = NodeJS.Platform;
export const IS_WIN = process.platform === "win32";

// 절대 경로인가. POSIX: '/' 로 시작. Windows: 드라이브 절대(C:\ · C:/)만 — UNC(\\서버\…)·\\?\ 는 안 받는다(네트워크로 새지 않게)
export function isAbsPath(p: string, plat: Plat = process.platform): boolean {
  if (plat !== "win32") return p.startsWith("/");
  return /^[A-Za-z]:[\\/]/.test(p);
}

// 레포 폴더 입력 다듬기(설정 repoRoots 저장용). 절대 경로가 아니면 null.
// POSIX: '/' 로 시작, 끝의 / 는 뗀다. Windows: C:\x · C:/x · /C:/x(앞의 / 하나는 뗀다) → C:\x. 드라이브 맨 위(C:\)·UNC 는 null
export function normRoot(raw: string, plat: Plat = process.platform): string | null {
  const s = String(raw).trim();
  if (plat !== "win32") return isAbsPath(s, plat) ? s.replace(/\/+$/, "") || "/" : null;
  const m = /^[\\/]([A-Za-z]:(?:[\\/].*)?)$/.exec(s);
  const d = m ? m[1] : s;
  if (!/^[A-Za-z]:[\\/]/.test(d)) return null;
  const n = path.win32.normalize(d).replace(/[\\/]+$/, "");
  return /^[A-Za-z]:$/.test(n) ? null : n; // 드라이브 맨 위는 안 됨
}

// Git Bash(MSYS) 경로 → Windows 경로: /c/Users/x · /cygdrive/c/x → C:\Users\x. 아니면 그대로. Windows 에서만
export function msysToWin(p: string, plat: Plat = process.platform): string {
  if (plat !== "win32") return p;
  const m = /^\/(?:cygdrive\/)?([A-Za-z])(?=\/|$)(.*)$/.exec(p);
  return m ? `${m[1].toUpperCase()}:\\${m[2].replace(/^\/+/, "").replace(/\//g, "\\")}` : p;
}

// Git Bash 셸 글의 위치(cd · git -C 대상 등) → Windows 경로. /c/… · /cygdrive/c/… → C:\…, 드라이브 경로·상대·~ 는 그대로.
// 그 밖에 / 나 \ 로 시작하는 것(/tmp · /usr · / 는 Git 설치 폴더 안 · //서버 는 네트워크)은 어딘지 모름 → ""(판정은 안전한 쪽으로). POSIX 는 그대로
export function bashPathWin(p: string, plat: Plat = process.platform): string {
  if (plat !== "win32") return p;
  const w = msysToWin(p, plat);
  if (w !== p) return w;
  return /^[\\/]/.test(p) ? "" : p;
}

// Windows UNC·장치 경로인가(\\서버\… · //서버/… · \\?\… · \\.\… · \??\…) — 비교 열쇠(pathKey)가 C:\ 와 안 맞아 비밀 경로 판정을 비켜 간다.
// \\?\C:\… (긴 경로 접두사)만 C:\… 로 바꿔 돌려주고, 그 밖 UNC·장치 경로는 undefined. 보통 경로·POSIX 는 그대로
export function winLocalPath(p: string, plat: Plat = process.platform): string | undefined {
  if (plat !== "win32") return p;
  const m = /^[\\/]{2}\?[\\/]([A-Za-z]):(?:[\\/]([\s\S]*))?$/.exec(p);
  if (m) return `${m[1].toUpperCase()}:\\${m[2] ?? ""}`;
  if (/^[\\/]{2}|^[\\/]\?\?[\\/]/.test(p)) return undefined;
  return p;
}

// 비교 열쇠(파일 시스템 안 봄). POSIX: 그대로. Windows: 구분자 \ · 소문자 · 각 조각 끝의 점·공백(Windows 가 떼어 냄)과
// 대체 데이터 스트림(:$DATA 등)을 뗀다 — `CONFIG.JSON.` · `config.json::$DATA` 가 같은 파일을 가리키므로
export function pathKey(p: string, plat: Plat = process.platform): string {
  if (plat !== "win32") return p;
  const r = path.win32.resolve(p);
  const root = path.win32.parse(r).root;
  const rest = r.slice(root.length).split("\\").map((s) => s.replace(/:.*$/, "").replace(/[. ]+$/, "")).filter(Boolean);
  return (root + rest.join("\\")).toLowerCase();
}

// dir 안(같거나 아래)인가. POSIX 는 예전 문자열 비교 그대로, Windows 는 pathKey 로(대소문자·구분자 무시)
export function pathWithin(p: string, dir: string, plat: Plat = process.platform): boolean {
  if (plat !== "win32") return p === dir || p.startsWith(dir.endsWith("/") ? dir : dir + "/");
  const a = pathKey(p, plat), d = pathKey(dir, plat);
  return a === d || a.startsWith(d.endsWith("\\") ? d : d + "\\");
}
export const samePath = (a: string, b: string, plat: Plat = process.platform) => (plat !== "win32" ? a === b : pathKey(a, plat) === pathKey(b, plat));

// 로컬 폴더 프로젝트 노드 id(project:<절대 경로>). Windows 는 project:C:\…
export const isLocalProjectId = (id: string) => id.startsWith("project:/") || (IS_WIN && /^project:[A-Za-z]:[\\/]/.test(id));
export const LOCAL_PROJECT_SQL = IS_WIN ? "(id LIKE 'project:/%' OR id GLOB 'project:[A-Za-z]:[\\/]*')" : "id LIKE 'project:/%'";

// ── Windows 셸 글 판정용(Claude Code 의 Bash = Git Bash) ──
// 글 비교용: 역슬래시 → /, 소문자
export const winNorm = (s: string) => s.replace(/\\+/g, "/").toLowerCase();
// 한 경로가 셸 글에 나올 수 있는 모양들(winNorm 한 것): c:/users/x · /c/users/x · /cygdrive/c/users/x
export function winPathForms(p: string): string[] {
  const k = winNorm(path.win32.resolve(p)).replace(/\/+$/, "");
  const m = /^([a-z]):(\/.*)?$/.exec(k);
  return m ? [k, `/${m[1]}${m[2] ?? ""}`, `/cygdrive/${m[1]}${m[2] ?? ""}`] : [k];
}
// 명령 이름 다듬기: Windows 는 실행 파일 이름이 대소문자 무관이고 .exe 를 붙여도 된다(GIT.exe push = git push) → 판정 전에 git 으로
const WIN_CMD_NAMES = "git|gh|rm|sudo|env|command|exec|nohup|time|builtin|xargs|cd|pushd|eval|source|sh|bash|zsh|dash|cmd|powershell|pwsh|curl|wget";
export function winShellNorm(cmd: string): string {
  return cmd.replace(new RegExp(`(^|[^\\w.-])(${WIN_CMD_NAMES})(\\.exe)?(?=$|[\\s;&|)'"\`])`, "gi"), (_m, pre: string, name: string) => pre + name.toLowerCase());
}

// 디스크 맨 위인가(/ · C:\)
export function isFsRoot(p: string, plat: Plat = process.platform): boolean {
  if (plat !== "win32") return p === "/";
  const r = path.win32.resolve(p);
  return r === path.win32.parse(r).root;
}

// 있는 데까지 실제 경로(Windows 는 native — 8.3 짧은 이름(ABCDEF~1)·대소문자·정션까지 풀린다) + 없는 나머지
// 너무 긴 경로(글자·조각 수)는 파일 시스템을 끝까지 걷지 않고 "모름"(REALISH_UNKNOWN)으로 — 안전한 쪽(비밀·루트 밖으로 본다).
// Windows 의 모름은 장치 경로 모양이라 winLocalPath 가 undefined(UNC 처럼 막힘), POSIX 는 절대 경로가 아니라 어느 루트 안도 아님
export const REALISH_MAX_LEN = 4096, REALISH_MAX_SEGS = 256;
const UNKNOWN_WIN = "\\\\?\\UNC\\cy-agent-unknown-path", UNKNOWN_POSIX = "\0cy-agent-unknown-path";
export const isRealishUnknown = (p: string) => p === UNKNOWN_WIN || p === UNKNOWN_POSIX;
// 한 판정(permissions.ts quick 한 번) 동안 existsSync·realish 결과를 기억한다 — 같은 낱말·같은 조상 폴더를 거듭 보지 않게. 밖에서는 늘 새로 본다
let memo: { exists: Map<string, boolean>; real: Map<string, string> } | undefined;
export function withFsMemo<T>(fn: () => T): T {
  if (memo) return fn();
  memo = { exists: new Map(), real: new Map() };
  try { return fn(); } finally { memo = undefined; }
}
const exists = (p: string) => {
  if (!memo) return existsSync(p);
  let v = memo.exists.get(p);
  if (v === undefined) { v = existsSync(p); memo.exists.set(p, v); }
  return v;
};
export function realish(p: string, plat: Plat = process.platform): string {
  const cur = path.resolve(p);
  if (cur.length > REALISH_MAX_LEN || cur.split(/[\\/]/).length > REALISH_MAX_SEGS) return plat === "win32" ? UNKNOWN_WIN : UNKNOWN_POSIX;
  return realishAt(cur, plat);
}
// 있는 조상까지 올라가 실제 경로로 + 없는 나머지(조상 결과는 memo 로 다시 쓴다)
function realishAt(cur: string, plat: Plat): string {
  const key = `${plat}\0${cur}`;
  const hit = memo?.real.get(key);
  if (hit !== undefined) return hit;
  let out: string;
  if (exists(cur)) {
    out = cur;
    try { out = plat === "win32" ? realpathSync.native(cur) : realpathSync(cur); } catch {}
  } else {
    const up = path.dirname(cur);
    out = up === cur ? cur : path.join(realishAt(up, plat), path.basename(cur));
  }
  memo?.real.set(key, out);
  return out;
}

// PATH 안에서 실행 파일 찾기 → 전체 경로(없으면 undefined).
// Windows: PATH 키는 대소문자 무관(Path), PATHEXT(.EXE·.CMD·.BAT…)를 붙여 본다(npm 이 까는 codex 는 codex.cmd)
export function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env, plat: Plat = process.platform, exists: (p: string) => boolean = isFile): string | undefined {
  if (!/^[A-Za-z0-9._+-]+$/.test(name)) return undefined;
  const p = plat === "win32" ? path.win32 : path.posix;
  const key = plat === "win32" ? Object.keys(env).find((k) => k.toUpperCase() === "PATH") : "PATH";
  const dirs = (key ? env[key] ?? "" : "").split(p.delimiter).map((d) => d.replace(/^"(.*)"$/, "$1")).filter(Boolean);
  const exts = plat === "win32" ? winExts(env, name) : [""];
  for (const dir of dirs) for (const ext of exts) { const f = p.join(dir, name + ext); if (exists(f)) return f; }
  return undefined;
}
function winExts(env: NodeJS.ProcessEnv, name: string): string[] {
  const k = Object.keys(env).find((x) => x.toUpperCase() === "PATHEXT");
  const list = (k ? env[k] : undefined)?.split(";").map((e) => e.trim()).filter((e) => /^\.[A-Za-z0-9]+$/.test(e)).map((e) => e.toLowerCase()) ?? [".com", ".exe", ".bat", ".cmd"]; // 파일 시스템이 대소문자 무관 — 소문자로
  // 이름에 이미 확장자가 있으면(codex.cmd) 그대로도 본다. 확장자 없는 파일(셸 스크립트)은 Windows 가 못 돌리니 안 본다
  return list.some((e) => name.toLowerCase().endsWith(e.toLowerCase())) ? ["", ...list] : list;
}
const isFile = (f: string) => { try { return statSync(f).isFile(); } catch { return false; } };

// cmd.exe 메타 문자 — cross-spawn 과 같은 방식(따옴표로 감싸고 ^ 로 막는다). .cmd/.bat 는 한 번 더 파싱돼서 두 번 막는다
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
export function cmdQuoteArg(arg: string, batch: boolean): string {
  let a = String(arg).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1");
  a = `"${a}"`.replace(CMD_META, "^$1");
  return batch ? a.replace(CMD_META, "^$1") : a;
}
// .cmd/.bat 실행: spawn 은 셸 없이 못 돌린다(Node 의 EINVAL 막음) → cmd.exe /d /s /c "…". windowsVerbatimArguments 로 넘겨야 한다
export type SpawnSpec = { file: string; args: string[]; verbatim: boolean };
export function winSpawnSpec(file: string, args: readonly string[], comspec = process.env.ComSpec || "cmd.exe"): SpawnSpec {
  if (!/\.(cmd|bat)$/i.test(file)) return { file, args: [...args], verbatim: false };
  const line = [file.replace(CMD_META, "^$1"), ...args.map((a) => cmdQuoteArg(a, true))].join(" ");
  return { file: comspec, args: ["/d", "/s", "/c", `"${line}"`], verbatim: true };
}
// 명령 이름 → 실제로 띄울 것. POSIX 는 그대로. Windows 는 PATH 에서 찾고 .cmd 면 cmd.exe 로
export function spawnSpec(name: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env, plat: Plat = process.platform, exists?: (p: string) => boolean): SpawnSpec {
  if (plat !== "win32") return { file: name, args: [...args], verbatim: false };
  const found = /[\\/]/.test(name) ? name : findOnPath(name, env, plat, exists) ?? name;
  return winSpawnSpec(found, args);
}

// Windows 에서 "열기"가 곧 실행인 확장자(실행 파일·스크립트·바로 가기·설치 패키지·레지스트리·제어판 항목 등) + PATHEXT
const WIN_RUNNABLE = [
  ".exe", ".com", ".bat", ".cmd", ".scr", ".pif", ".cpl", ".msi", ".msp", ".msc", ".lnk", ".url", ".website", ".hta", ".js", ".jse", ".vbs", ".vbe", ".vb",
  ".wsf", ".wsh", ".ws", ".wsc", ".sct", ".ps1", ".psm1", ".psd1", ".ps1xml", ".psc1", ".reg", ".inf", ".scf", ".chm", ".jar", ".gadget", ".shb", ".shs",
  ".application", ".appref-ms", ".settingcontent-ms", ".library-ms", ".search-ms", ".searchconnector-ms", ".xbap", ".diagcab", ".appx", ".appxbundle",
  ".msix", ".msixbundle", ".appinstaller", ".xll", ".mht", ".mhtml",
];
// 이 파일을 Windows 에서 기본 앱으로 열면 무언가 실행될 수 있나. 끝 점·공백(Windows 가 떼어 냄)은 떼고 보고, :스트림이 붙은 이름은 늘 위험으로
export function winRunnable(p: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const name = path.win32.basename(p);
  if (name.includes(":")) return true;
  const n = name.replace(/[. ]+$/, "").toLowerCase();
  const k = Object.keys(env).find((x) => x.toUpperCase() === "PATHEXT");
  const extra = (k ? env[k] ?? "" : "").split(";").map((e) => e.trim().toLowerCase()).filter((e) => /^\.[a-z0-9_-]+$/.test(e));
  return [...WIN_RUNNABLE, ...extra].some((e) => n.endsWith(e));
}

// 기본 앱으로 열기: macOS open · Windows explorer(쉼표가 있는 이름도 되게 따옴표째 verbatim) · 그 밖 xdg-open
// Windows: 실행·스크립트 확장자(winRunnable)는 열지 않고 그 폴더를 열어 파일만 골라 둔다(explorer /select,)
export function openSpec(p: string, plat: Plat = process.platform, env: NodeJS.ProcessEnv = process.env): SpawnSpec {
  if (plat === "darwin") return { file: "/usr/bin/open", args: [p], verbatim: false };
  if (plat === "win32") {
    const q = `"${p.replace(/"/g, "")}"`;
    return { file: "explorer.exe", args: [winRunnable(p, env) ? `/select,${q}` : q], verbatim: true };
  }
  return { file: "xdg-open", args: [p], verbatim: false };
}
