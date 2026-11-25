import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6.2.2';

const issuer = 'https://token.actions.githubusercontent.com';
const audience = 'urn:rise:feedback-repair:1365321015';
const workflow = 'youtingyeh/RISE/.github/workflows/autofix-scan.yml@refs/heads/main';
const keys = createRemoteJWKSet(new URL(issuer + '/.well-known/jwks'));
const actions = new Set(['candidates', 'check', 'begin', 'log', 'finish', 'deliver']);

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  const value = req.headers.get('Authorization') ?? '';
  const token = value.startsWith('Bearer ') ? value.slice(7) : '';
  if (!token || token.length > 8000) return reply({ error: 'workflow_required' }, 401);
  let runId: string;
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer, audience, algorithms: ['RS256'], requiredClaims: ['iat', 'exp', 'sub'],
      maxTokenAge: '5m',
    });
    if (payload.repository_id !== '1365321015' || payload.repository !== 'youtingyeh/RISE' ||
        payload.workflow_ref !== workflow || payload.ref !== 'refs/heads/main' ||
        !['schedule', 'workflow_dispatch'].includes(String(payload.event_name))) {
      return reply({ error: 'workflow_forbidden' }, 403);
    }
    runId = String(payload.run_id);
    if (!/^\d+$/.test(runId)) return reply({ error: 'workflow_forbidden' }, 403);
  } catch {
    return reply({ error: 'workflow_required' }, 401);
  }

  let body;
  try {
    const raw = await req.text();
    if (raw.length > 32000) return reply({ error: 'request_too_large' }, 413);
    body = JSON.parse(raw);
  } catch {
    return reply({ error: 'invalid_request' }, 400);
  }
  if (!actions.has(body?.action) || (body.payload != null &&
      (typeof body.payload !== 'object' || Array.isArray(body.payload)))) {
    return reply({ error: 'invalid_request' }, 400);
  }
  if (body.action === 'deliver' &&
      body.payload?.url !== 'https://github.com/youtingyeh/RISE/actions/runs/' + runId) {
    return reply({ error: 'workflow_forbidden' }, 403);
  }
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return reply({ error: 'not_ready' }, 503);
  try {
    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.rpc('rise_feedback_repair_worker', {
      p_action: body.action, p_payload: body.payload ?? {},
    });
    if (error) {
      if (['42501', 'P0001'].includes(error.code)) return reply({ error: 'repair_not_authorized' }, 409);
      return reply({ error: 'not_ready' }, 503);
    }
    return reply({ data });
  } catch {
    return reply({ error: 'not_ready' }, 503);
  }
}

if (import.meta.main) Deno.serve(handler);
