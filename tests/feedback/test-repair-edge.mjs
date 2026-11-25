import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = await readFile(new URL('../../supabase/functions/rise-feedback-repair/index.ts', import.meta.url), 'utf8');
const script = stripTypeScriptTypes(source.replace(/^import .*\r?\n/gm, '')
  .replace('export async function handler', 'async function handler')
  .replace('if (import.meta.main) Deno.serve(handler);', ''));

const trusted = {
  repository_id: '1365321015', repository: 'youtingyeh/RISE',
  ref: 'refs/heads/main',
  workflow_ref: 'youtingyeh/RISE/.github/workflows/autofix-scan.yml@refs/heads/main',
  event_name: 'schedule', run_id: '12345',
};
let claims = { ...trusted };
let calls = 0;
const context = vm.createContext({
  Request, Response, URL,
  Deno: { env: { get: () => 'mock-config' } },
  createRemoteJWKSet: url => {
    assert.equal(url.hostname, 'token.actions.githubusercontent.com');
    return 'mock-jwks';
  },
  jwtVerify: async (token, keys, options) => {
    if (token !== 'signed') throw Error('invalid signature');
    assert.equal(keys, 'mock-jwks');
    assert.equal(options.audience, 'urn:rise:feedback-repair:1365321015');
    assert.equal(options.algorithms[0], 'RS256');
    assert.equal(options.issuer, 'https://token.actions.githubusercontent.com');
    return { payload: claims };
  },
  createClient: () => ({
    rpc: async (fn, parameters) => {
      calls++;
      assert.equal(fn, 'rise_feedback_repair_worker');
      return { data: parameters.p_action === 'candidates' ? [] : true };
    },
  }),
});
vm.runInContext(script, context);
const post = (action, payload, token = 'signed') => context.handler(new Request('https://example.org', {
  method: 'POST', headers: { Authorization: 'Bearer ' + token },
  body: JSON.stringify({ action, payload }),
}));

assert.equal((await post('candidates', {}, 'student-token')).status, 401);
for (const override of [
  { repository_id: '1' }, { repository: 'other/RISE' }, { ref: 'refs/heads/topic' },
  { workflow_ref: 'youtingyeh/RISE/.github/workflows/other.yml@refs/heads/main' },
  { event_name: 'pull_request' }, { run_id: '' },
]) {
  claims = { ...trusted, ...override };
  assert.equal((await post('candidates', {})).status, 403);
}
claims = { ...trusted };
assert.equal((await post('publish', {})).status, 400);
assert.equal((await post('deliver', { url: 'https://github.com/youtingyeh/RISE/actions/runs/987' })).status, 403);
assert.equal(calls, 0);
assert.deepEqual(await (await post('candidates', {})).json(), { data: [] });
assert.equal((await post('deliver', { url: 'https://github.com/youtingyeh/RISE/actions/runs/12345' })).status, 200);
assert.equal(calls, 2);
console.log('PASS repair broker: repository/workflow/ref/event checks, bounded RPC dispatch, and run-bound delivery');
