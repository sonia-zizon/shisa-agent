import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NEW_DAEMON_CONFIG, setupView, cleanSetupPatch,
  SETUP_PHASES, SETUP_FLOW_VERSION, isSetupPhase, phaseAfterBrain, backPhase, restorePhase, agentFrom, setupSummary, okFolder, folderValue, openSetupAtLaunch, NO_AI,
} from '../src/setup-plan.js';

test('허용 phase 와 버전: 이름 → 뇌 → 키·안내 → 더 연결 → 끝', () => {
  assert.deepEqual(SETUP_PHASES, ['name', 'brain', 'ai-key', 'extras', 'connect', 'done']);
  assert.equal(SETUP_FLOW_VERSION, '7');
  assert.equal(isSetupPhase('name'), true);
  for (const p of ['welcome', 'ai-pick', 'hub', 'walk', '', null]) assert.equal(isSetupPhase(p), false, String(p));
});

test('뇌 고르기: 키 제공자는 키 화면, 찾은(로그인된) CLI 는 바로 다음, 아니면 설치 안내, 나중에는 다음', () => {
  for (const id of ['gemini', 'claude', 'openai']) assert.equal(phaseAfterBrain(id), 'ai-key');
  assert.equal(phaseAfterBrain('claudecode', { loggedIn: true }), 'extras');
  assert.equal(phaseAfterBrain('codexcli', { loggedIn: false }), 'connect');
  assert.equal(phaseAfterBrain('codexcli'), 'connect');
  assert.equal(phaseAfterBrain('skip'), 'extras');
  assert.equal(phaseAfterBrain('nope'), 'brain');
});

test('이전: 모든 화면에서 한 단계 뒤로', () => {
  assert.equal(backPhase({ phase: 'brain' }), 'name');
  assert.equal(backPhase({ phase: 'ai-key' }), 'brain');
  assert.equal(backPhase({ phase: 'extras' }), 'brain');
  assert.equal(backPhase({ phase: 'connect', afterConnect: true }), 'brain');
  assert.equal(backPhase({ phase: 'connect' }), 'extras');
  assert.equal(backPhase({ phase: 'done' }), 'extras');
  assert.equal(backPhase({ phase: 'name' }), 'name');
});

test('저장된 phase 복원: 모르는 값(예전 플랜 화면)은 처음으로', () => {
  assert.equal(restorePhase('extras'), 'extras');
  assert.equal(restorePhase('hub'), 'name');
  assert.equal(restorePhase(null), 'name');
});

test('코딩 도구: 연결 끝낸 것 또는 시사 AI 로 쓰는 것', () => {
  assert.equal(agentFrom({ done: { claude: true } }), 'claude');
  assert.equal(agentFrom({ connected: ['codexcli'] }), 'codex');
  assert.equal(agentFrom({ done: { codex: true }, connected: ['claudecode'] }), 'claude');
  assert.equal(agentFrom({}), null);
  assert.equal(agentFrom(), null);
});

test('끝 화면 요약: 된 것과 나중에 할 것', () => {
  const s = setupSummary({ brain: { ready: true, label: 'Gemini' }, done: { gcal: true }, repos: ['/Users/me/code'], name: '홍길동' });
  assert.deepEqual(s.map((x) => [x.id, x.ok]), [['name', true], ['brain', true], ['calendar', true], ['slack', false], ['repos', true], ['sessions', false]]);
  assert.equal(s[1].text, 'Gemini');
  const none = setupSummary({ brain: { ready: true, local: true } });
  assert.equal(none.every((x) => !x.ok), true, '로컬 뇌는 연결로 치지 않는다');
  assert.match(none[1].text, /나중에/);
  assert.equal(okFolder('/Users/me/code'), true);
  assert.equal(okFolder('code'), false);
  assert.equal(okFolder(''), false);
});

test('cleanSetupPatch: 이름·레포 폴더만, 모양이 아니면 null', async () => {
  const { cleanSetupPatch } = await import('../src/setup-plan.js');
  assert.deepEqual(cleanSetupPatch({ user: { name: ' 홍길동 ' } }), { user: { name: '홍길동' } });
  assert.deepEqual(cleanSetupPatch({ user: { name: '' } }), { user: { name: null } });
  assert.deepEqual(cleanSetupPatch({ repoRoots: ['/a', ' /b '] }), { repoRoots: ['/a', '/b'] });
  for (const bad of [null, [], {}, { user: { name: 3 } }, { repoRoots: ['rel'] }, { repoRoots: '/a' }, { brain: { provider: 'x' } }, { user: { name: 'a' }, models: {} }]) {
    assert.equal(cleanSetupPatch(bad), null, JSON.stringify(bad));
  }
});

test('openSetupAtLaunch: 처음 켠 앱(state.json 없음)이나 CY_SHOW_SETUP=1 이면 마법사를 바로 연다', () => {
  assert.equal(openSetupAtLaunch({ firstRun: true }), true);
  assert.equal(openSetupAtLaunch({ firstRun: false, env: { CY_SHOW_SETUP: '1' } }), true);
  assert.equal(openSetupAtLaunch({ firstRun: false, env: {} }), false);
  assert.equal(openSetupAtLaunch(), false);
});

test('AI 없이 쓰기: 건너뛰기가 아니라 로컬 뇌로 정하고 다음 단계로, 끝 화면은 AI 없이 쓰기라고', () => {
  assert.equal(NO_AI, 'none');
  assert.equal(phaseAfterBrain(NO_AI), 'extras');
  const s = setupSummary({ brain: { ready: true, local: true } });
  assert.equal(s[1].ok, false);
  assert.match(s[1].text, /AI 없이 쓰기/);
  assert.match(s[1].text, /설정/);
  assert.doesNotMatch(setupSummary({})[1].text, /—/);
});

test('작업 기록 읽기 동의: 처음엔 꺼짐, 켜야 끝 화면에 읽는다고 나온다', () => {
  assert.deepEqual(setupView({}), { name: '', repoRoots: [], readSessions: false, onboarded: true });
  assert.equal(setupView({ readSessions: true, onboarded: false }).readSessions, true);
  assert.equal(setupView({ onboarded: false }).onboarded, false);
  assert.equal(setupView(undefined).readSessions, false);
  const off = setupSummary({}).find((x) => x.id === 'sessions');
  assert.equal(off.ok, false);
  assert.match(off.text, /읽지 않아요/);
  const on = setupSummary({ readSessions: true }).find((x) => x.id === 'sessions');
  assert.equal(on.ok, true);
  for (const r of [...setupSummary({}), ...setupSummary({ readSessions: true })]) assert.doesNotMatch(r.text, /—/);
});

test('cleanSetupPatch: 작업 기록 읽기(참/거짓)와 마법사 마침(true 만)', () => {
  assert.deepEqual(cleanSetupPatch({ readSessions: true }), { readSessions: true });
  assert.deepEqual(cleanSetupPatch({ readSessions: false }), { readSessions: false });
  assert.deepEqual(cleanSetupPatch({ onboarded: true }), { onboarded: true });
  assert.deepEqual(cleanSetupPatch({ onboarded: true, readSessions: false, repoRoots: ['/a'] }), { onboarded: true, readSessions: false, repoRoots: ['/a'] });
  for (const bad of [{ readSessions: 'yes' }, { onboarded: false }, { onboarded: 'true' }, { onboarded: true, brain: {} }]) {
    assert.equal(cleanSetupPatch(bad), null, JSON.stringify(bad));
  }
});

test('앱이 데몬보다 먼저 만드는 config.json 은 새 설치 표시(onboarded: false)', () => {
  assert.deepEqual({ ...NEW_DAEMON_CONFIG }, { onboarded: false });
  assert.equal(Object.isFrozen(NEW_DAEMON_CONFIG), true);
});

test('okFolder·cleanSetupPatch: Windows 경로도 받고 앞 슬래시는 떼고, 드라이브 맨 위·UNC·상대는 거절', () => {
  for (const ok of ['C:\\code', 'C:/code/repo', '/C:/code', 'd:\\x\\y', ' /Users/me/code ']) assert.equal(okFolder(ok), true, ok);
  for (const bad of ['', 'code', 'C:', 'C:\\', 'C:/', '\\\\server\\share', '//server/share', 'rel\\dir']) assert.equal(okFolder(bad), false, bad);
  assert.equal(folderValue(' /C:/code '), 'C:/code');
  assert.equal(folderValue('C:\\code'), 'C:\\code');
  assert.equal(folderValue('/Users/me'), '/Users/me');
  assert.deepEqual(cleanSetupPatch({ repoRoots: ['/C:/a', ' C:\\b ', '/c'] }), { repoRoots: ['C:/a', 'C:\\b', '/c'] });
  assert.equal(cleanSetupPatch({ repoRoots: ['C:\\'] }), null);
});
