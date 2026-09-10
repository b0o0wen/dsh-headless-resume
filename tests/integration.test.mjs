import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dsh = process.env.DSH_BIN || 'dsh';
function command(bin, args, options) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 60_000, maxBuffer: 4 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error && (error.killed || typeof error.code !== 'number')) {
        reject(new Error(`${bin}: ${error.message}\n${stdout}\n${stderr}`));
      } else resolve({ code: error?.code ?? 0, stdout, stderr });
    });
  });
}
function success(result) {
  assert.equal(result.code, 0, JSON.stringify(result, null, 2));
  return result;
}
function sessionId(result) {
  const matches = [...result.stderr.matchAll(/^dsh: session: (\S+)$/gm)];
  assert.equal(matches.length, 1, result.stderr);
  return matches[0][1];
}

// An actual packed plugin, pnpm installation, shipped CLI, Cordis tree, Agent
// loop and JSONL persistence. Only the LLM adapter is replaced; no API key needed.
test('installed plugin resumes durable history across CLI processes', { timeout: 240_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-headless-resume-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  const env = { ...process.env, DSH_HOME: home, DSH_TEST_REQUESTS: join(root, 'requests.jsonl') };
  delete env.DEEPSEEK_API_KEY;
  delete env.NODE_OPTIONS;
  const options = { cwd: workspace, env };
  const packed = success(await command('npm', ['pack', '--json', '--pack-destination', root, '--cache', join(root, 'npm-cache')], { ...options, cwd: project }));
  const tarball = join(root, JSON.parse(packed.stdout)[0].filename);
  success(await command(dsh, ['plugin', '--profile', 'headless-resume', 'add', '--offline', '--store-dir', join(root, 'pnpm-store'), tarball], options));
  const profile = join(home, 'profiles', 'headless-resume');
  const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@b0o0wen/dsh-headless-resume']);
  await copyFile(join(project, 'tests', 'fixtures', 'history-llm.mjs'), join(profile, 'history-llm.mjs'));
  await writeFile(join(profile, 'cordis.patch.yml'), `
- id: agent-default-model
  config:
    provider: history-test
    model: history-test
- id: session-title-llm
  disabled: true
- id: session-telemetry-otel
  disabled: true
- insert:
    - id: history-test-llm
      name: './history-llm.mjs'
`);
  const run = args => command(dsh, ['--profile', 'headless-resume', ...args], options);
  const help = success(await run(['--help']));
  assert.match(help.stdout, /--resume <sessionId>/);
  for (const args of [[], ['--resume'], ['--resume', '', 'recall'], ['--resume', '   ', 'recall'], ['--resume', 'session-missing']]) {
    const invalid = await run(args);
    assert.notEqual(invalid.code, 0, JSON.stringify({ args, ...invalid }));
    assert.doesNotMatch(invalid.stderr, /^dsh: session: /m);
  }
  const secret = randomUUID();
  const first = success(await run([`remember:${secret}`]));
  assert.equal(first.stdout, 'remembered\n');
  const id = sessionId(first);
  assert.match(id, /^session-[a-f0-9-]{36}$/);
  const filesBefore = await readdir(join(home, 'sessions'), { recursive: true });
  assert.ok(filesBefore.some(path => path.includes(id) && /\.jsonl(?:\.zstd)?$/.test(path)), filesBefore.join('\n'));
  const resumed = success(await run(['--resume', id, 'recall']));
  assert.equal(resumed.stdout, `recalled:${secret}\n`);
  assert.equal(sessionId(resumed), id);
  const requests = (await readFile(env.DSH_TEST_REQUESTS, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(requests.length, 2);
  assert.ok(JSON.stringify(requests[1]).includes(`remember:${secret}`));
  assert.ok(JSON.stringify(requests[1]).includes('remembered'));
  const repeated = success(await run(['--resume', id, 'recall']));
  assert.equal(repeated.stdout, `recalled:${secret}\n`);
  assert.equal(sessionId(repeated), id);
  const failed = await run(['--resume', id, 'fail-now']);
  assert.equal(failed.code, 1, JSON.stringify(failed));
  assert.equal(failed.stdout, '\n'); // Never replay the previous successful answer.
  assert.match(failed.stderr, /TEST_FAILURE.*intentional provider failure/);
  assert.equal(sessionId(failed), id);

  // Exercise the README's local-source install and legacy-profile migration.
  manifest.dsh.profile.bundles.splice(1, 0, '@deepseek-ai/dsh-headless');
  await writeFile(join(profile, 'package.json'), JSON.stringify(manifest));
  success(await command(dsh, ['plugin', '--profile', 'headless-resume', 'add', '--offline', '--store-dir', join(root, 'pnpm-store'), 'file:.'], { ...options, cwd: project }));
  const upgraded = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'));
  upgraded.dsh.profile.bundles = upgraded.dsh.profile.bundles.filter(name => name !== '@deepseek-ai/dsh-headless');
  await writeFile(join(profile, 'package.json'), JSON.stringify(upgraded));
  const recovered = success(await run(['--resume', id, 'recall']));
  assert.equal(recovered.stdout, `recalled:${secret}\n`);
  assert.equal(sessionId(recovered), id);

  const missing = await run(['--resume', `session-${randomUUID()}`, 'recall']);
  assert.equal(missing.code, 1, JSON.stringify(missing));
  assert.equal(missing.stdout, '');
  assert.doesNotMatch(missing.stderr, /^dsh: session: /m);
  const filesAfter = await readdir(join(home, 'sessions'), { recursive: true });
  assert.deepEqual(filesAfter.filter(path => /\.jsonl(?:\.zstd)?$/.test(path)).sort(), filesBefore.filter(path => /\.jsonl(?:\.zstd)?$/.test(path)).sort());
});
