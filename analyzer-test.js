// Usage: node analyzer-test.js <path-to-compiled-analyzer.js>
// Compile first:  tsc ai-document-analyzer.ts (with the jsr import line removed) -> .js
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(process.argv[2] || 'd.js', 'utf8');
let counter = 0;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();

function sbMock(db, o) {
  function from(table) {
    const st = { filters: [], order: null, limit: null, patch: null, op: 'select', row: null };
    const m = (r) => st.filters.every(f => f(r));
    const api = {
      select() { return api; },
      eq(c, v) { st.filters.push(r => r[c] === v); return api; },
      lt(c, v) { st.filters.push(r => new Date(r[c]).getTime() < new Date(v).getTime()); return api; },
      order(c, opt) { st.order = [c, !(opt && opt.ascending === false)]; return api; },
      limit(n) { st.limit = n; return api; },
      update(p) { st.op = 'update'; st.patch = p; return api; },
      insert(row) { st.op = 'insert'; st.row = row; return api; },
      single() { return exec().then(r => ({ data: r.data[0], error: null })); },
      maybeSingle() { return exec().then(r => ({ data: r.data[0] ?? null, error: null })); },
      then(res, rej) { return exec().then(res, rej); },
    };
    function exec() { return Promise.resolve().then(() => {
      const rows = db[table] ?? (db[table] = []);
      if (st.op === 'insert') { const r = { id: 'row' + (++counter), created_at: iso(), updated_at: iso(), ...st.row }; rows.push(r); return { data: [r], error: null }; }
      if (st.op === 'update') { const hit = rows.filter(m); hit.forEach(r => Object.assign(r, st.patch)); return { data: hit, error: null }; }
      let out = rows.filter(m);
      if (st.order) { const [c, asc] = st.order; out = out.slice().sort((a, b) => (new Date(a[c]) - new Date(b[c])) * (asc ? 1 : -1)); }
      if (st.limit) out = out.slice(0, st.limit);
      return { data: out, error: null };
    }); }
    return api;
  }
  return { from, rpc: async (fn, args) => { db.notifications.push(args); return {}; },
    storage: { from: () => ({ download: async () => { if (o.downloadThrows) throw new Error('storage exploded'); return { data: { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }, error: null }; } }) } };
}
const okResp = (obj, finish = 'STOP') => ({ ok: true, status: 200, text: async () => '', json: async () => ({ candidates: [{ finishReason: finish, content: { parts: [{ text: JSON.stringify(obj) }] } }] }) });
const rawResp = (text, finish) => ({ ok: true, status: 200, text: async () => '', json: async () => ({ candidates: [{ finishReason: finish, content: { parts: text === null ? [] : [{ text }] } }] }) });
const errResp = (status, body = 'overloaded') => ({ ok: false, status, text: async () => body, json: async () => ({}) });
const GOOD = { document_type: 'PAN', classification_confidence: 0.95, expiry_status: 'not_applicable', quality_issues: [], summary: 'A PAN card.', extracted_data: { name: 'Sachin Kale', document_number: 'ABCDE1234F' } };

async function run(name, o = {}) {
  const db = { ai_document_insights: o.insights ?? [], lead_documents: [{ id: 'doc1', lead_id: 1, storage_path: 'p', mime_type: o.mime ?? 'image/jpeg', file_name: 'x.jpg' }],
    leads: [{ id: 1, loan_type: o.loanType ?? 'Personal Loan', borrower: o.borrower ?? { name: 'Sachin Kale', income: 150000 } }], ai_risk_alerts: [], ai_skill_logs: [], notifications: [] };
  const env = { SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 's', AI_SKILLS_NOTIFY_SECRET: 'sec', GEMINI_API_KEY: o.noKey ? undefined : 'k', GEMINI_MODEL: 'primary-m',
    GEMINI_TIMEOUT_MS: String(o.timeoutMs ?? 60), GEMINI_BACKOFF_MS: '1', GEMINI_MAX_ATTEMPTS: String(o.attempts ?? 3), GEMINI_FALLBACK_MODEL: o.fallback ?? '' };
  if (o.noModelEnv) { delete env.GEMINI_MODEL; delete env.GEMINI_FALLBACK_MODEL; }
  if (o.visionModel) env.GEMINI_VISION_MODEL = o.visionModel;
  const calls = []; let handler; const pending = []; let geminiFinishedAt = null;
  const plan = o.plan ?? (() => ({ r: okResp(GOOD) }));
  const fetchMock = (url, opts) => { calls.push(url); const b = plan(calls.length - 1, url);
    return new Promise((resolve, reject) => { const sig = opts && opts.signal;
      if (sig) sig.addEventListener('abort', () => reject(sig.reason));
      if (b.hang) return;
      setTimeout(() => { geminiFinishedAt = Date.now(); resolve(b.r); }, b.delay || 0); }); };
  const ctx = { Deno: { env: { get: k => env[k] }, serve: h => { handler = h; } }, createClient: () => sbMock(db, o), fetch: fetchMock, Response, console: { log(){}, error(){} },
    Date, Math, JSON, Promise, Uint8Array, String, Array, Number, Object, RegExp, Set, setTimeout, clearTimeout, AbortSignal, btoa: s => Buffer.from(s, 'binary').toString('base64') };
  if (!o.noWaitUntil) ctx.EdgeRuntime = { waitUntil: (p) => pending.push(p) };
  vm.createContext(ctx); vm.runInContext(src, ctx);
  const t0 = Date.now();
  const res = await handler({ method: 'POST', headers: { get: () => o.secret ?? 'sec' }, json: async () => o.body ?? { document_id: 'doc1', lead_id: 1 } });
  const handlerReturnedAt = Date.now();
  const text = await res.text();
  await Promise.all(pending);
  const rows = db.ai_document_insights; const last = rows[rows.length - 1];
  return { status: res.status, text, rows, last, db, calls, handlerMs: handlerReturnedAt - t0, totalMs: Date.now() - t0, geminiFinishedAt, handlerReturnedAt, logs: db.ai_skill_logs };
}
let pass = 0, fail = 0;
const check = (n, c, x = '') => { console.log((c ? 'OK  ' : 'FAIL'), n, x); c ? pass++ : fail++; };

(async () => {
  // Node's AbortSignal.timeout timer is unref'd; keep the loop alive so a mocked hung call can't exit the process.
  const keepAlive = setInterval(() => {}, 50);
  console.log('=== A. the trigger gets an answer BEFORE Gemini finishes (pg_net only waits 5s) ===');
  let r = await run('slow gemini', { timeoutMs: 5000, plan: () => ({ r: okResp(GOOD), delay: 300 }) });
  check('handler returned 202 immediately', r.status === 202, `HTTP ${r.status}, handler took ${r.handlerMs}ms`);
  check('...before Gemini responded', r.handlerReturnedAt < r.geminiFinishedAt, `returned ${r.geminiFinishedAt - r.handlerReturnedAt}ms earlier`);
  check('background work still completed the row', r.last.verification_status === 'COMPLETED', r.last.verification_status);

  console.log('\n=== B. the exact production failure: Gemini hangs forever ===');
  r = await run('hang', { attempts: 2, plan: () => ({ hang: true }) });
  check('row ends FAILED (never stuck in PROCESSING)', r.last.verification_status === 'FAILED', r.last.verification_status);
  check('real reason recorded: timeout', /timeout after/.test(r.last.ai_summary), r.last.ai_summary.slice(0, 70));
  check('retried before giving up (2 attempts)', r.calls.length === 2, `${r.calls.length} calls`);
  check('finished quickly instead of hanging ~90s', r.totalMs < 1500, `${r.totalMs}ms`);
  check('skill log carries the reason', r.logs.some(l => l.status === 'FAILED' && /timeout/.test(l.error)));

  console.log('\n=== C. retries & recovery ===');
  r = await run('503 then ok', { plan: (i) => i === 0 ? { r: errResp(503) } : { r: okResp(GOOD) } });
  check('503 then success -> done', r.last.verification_status !== 'FAILED' && r.calls.length === 2, `${r.last.verification_status}, ${r.calls.length} calls`);
  check('log shows attempts=2', r.logs.some(l => /attempts=2/.test(l.input_summary)));
  r = await run('503 x3', { plan: () => ({ r: errResp(503, 'This model is currently experiencing high demand') }) });
  check('persistent 503 -> FAILED with HTTP 503 in reason', r.last.verification_status === 'FAILED' && /HTTP 503/.test(r.last.ai_summary) && r.calls.length === 3, r.last.ai_summary.slice(0, 90));
  r = await run('400', { plan: () => ({ r: errResp(400, 'Invalid argument') }) });
  check('400 is NOT retried (bad request will never succeed)', r.calls.length === 1 && /HTTP 400/.test(r.last.ai_summary), `${r.calls.length} call`);
  r = await run('429', { plan: (i) => i < 2 ? { r: errResp(429, 'quota') } : { r: okResp(GOOD) } });
  check('429 rate-limit is retried then succeeds', r.calls.length === 3 && r.last.verification_status !== 'FAILED');
  r = await run('truncated', { plan: () => ({ r: rawResp(null, 'MAX_TOKENS') }) });
  check('empty/truncated output reports finishReason', /finishReason=MAX_TOKENS/.test(r.last.ai_summary), r.last.ai_summary.slice(0, 100));
  r = await run('bad json', { plan: () => ({ r: rawResp('{"document_type": "PAN", "extracted_da', 'MAX_TOKENS') }) });
  check('cut-off JSON reports invalid JSON + finishReason', /invalid JSON/.test(r.last.ai_summary) && /MAX_TOKENS/.test(r.last.ai_summary), r.last.ai_summary.slice(0, 100));
  r = await run('fenced json', { plan: () => ({ r: rawResp('```json\n' + JSON.stringify(GOOD) + '\n```', 'STOP') }) });
  check('markdown-fenced JSON still parses', r.last.verification_status !== 'FAILED');
  r = await run('fallback model', { fallback: 'fallback-m', plan: (i) => i < 1 ? { r: errResp(503) } : { r: okResp(GOOD) } });
  check('2nd attempt switches to the fallback model', /primary-m/.test(r.calls[0]) && /fallback-m/.test(r.calls[1]) && r.last.verification_status !== 'FAILED', r.calls.map(u => u.match(/models\/([^:]+)/)[1]).join(' -> '));
  check('...and the log records which model answered', r.logs.some(l => /model=fallback-m/.test(l.input_summary)));
  r = await run('hang then fallback rescues', { fallback: 'fallback-m', plan: (i) => i === 0 ? { hang: true } : { r: okResp(GOOD) } });
  check('hung primary is rescued by the fallback (the real production failure)', r.last.verification_status !== 'FAILED' && /fallback-m/.test(r.calls[1]), r.last.verification_status);
  r = await run('defaults, no env', { noModelEnv: true, plan: (i) => i < 1 ? { r: errResp(503) } : { r: okResp(GOOD) } });
  check('NO model env set (your production state): primary is gemini-3.5-flash-lite', /models\/gemini-3\.5-flash-lite:/.test(r.calls[0]), r.calls[0].match(/models\/([^:]+)/)[1]);
  check('...and it never touches the hanging gemini-3.8-flash', !r.calls.some(u => /3\.8/.test(u)));
  check('...fallback default is gemini-3.6-flash', /models\/gemini-3\.6-flash:/.test(r.calls[1]), r.calls[1].match(/models\/([^:]+)/)[1]);
  r = await run('vision model override', { visionModel: 'vision-m' });
  check('GEMINI_VISION_MODEL overrides the vision model independently', /vision-m/.test(r.calls[0]), r.calls[0].match(/models\/([^:]+)/)[1]);

  console.log('\n=== D. idempotency & stuck rows ===');
  const seed = (status, minAgo, doc = 'doc1', id = 'old1') => ({ id, lead_id: 1, document_id: doc, verification_status: status, created_at: iso(minAgo * 60000), updated_at: iso(minAgo * 60000), ai_summary: 'x' });
  r = await run('already completed', { insights: [seed('COMPLETED', 60)] });
  check('already-analysed doc: no Gemini call, no duplicate row', r.calls.length === 0 && r.rows.length === 1, `${r.calls.length} calls, ${r.rows.length} rows, "${r.text}"`);
  r = await run('review required', { insights: [seed('REVIEW_REQUIRED', 60)] });
  check('REVIEW_REQUIRED also not redone', r.calls.length === 0 && r.rows.length === 1);
  r = await run('in progress 1 min', { insights: [seed('PROCESSING', 1)] });
  check('genuinely in-flight (1 min old): left alone', r.calls.length === 0 && r.rows.length === 1, r.text);
  r = await run('stuck 30 min', { insights: [seed('PROCESSING', 30)] });
  check('stuck 30 min: reprocessed on the SAME row, not duplicated', r.rows.length === 1 && r.rows[0].id === 'old1' && r.calls.length === 1 && r.rows[0].verification_status !== 'PROCESSING', `${r.rows.length} row, ${r.rows[0].verification_status}`);
  r = await run('failed retry', { insights: [seed('FAILED', 60)] });
  check('FAILED row retried in place (no duplicate)', r.rows.length === 1 && r.rows[0].verification_status !== 'FAILED' && r.calls.length === 1, `${r.rows.length} row -> ${r.rows[0].verification_status}`);
  r = await run('sweeper', { insights: [seed('PROCESSING', 45, 'otherDoc', 'stale9'), seed('PROCESSING', 2, 'youngDoc', 'young9')] });
  const stale = r.rows.find(x => x.id === 'stale9'), young = r.rows.find(x => x.id === 'young9');
  check('sweeper fails other documents stuck >10 min', stale.verification_status === 'FAILED' && /timed out/.test(stale.ai_summary), stale.verification_status);
  check('sweeper leaves a 2-min-old PROCESSING row alone', young.verification_status === 'PROCESSING');

  console.log('\n=== E. everything that worked before still works ===');
  r = await run('aadhaar masking', { plan: () => ({ r: okResp({ ...GOOD, document_type: 'Aadhaar', extracted_data: { name: 'Sachin Kale', document_number: '1234 5678 9012', address: 'UID 9876 5432 1098 Thane' } }) }) });
  const ed = JSON.stringify(r.last.extracted_data);
  check('Aadhaar masked to last 4 everywhere', /XXXX XXXX 9012/.test(ed) && !/1234 5678/.test(ed) && !/9876 5432/.test(ed), ed.slice(0, 90));
  r = await run('income mismatch', { plan: () => ({ r: okResp({ ...GOOD, document_type: 'Salary Slip', extracted_data: { name: 'Sachin Kale', monthly_income: 95000 } }) }) });
  check('income mismatch -> HIGH alert + credit notified', r.db.ai_risk_alerts.some(a => a.severity === 'HIGH' && a.risk_type === 'income_mismatch') && r.db.notifications.length === 1);
  r = await run('name mismatch', { plan: () => ({ r: okResp({ ...GOOD, extracted_data: { name: 'Ramesh Patil' } }) }) });
  check('name mismatch -> MEDIUM alert', r.db.ai_risk_alerts.some(a => a.severity === 'MEDIUM' && a.risk_type === 'name_mismatch'));
  r = await run('business turnover', { loanType: 'Business Loan', borrower: { name: 'Sachin Kale', income: 5000000 }, plan: () => ({ r: okResp({ ...GOOD, document_type: 'Salary Slip', extracted_data: { name: 'Sachin Kale', monthly_income: 95000 } }) }) });
  check('Business Loan turnover not compared to salary (no false alert)', r.db.ai_risk_alerts.length === 0);
  r = await run('video', { mime: 'video/mp4' });
  check('video skipped, no Gemini call, REVIEW_REQUIRED', r.calls.length === 0 && r.last.verification_status === 'REVIEW_REQUIRED');

  console.log('\n=== F. robustness ===');
  r = await run('crash', { downloadThrows: true });
  check('unexpected crash -> FAILED, never left PROCESSING', r.last.verification_status === 'FAILED' && /unexpected error|storage exploded/.test(r.last.ai_summary), r.last.ai_summary.slice(0, 80));
  r = await run('no key', { noKey: true });
  check('no GEMINI_API_KEY -> FAILED with clear reason, no fetch', r.last.verification_status === 'FAILED' && r.calls.length === 0 && /GEMINI_API_KEY/.test(r.last.ai_summary));
  r = await run('no waitUntil', { noWaitUntil: true });
  check('runtime without waitUntil: still completes inline', r.status === 200 && r.last.verification_status !== 'PROCESSING', `HTTP ${r.status} ${r.last.verification_status}`);
  r = await run('bad secret', { secret: 'nope' });
  check('wrong secret -> 403, nothing written', r.status === 403 && r.rows.length === 0);
  r = await run('bad body', { body: { lead_id: 1 } });
  check('missing document_id -> 400', r.status === 400);
  r = await run('unknown doc', { body: { document_id: 'ghost', lead_id: 1 } });
  check('unknown document -> 200 + logged, no crash', r.status === 200 && r.rows.length === 0 && r.logs.some(l => l.status === 'FAILED'));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  clearInterval(keepAlive);
  process.exit(fail ? 1 : 0);
})();
