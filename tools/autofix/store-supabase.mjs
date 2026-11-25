const audience = 'urn:rise:feedback-repair:1365321015';

export function repairStore({ url, oidcUrl, oidcToken, fetchImpl = fetch }) {
  const endpoint = new URL('/functions/v1/rise-feedback-repair', url);
  if (endpoint.protocol !== 'https:' || !oidcUrl || !oidcToken) {
    throw Error('缺少 HTTPS Supabase 位址或 GitHub Actions OIDC 設定。');
  }
  let token, refreshAt = 0;
  const candidates = new Map();
  const attempts = new Map();

  async function request(action, payload = {}) {
    if (Date.now() >= refreshAt) {
      const target = new URL(oidcUrl);
      target.searchParams.set('audience', audience);
      const identity = await fetchImpl(target, {
        headers: { Authorization: 'Bearer ' + oidcToken },
        redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      if (!identity.ok) throw Error('無法取得 GitHub Actions 驗證。');
      token = (await identity.json()).value;
      if (typeof token !== 'string' || !token) throw Error('GitHub Actions 驗證回覆不完整。');
      refreshAt = Date.now() + 180000;
    }
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload }),
      redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      throw Object.assign(Error('修正排程後端回傳 HTTP ' + response.status + '。'), { status: response.status });
    }
    return (await response.json()).data;
  }

  function scope(id) {
    const candidate = candidates.get(id);
    if (!candidate?.authorization || !candidate?.epoch) throw Error('找不到有效的案件授權。');
    return { id, authorization: candidate.authorization, epoch: candidate.epoch };
  }

  return {
    attach: (candidate) => candidates.set(candidate.feedback_id, candidate),
    async candidates() {
      const rows = await request('candidates');
      if (!Array.isArray(rows)) throw Error('修正排程後端回覆不完整。');
      for (const row of rows) candidates.set(row.feedback_id, row);
      return rows;
    },
    check: (id) => request('check', { ...scope(id), attempt: attempts.get(id) ?? 0 }),
    async begin(id, branch) {
      const attempt = await request('begin', { ...scope(id), branch });
      if (![1, 2].includes(attempt)) throw Error('修補次數回覆不符。');
      attempts.set(id, attempt);
      return attempt;
    },
    log: (id, attempt, phase, result) => request('log', { ...scope(id), attempt, phase, result }),
    finish: (id, outcome, payload) => request('finish', {
      ...scope(id), attempt: attempts.get(id) ?? 0, outcome, payload,
    }),
    deliver: (id, branch, commit, url, filename) => request('deliver', { ...scope(id), branch, commit, url, filename }),
  };
}
