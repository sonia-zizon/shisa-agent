import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normRoot, bashPathWin, isRealishUnknown, realish, winLocalPath, winRunnable, withFsMemo } from "./plat.ts";
import { cmdQuoteArg, findOnPath, isAbsPath, isFsRoot, msysToWin, openSpec, pathKey, pathWithin, samePath, spawnSpec, winNorm, winPathForms, winShellNorm, winSpawnSpec } from "./plat.ts";
import { testSpawn, userShellArgs } from "./fixer.ts";

test("isAbsPath: POSIX 는 / 만, Windows 는 드라이브 절대만(UNC·상대·/ 는 안 됨)", () => {
  assert.equal(isAbsPath("/Users/me/code", "darwin"), true);
  assert.equal(isAbsPath("C:\\code", "darwin"), false);
  assert.equal(isAbsPath("code", "darwin"), false);
  assert.equal(isAbsPath("C:\\Users\\me", "win32"), true);
  assert.equal(isAbsPath("d:/x", "win32"), true);
  assert.equal(isAbsPath("\\\\evil\\share\\x", "win32"), false);
  assert.equal(isAbsPath("\\\\?\\C:\\x", "win32"), false);
  assert.equal(isAbsPath("C:x", "win32"), false);
  assert.equal(isAbsPath("/c/Users", "win32"), false);
});

test("msysToWin: Git Bash /c/… → C:\\…, POSIX 는 그대로", () => {
  assert.equal(msysToWin("/c/Users/me/.cy-agent", "win32"), "C:\\Users\\me\\.cy-agent");
  assert.equal(msysToWin("/cygdrive/d/x", "win32"), "D:\\x");
  assert.equal(msysToWin("/c", "win32"), "C:\\");
  assert.equal(msysToWin("/code/x", "win32"), "/code/x");
  assert.equal(msysToWin("/c/Users", "darwin"), "/c/Users");
});

test("pathKey·pathWithin·samePath: Windows 는 대소문자·구분자·끝 점·:스트림 무시, POSIX 는 그대로", () => {
  assert.equal(pathKey("C:/Users/Me/.CY-AGENT/config.json.", "win32"), "c:\\users\\me\\.cy-agent\\config.json");
  assert.equal(pathKey("C:\\Users\\me\\.cy-agent\\config.json::$DATA", "win32"), "c:\\users\\me\\.cy-agent\\config.json");
  assert.equal(pathKey("C:\\a\\b. . \\c", "win32"), "c:\\a\\b\\c");
  assert.equal(samePath("C:\\Users\\Me\\.cy-agent\\CONFIG.JSON", "c:/users/me/.cy-agent/config.json", "win32"), true);
  assert.equal(pathWithin("c:\\USERS\\me\\.claude\\x", "C:\\Users\\me\\.claude", "win32"), true);
  assert.equal(pathWithin("C:\\Users\\me\\.claude", "C:\\Users\\me\\.claude", "win32"), true);
  assert.equal(pathWithin("C:\\Users\\me\\.claude-x", "C:\\Users\\me\\.claude", "win32"), false);
  assert.equal(pathWithin("C:\\Users\\me\\..\\other", "C:\\Users\\me", "win32"), false);
  assert.equal(pathWithin("D:\\Users\\me\\x", "C:\\Users\\me", "win32"), false);
  // POSIX: 대소문자 구분(예전 그대로)
  assert.equal(pathWithin("/Users/Me/x", "/Users/me", "darwin"), false);
  assert.equal(pathWithin("/Users/me/x", "/Users/me", "darwin"), true);
  assert.equal(samePath("/a", "/A", "darwin"), false);
});

test("isFsRoot: / · C:\\ · c:/", () => {
  assert.equal(isFsRoot("/", "darwin"), true);
  assert.equal(isFsRoot("/x", "darwin"), false);
  assert.equal(isFsRoot("C:\\", "win32"), true);
  assert.equal(isFsRoot("c:/", "win32"), true);
  assert.equal(isFsRoot("C:\\x", "win32"), false);
});

test("winPathForms·winNorm: 셸 글에 나올 모양", () => {
  assert.deepEqual(winPathForms("C:\\Users\\Me"), ["c:/users/me", "/c/users/me", "/cygdrive/c/users/me"]);
  assert.equal(winNorm("C:\\Users\\ME\\.Claude"), "c:/users/me/.claude");
});

test("winShellNorm: GIT.exe push → git push · 경로로 부른 git.exe 도, 다른 낱말은 그대로", () => {
  assert.equal(winShellNorm("GIT.exe push origin main"), "git push origin main");
  // 판정용 글이라 따옴표 안 낱말이 같이 바뀌어도 괜찮다(실행엔 원래 글)
  assert.equal(winShellNorm("cd x && Git commit -m 'Fix GIT'"), "cd x && git commit -m 'Fix git'");
  assert.equal(winShellNorm('"C:\\Program Files\\Git\\bin\\git.EXE" push'), '"C:\\Program Files\\Git\\bin\\git" push');
  assert.equal(winShellNorm("RM -rf /"), "rm -rf /");
  assert.equal(winShellNorm("legit push"), "legit push");
  assert.equal(winShellNorm("my-git push"), "my-git push");
});

test("findOnPath: Windows 는 Path 키(대소문자 무관)·PATHEXT, POSIX 는 그대로", () => {
  const files = new Set(["C:\\npm\\codex.cmd", "C:\\Git\\cmd\\git.exe", "/usr/local/bin/codex"]);
  const exists = (f: string) => files.has(f);
  const env = { Path: "C:\\Windows;C:\\npm;\"C:\\Git\\cmd\"", PATHEXT: ".COM;.EXE;.BAT;.CMD" };
  assert.equal(findOnPath("codex", env, "win32", exists), "C:\\npm\\codex.cmd");
  assert.equal(findOnPath("git", env, "win32", exists), "C:\\Git\\cmd\\git.exe");
  assert.equal(findOnPath("codex.cmd", env, "win32", exists), "C:\\npm\\codex.cmd");
  assert.equal(findOnPath("nope", env, "win32", exists), undefined);
  assert.equal(findOnPath("../codex", env, "win32", exists), undefined);
  assert.equal(findOnPath("codex", { PATH: "/usr/bin:/usr/local/bin" }, "darwin", exists), "/usr/local/bin/codex");
});

test("cmd.exe 인자 막기: 메타 문자는 ^, .cmd 는 두 번", () => {
  assert.equal(cmdQuoteArg("gpt-5", false), '^"gpt-5^"');
  assert.equal(cmdQuoteArg("a&b", false), '^"a^&b^"');
  assert.equal(cmdQuoteArg("a&b", true), '^^^"a^^^&b^^^"');
  assert.equal(cmdQuoteArg('say "hi"', false), '^"say^ \\^"hi\\^"^"');
  assert.equal(cmdQuoteArg("C:\\dir\\", false), '^"C:\\dir\\\\^"');
});

test("winSpawnSpec·spawnSpec: .cmd 는 cmd.exe /d /s /c(verbatim), .exe 는 그대로, POSIX 는 이름 그대로", () => {
  const s = winSpawnSpec("C:\\npm\\codex.cmd", ["exec", "--json", "-"], "cmd.exe");
  assert.equal(s.file, "cmd.exe");
  assert.equal(s.verbatim, true);
  assert.deepEqual(s.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.match(s.args[3], /^"C:\\npm\\codex\.cmd \^\^\^"exec\^\^\^" /);
  assert.ok(s.args[3].endsWith('"'));
  assert.deepEqual(winSpawnSpec("C:\\Git\\git.exe", ["log"]), { file: "C:\\Git\\git.exe", args: ["log"], verbatim: false });
  assert.deepEqual(spawnSpec("codex", ["exec"], {}, "darwin"), { file: "codex", args: ["exec"], verbatim: false });
  const env = { Path: "C:\\npm", PATHEXT: ".EXE;.CMD" };
  assert.equal(spawnSpec("codex", ["exec"], env, "win32", (f) => f === "C:\\npm\\codex.cmd").verbatim, true);
  // 못 찾으면 이름 그대로(spawn 이 ENOENT 로 실패)
  assert.deepEqual(spawnSpec("codex", ["exec"], env, "win32", () => false), { file: "codex", args: ["exec"], verbatim: false });
});

test("openSpec: macOS open · Windows explorer(따옴표째) · Linux xdg-open", () => {
  assert.deepEqual(openSpec("/a/b.png", "darwin"), { file: "/usr/bin/open", args: ["/a/b.png"], verbatim: false });
  assert.deepEqual(openSpec("C:\\x\\a,b.png", "win32"), { file: "explorer.exe", args: ['"C:\\x\\a,b.png"'], verbatim: true });
  assert.deepEqual(openSpec("/a/b.png", "linux"), { file: "xdg-open", args: ["/a/b.png"], verbatim: false });
});

test("testSpawn: POSIX 는 로그인 셸(예전 그대로), Windows 는 npm.cmd → cmd.exe, .exe 는 바로", () => {
  const posix = testSpawn(["npm", "test"], "darwin");
  const [sh, args] = userShellArgs(["npm", "test"]);
  assert.deepEqual(posix, { file: sh, args, verbatim: false });
  const env = { Path: "C:\\node;C:\\py", PATHEXT: ".EXE;.CMD" };
  const files = new Set(["C:\\node\\npm.cmd", "C:\\py\\python.exe"]);
  const npm = testSpawn(["npm", "test"], "win32", env, (f) => files.has(f));
  assert.equal(npm.verbatim, true);
  assert.deepEqual(npm.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.match(npm.args[3], /npm\.cmd \^\^\^"test\^\^\^"/);
  assert.deepEqual(testSpawn(["python", "-m", "pytest"], "win32", env, (f) => files.has(f)), { file: "C:\\py\\python.exe", args: ["-m", "pytest"], verbatim: false });
  // 경로로 준 명령은 PATH 를 안 본다
  assert.equal(testSpawn(["C:\\r\\.venv\\Scripts\\python.exe", "-m", "pytest"], "win32", env, () => false).file, "C:\\r\\.venv\\Scripts\\python.exe");
});

test("openSpec(Windows): 실행·스크립트 확장자(PATHEXT 포함)는 열지 않고 폴더에서 골라 두기(explorer /select,)", () => {
  const env = { PATHEXT: ".COM;.EXE;.BAT;.CMD;.PY" };
  for (const f of ["C:\\a\\evil.exe", "C:\\a\\x.JS", "C:\\a\\x.lnk", "C:\\a\\x.url", "C:\\a\\x.hta", "C:\\a\\x.ps1", "C:\\a\\x.msi", "C:\\a\\x.reg", "C:\\a\\x.appref-ms", "C:\\a\\x.settingcontent-ms", "C:\\a\\x.exe.", "C:\\a\\x.cmd ", "C:\\a\\x.py", "C:\\a\\x.txt:y.exe", "C:\\a\\x.vbs", "C:\\a\\x.scr", "C:\\a\\x.library-ms", "C:\\a\\x.application"])
    assert.deepEqual(openSpec(f, "win32", env), { file: "explorer.exe", args: [`/select,"${f}"`], verbatim: true }, f);
  for (const f of ["C:\\a\\b.png", "C:\\a\\doc.pdf", "C:\\a\\exe.txt", "C:\\a\\notes.md"]) assert.deepEqual(openSpec(f, "win32", env), { file: "explorer.exe", args: [`"${f}"`], verbatim: true }, f);
  assert.equal(winRunnable("C:\\a\\x.py", {}), false); // PATHEXT 에 없으면 .py 는 열기
  assert.deepEqual(openSpec("/a/evil.exe", "darwin"), { file: "/usr/bin/open", args: ["/a/evil.exe"], verbatim: false }); // macOS 는 그대로
});

test("bashPathWin·winLocalPath: Git Bash 안쪽 경로·UNC 는 모름(\"\"/undefined), \\\\?\\C:\\ 는 C:\\, POSIX 는 그대로", () => {
  assert.equal(bashPathWin("/c/Users/me", "win32"), "C:\\Users\\me");
  assert.equal(bashPathWin("/cygdrive/d/x", "win32"), "D:\\x");
  for (const p of ["/tmp", "/tmp/x", "/usr/bin", "/", "//srv/share", "\\x"]) assert.equal(bashPathWin(p, "win32"), "", p);
  for (const p of ["~/x", "~", "rel/x", "C:/x", "C:\\x"]) assert.equal(bashPathWin(p, "win32"), p, p);
  assert.equal(bashPathWin("/tmp", "darwin"), "/tmp");
  assert.equal(winLocalPath("\\\\?\\C:\\Users\\me", "win32"), "C:\\Users\\me");
  assert.equal(winLocalPath("//?/d:/x", "win32"), "D:\\x");
  for (const p of ["\\\\localhost\\c$\\x", "//localhost/c$/x", "\\\\?\\UNC\\srv\\x", "\\\\.\\C:\\x", "\\??\\C:\\x", "\\/srv/x"]) assert.equal(winLocalPath(p, "win32"), undefined, p);
  assert.equal(winLocalPath("C:\\x", "win32"), "C:\\x");
  assert.equal(winLocalPath("//srv/x", "darwin"), "//srv/x");
});

test("realish: 있는 데까지 실제 경로 + 나머지 · 아주 긴 경로(조각 2만 개)는 걷지 않고 모름 · withFsMemo 안에서도 같은 답", () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "cy-plat-")));
  mkdirSync(join(dir, "a"));
  assert.equal(realish(join(dir, "a", "b", "c")), join(dir, "a", "b", "c"));
  assert.equal(withFsMemo(() => [realish(join(dir, "a", "x")), realish(join(dir, "a", "x"))].join("|")), `${join(dir, "a", "x")}|${join(dir, "a", "x")}`);
  assert.equal(withFsMemo(() => withFsMemo(() => realish(dir))), dir); // 겹쳐도 됨
  const t0 = performance.now();
  const deep = realish(join(dir, ...Array(20000).fill("s")));
  assert.ok(performance.now() - t0 < 200);
  assert.ok(isRealishUnknown(deep));
  if (process.platform === "win32") assert.equal(winLocalPath(deep), undefined); // Windows: UNC 처럼 막히는 모양
  assert.ok(!isRealishUnknown(realish(join(dir, ...Array(50).fill("s")))));
});
test("normRoot: Windows 는 C:\\x · C:/x · /C:/x 를 C:\\x 로, 맨 위·UNC·상대는 null. POSIX 는 끝 / 만 뗀다", () => {
  assert.equal(normRoot("C:\\code\\repo", "win32"), "C:\\code\\repo");
  assert.equal(normRoot("C:/code/repo/", "win32"), "C:\\code\\repo");
  assert.equal(normRoot(" /C:/code/repo ", "win32"), "C:\\code\\repo");
  assert.equal(normRoot("c:\\Code\\", "win32"), "c:\\Code");
  for (const bad of ["", "C:\\", "C:/", "/C:/", "relative\\dir", "\\\\server\\share", "/Users/me", "C:"]) assert.equal(normRoot(bad, "win32"), null, bad);
  assert.equal(normRoot("/Users/me/code/", "darwin"), "/Users/me/code");
  assert.equal(normRoot("/", "darwin"), "/");
  assert.equal(normRoot("C:\\code", "darwin"), null);
  assert.equal(normRoot("code", "darwin"), null);
});

test("레포 허용 비교(pathWithin): 슬래시·백슬래시·대소문자·드라이브 문자가 달라도 같은 폴더", () => {
  const root = normRoot("/C:/Code/Repos/", "win32")!;
  assert.equal(pathWithin("c:/code/repos/app/src", root, "win32"), true);
  assert.equal(pathWithin("C:\\CODE\\REPOS", root, "win32"), true);
  assert.equal(pathWithin("C:\\Code\\Repos-x\\app", root, "win32"), false);
  assert.equal(pathWithin("D:\\Code\\Repos\\app", root, "win32"), false);
});
