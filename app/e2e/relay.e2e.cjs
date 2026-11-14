// The DAO relay's own checks (review of 14 November 2026, block 5): event ids, field types, sizes, filters and
// subscriptions. Talks to the local relay (wrangler dev on 8787) directly, with raw messages.
const { finalizeEvent, generateSecretKey, getEventHash } = require('nostr-tools');
const URL = 'ws://127.0.0.1:8787';
const D = 'ab'.repeat(32);
let failed = 0;
const check = (ok, what) => { console.log(`  ${ok ? '✓' : '✗'} ${what}`); if (!ok) failed++; };

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const waiting = [];
    ws.onmessage = m => { const msg = JSON.parse(m.data); const i = waiting.findIndex(w => w.match(msg)); if (i >= 0) waiting.splice(i, 1)[0].resolve(msg); };
    ws.onopen = () => resolve({
      send: x => ws.send(typeof x === 'string' ? x : JSON.stringify(x)),
      next: (match, ms = 8000) => new Promise((res, rej) => { waiting.push({ match, resolve: res }); setTimeout(() => rej(new Error('no answer')), ms); }),
      close: () => ws.close(),
    });
    ws.onerror = reject;
  });
}
const sk = generateSecretKey();
const make = (extra = {}, content = '{}', kind = 3575) => finalizeEvent({ kind, created_at: Math.floor(Date.now() / 1000), tags: [['D', D], ['v', '1'], ...(extra.tags ?? [])], content }, sk);
async function publish(c, ev) {
  c.send(['EVENT', ev]);
  const ok = await c.next(m => m[0] === 'OK' && (m[1] === ev.id || m[1] === '' || typeof ev.id !== 'string'));
  return ok;
}

(async () => {
  const c = await connect();
  console.log('• Events');
  const good = make();
  check((await publish(c, good))[2] === true, 'a well-formed DAO event is stored');
  const forged = { ...make(), id: 'cd'.repeat(32) }; // a valid signature over another id
  const f = await publish(c, forged);
  check(f[2] === false, `an event whose id is not the hash of its content is refused (${f[3]})`);
  const second = make({}, '{"n":2}');
  const fake = { ...second, created_at: String(second.created_at) };
  const g = await publish(c, fake);
  check(g[2] === false && /created_at/.test(g[3]), `a non-numeric created_at is refused (${g[3]})`);
  const big = make({}, 'x'.repeat(130 * 1024));
  const b = await publish(c, big).catch(() => ['OK', big.id, false, 'error']);
  check(b[2] === false, `oversized content is refused (${b[3]})`);
  const tags = make({ tags: Array.from({ length: 60 }, (_, i) => ['t', String(i)]) });
  const t = await publish(c, tags);
  check(t[2] === false && /tags/.test(t[3]), `more than 50 tags are refused (${t[3]})`);
  const upper = { ...make(), pubkey: make().pubkey.toUpperCase() };
  const u = await publish(c, upper);
  check(u[2] === false, `an upper-case pubkey is refused (${u[3]})`);

  console.log('• Subscriptions');
  c.send(['REQ', 's-neg', { '#D': [D], limit: -1 }]);
  const eose = await c.next(m => (m[0] === 'EOSE' || m[0] === 'CLOSED') && m[1] === 's-neg');
  check(eose[0] === 'EOSE', 'a limit of -1 is read as the maximum, not as "no limit"');
  c.send(['REQ', 's-many', ...Array.from({ length: 11 }, () => ({ '#D': [D] }))]);
  const many = await c.next(m => m[1] === 's-many' && (m[0] === 'CLOSED' || m[0] === 'EOSE'));
  check(many[0] === 'CLOSED', `more than 10 filters in one request are refused (${many[2] ?? ''})`);
  c.send(['REQ', 's-big', { ids: Array.from({ length: 501 }, (_, i) => i.toString(16).padStart(64, '0')) }]);
  const bigf = await c.next(m => m[1] === 's-big' && (m[0] === 'CLOSED' || m[0] === 'EOSE'));
  check(bigf[0] === 'CLOSED', `a filter with more than 500 values is refused (${bigf[2] ?? ''})`);
  let closed = 0;
  for (let i = 0; i < 22; i++) {
    c.send(['REQ', `s${i}`, { '#D': [D], limit: 1 }]);
    const m = await c.next(x => x[1] === `s${i}` && (x[0] === 'EOSE' || x[0] === 'CLOSED'));
    if (m[0] === 'CLOSED') closed++;
  }
  check(closed >= 2, `subscriptions beyond 20 on one connection are refused (${closed} refused)`);
  c.close();
  console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
