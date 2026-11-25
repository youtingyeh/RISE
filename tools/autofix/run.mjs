import { spawnSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { repairStore } from './store-supabase.mjs';
import { runCase } from './runner.mjs';
import { deterministicLinkProposer } from './proposers.mjs';

const mode = process.argv[2];
const repoDir = process.cwd();
const outputDir = process.env.RISE_REPAIR_OUTPUT;
const handoff = process.env.RISE_REPAIR_HANDOFF;
const store = repairStore({
  url: process.env.RISE_SUPABASE_URL || 'https://pgksyiqvicvapcmrhhhs.supabase.co',
  oidcUrl: process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
  oidcToken: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
});

async function candidates() {
  try {
    return await store.candidates();
  } catch (error) {
    if (error.status !== 404) throw error;
    console.log('修正排程函式尚未部署，略過。');
    return [];
  }
}

async function flag(name, value) {
  await appendFile(process.env.GITHUB_OUTPUT, name + '=' + value + '\n');
}

if (mode === 'preflight') {
  await flag('pending', (await candidates()).length > 0);
} else if (mode === 'scan') {
  if (!handoff || !outputDir) throw Error('缺少修補產物目錄。');
  const deliveries = [];
  for (const candidate of await candidates()) {
    const id = candidate.feedback_id;
    try {
      const result = await runCase({ store, repoDir, c: candidate, proposer: deterministicLinkProposer });
      if (result.outcome !== 'fix_ready' || !await store.check(id)) continue;
      const diff = spawnSync('git', ['diff', '--no-ext-diff', 'HEAD', result.commit, '--', candidate.page], {
        cwd: repoDir, encoding: 'utf8',
      });
      if (diff.status !== 0 || !diff.stdout) throw Error('無法匯出已驗證的差異。');
      deliveries.push({ candidate, branch: result.branch, commit: result.commit, patch: diff.stdout });
    } catch (error) {
      if (error.status !== 409) throw error;
    }
  }

  const ready = [];
  for (const delivery of deliveries) {
    const { candidate, branch, commit, patch } = delivery;
    if (!await store.check(candidate.feedback_id)) continue;
    await mkdir(outputDir, { recursive: true });
    const filename = 'fix-' + String(ready.length + 1).padStart(2, '0') + '.patch';
    await writeFile(join(outputDir, filename), patch);
    ready.push({ candidate, branch, commit, filename });
  }
  await writeFile(handoff, JSON.stringify(ready), { mode: 0o600 });
  await flag('ready', ready.length > 0);
  console.log('已驗證的修補差異檔數量 ' + ready.length);
} else if (mode === 'record') {
  const runId = process.env.GITHUB_RUN_ID;
  if (!/^\d+$/.test(runId ?? '') || !handoff) throw Error('缺少 GitHub 執行紀錄。');
  const url = 'https://github.com/youtingyeh/RISE/actions/runs/' + runId;
  for (const { candidate, branch, commit, filename } of JSON.parse(await readFile(handoff, 'utf8'))) {
    store.attach(candidate);
    const id = candidate.feedback_id;
    try {
      if (await store.check(id)) await store.deliver(id, branch, commit, url, filename);
    } catch (error) {
      if (error.status !== 409) throw error;
    }
  }
} else {
  throw Error('用法：node tools/autofix/run.mjs preflight|scan|record');
}
