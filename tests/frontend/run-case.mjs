import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

// Transport payloads in an args file: hostile test strings never become Windows command text.
const root = resolve(import.meta.dirname, '../..');
const report = resolve(process.env.QA_REPORT || resolve(root, 'reports/frontend-20261126'));
const session = JSON.parse(readFileSync(resolve(report, 'session.json'), 'utf8'));
// Reject a misdirected session before any tool action; runtime instrumentation also enforces the storage namespace.
if (!resolve(session.qaRoot).startsWith(resolve(root, '.build') + sep))
  throw new Error('只允许操作.build下的隔离项目');
const input = JSON.parse(process.argv[2] || '{"case":"bootstrap"}');
const argsFile = resolve(report, 'arguments.json');
writeFileSync(argsFile, JSON.stringify([input]));
async function evaluate(source, withArgs = false) {
  const args = [
    resolve(root, 'scripts/wechatide.mjs'),
    'automation_evaluate',
    '--project',
    session.qaRoot,
    '--fn-source',
    source,
  ];
  if (withArgs) args.push('--args-file', argsFile);
  const output = await new Promise((done, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, windowsHide: true });
    let text = '';
    child.stdout.on('data', (data) => (text += data));
    child.stderr.on('data', (data) => {
      if (withArgs) process.stderr.write(data);
    });
    child.on('error', reject);
    child.on('close', () => done(text));
  });
  const result = JSON.parse(output);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.result?.result?.result;
}
// Case execution survives navigation in App scope; RPC polls never hold a page alive or mask a lost result.
try {
  if (!input.recover) await evaluate('function(input){return getApp().qa.start(input);}', true);
  const deadline = Date.now() + (input.timeoutMs || 600000);
  let actual;
  let lastPhase;
  while (Date.now() < deadline) {
    let status;
    try {
      status = await evaluate('function(){return getApp().qa.status();}');
    } catch (error) {
      appendFileSync(
        resolve(report, 'poll-errors.ndjson'),
        JSON.stringify({ at: new Date().toISOString(), input, error: String(error) }) + '\n',
      );
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 2000));
      continue;
    }
    if (!status.running) {
      actual = status.result;
      break;
    }
    if (status.progress?.phase !== lastPhase) {
      lastPhase = status.progress?.phase;
      console.log(JSON.stringify({ case: input.case, progress: status.progress }));
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
  }
  if (!actual) throw new Error('测试未在限定时间内返回；保留现场，禁止并行重发');
  if (
    actual.case !== input.case ||
    (input.records && actual.data?.records !== input.records) ||
    (input.projects && actual.data?.projects !== input.projects)
  )
    throw new Error('返回场景与请求不匹配，拒绝把另一场景结果计为通过');
  const result = { ok: true, result: { result: { result: actual } } };
  appendFileSync(
    resolve(report, 'results.ndjson'),
    JSON.stringify({ at: new Date().toISOString(), input, result }) + '\n',
  );
  const failures = actual.checks.filter((check) => !check.pass);
  // A completed scenario with a failed assertion is a test failure, even when the IDE transport succeeded.
  if (actual.exception || failures.length) process.exitCode = 1;
  console.log(
    JSON.stringify(
      {
        case: input.case,
        checks: actual.checks.length,
        passed: actual.checks.length - failures.length,
        failures,
        data: actual.data,
        exception: actual.exception,
        elapsedMs: actual.elapsedMs,
      },
      null,
      2,
    ),
  );
} catch (error) {
  appendFileSync(
    resolve(report, 'results.ndjson'),
    JSON.stringify({ at: new Date().toISOString(), input, toolError: String(error) }) + '\n',
  );
  console.error(String(error));
  process.exitCode = 1;
}
