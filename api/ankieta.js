// Ankiety z głosowaniem dla Vercel. Dane w Upstash Redis, głos zapisywany atomowo skryptem Lua
// (nie da się zagłosować dwa razy nawet przy setkach głosów naraz).
// Trasy (patrz vercel.json): GET /api/ankieta, POST /api/ankieta/glos, POST /api/ankieta/admin/<akcja>
import crypto from 'node:crypto';
import { isIP } from 'node:net';
import { redis, redisPipeline, requireAdmin, method, fail, readConfig, safeEqual } from './_lib.js';

const PK = 'jeden:poll';
const bk = (id) => ({ ids: `jeden:p:${id}:ids`, ip: `jeden:p:${id}:ip`, tally: `jeden:p:${id}:tally`, log: `jeden:p:${id}:log` });
const sha = (salt, s) => crypto.createHash('sha256').update(salt + s).digest('hex').slice(0, 24);
const nkey = (n) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').toLowerCase().split(/\s+/).filter(Boolean).sort().join(' ');
const okName = (n) => n.length <= 60 && /^[\p{L}][\p{L}'’-]+(\s+[\p{L}][\p{L}'’-]+)+$/u.test(n);

const VOTE_LUA = `
local c,d,k = ARGV[1],ARGV[2],ARGV[3]
if c ~= '' and redis.call('SISMEMBER',KEYS[1],'c:'..c)==1 then return 1 end
if d ~= '' and redis.call('SISMEMBER',KEYS[1],'d:'..d)==1 then return 1 end
if tonumber(redis.call('HGET',KEYS[2],ARGV[4]) or '0') >= tonumber(ARGV[5]) then return 2 end
if redis.call('SISMEMBER',KEYS[1],'k:'..k)==1 then return 3 end
if c ~= '' then redis.call('SADD',KEYS[1],'c:'..c) end
if d ~= '' then redis.call('SADD',KEYS[1],'d:'..d) end
redis.call('SADD',KEYS[1],'k:'..k)
redis.call('HINCRBY',KEYS[2],ARGV[4],1)
redis.call('HINCRBY',KEYS[3],ARGV[6],1)
redis.call('RPUSH',KEYS[4],ARGV[7])
return 0`;

const VOTED_LUA = `
local v = 0
if ARGV[1] ~= '' and redis.call('SISMEMBER',KEYS[1],'c:'..ARGV[1])==1 then v = 1 end
if ARGV[2] ~= '' and redis.call('SISMEMBER',KEYS[1],'d:'..ARGV[2])==1 then v = 1 end
if tonumber(redis.call('HGET',KEYS[2],ARGV[3]) or '0') >= tonumber(ARGV[4]) then v = 1 end
return {v, redis.call('LLEN',KEYS[3])}`;

const rawIp = (req) => (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '')
  .replace(/^::ffff:/, '').split('%')[0];

function ipOf(req) { // IPv6 liczone po /64, żeby nie dało się obejść zmianą końcówki
  let a = rawIp(req);
  if (a.includes(':')) {
    const [x, y] = a.split('::'), H = x ? x.split(':') : [], T = y ? y.split(':') : [];
    const f = y === undefined ? H : H.concat(Array(Math.max(0, 8 - H.length - T.length)).fill('0'), T);
    a = f.slice(0, 4).map((v) => v.padStart(4, '0')).join(':');
  }
  return a;
}
function who(req, res, salt, device) {
  const m = /(?:^|;\s*)jvid=([a-f0-9]{16,})/.exec(req.headers.cookie || '');
  let c = m ? m[1] : '';
  if (!c) {
    c = crypto.randomBytes(12).toString('hex');
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `jvid=${c}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${secure}`);
  }
  return { c, d: String(device || '').replace(/[^a-z0-9]/gi, '').slice(0, 64), i: sha(salt, ipOf(req)) };
}
// Anty-VPN: proxycheck.io (darmowy klucz = 1000 zapytań/dzień). Wynik na IP jest cache'owany 24 h w Redisie.
// Gdy brak klucza, awaria lub limit API – NIE blokujemy (lepiej przepuścić niż odrzucić prawdziwego widza).
async function isVpn(ip) {
  const key = process.env.PROXYCHECK_KEY;
  if (!key || !isIP(ip)) return false;
  const ck = 'jeden:vpn:' + sha('vpn', ip);
  try {
    const cached = await redis(['GET', ck]);
    if (cached === '1' || cached === '0') return cached === '1';
    const r = await fetch(`https://proxycheck.io/v3/${ip}?key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(2500) });
    const j = await r.json();
    const info = j[ip] || Object.values(j).find((v) => v && typeof v === 'object' && v.detections);
    const d = info && info.detections;
    if (!d) return false;
    const bad = !!(d.vpn || d.proxy || d.tor || d.hosting);
    await redis(['SET', ck, bad ? '1' : '0', 'EX', 86400]);
    return bad;
  } catch { return false; }
}
async function getPoll() { const raw = await redis(['GET', PK]); return raw ? JSON.parse(raw) : null; }
async function tallyOf(p) {
  const flat = (await redis(['HGETALL', bk(p.id).tally])) || [];
  return countsToResults(p, flat);
}
function countsToResults(p, flat) {
  const n = {};
  if (Array.isArray(flat)) for (let i = 0; i < flat.length; i += 2) n[flat[i]] = Number(flat[i + 1]);
  else Object.assign(n, flat);
  return p.options.map((o) => ({ id: o.id, text: o.text, n: Number(n[o.id]) || 0 }));
}
const wipe = (id) => { const k = bk(id); return [['DEL', k.ids], ['DEL', k.ip], ['DEL', k.tally], ['DEL', k.log]]; };

async function pub(req, res) {
  const p = await getPoll();
  if (!p || p.status === 'draft') return res.status(200).json({ status: p ? 'draft' : 'none' });
  const k = bk(p.id), m = who(req, res, p.salt, req.query?.d);
  const [v, total] = await redis(['EVAL', VOTED_LUA, 3, k.ids, k.ip, k.log, m.c, m.d, m.i, p.ipLimit]);
  const r = { status: p.status, id: p.id, title: p.title, options: p.options, voted: v === 1, total };
  if (p.status === 'closed' && p.pub) r.results = await tallyOf(p);
  res.status(200).json(r);
}

async function vote(req, res) {
  const p = await getPoll();
  if (!p || p.status !== 'open') return res.status(409).json({ err: 'Głosowanie jest zamknięte.' });
  const b = req.body || {}, m = who(req, res, p.salt, b.d);
  const rl = `jeden:rl:${m.i}`;
  const [n] = await redisPipeline([['INCR', rl], ['EXPIRE', rl, 60, 'NX']]);
  if (n > 15) return res.status(429).json({ err: 'Zbyt wiele prób. Odczekaj chwilę.' });
  const name = String(b.name || '').trim().replace(/\s+/g, ' ');
  if (!okName(name)) return res.status(400).json({ err: 'Wpisz imię i nazwisko (same litery).' });
  if (!p.options.some((o) => o.id === b.option)) return res.status(400).json({ err: 'Wybierz odpowiedź.' });
  if (p.noVpn && (await isVpn(rawIp(req)))) return res.status(403).json({ err: 'Wykryto VPN lub proxy. Wyłącz je i spróbuj ponownie.' });
  const k = bk(p.id);
  const code = await redis(['EVAL', VOTE_LUA, 4, k.ids, k.ip, k.tally, k.log,
    m.c, m.d, nkey(name), m.i, p.ipLimit, b.option, JSON.stringify({ n: name, o: b.option, t: Date.now() })]);
  const err = { 1: 'Z tej przeglądarki oddano już głos.', 2: 'Z tego połączenia internetowego oddano już głos.', 3: 'Osoba o tym imieniu i nazwisku już głosowała.' }[code];
  if (err) return res.status(409).json({ err });
  res.status(200).json({ ok: 1 });
}

async function admin(req, res, act) {
  if (!requireAdmin(req, res)) return;
  const p = await getPoll();
  if (act === 'get') {
    if (!p) return res.status(200).json({ poll: null });
    const k = bk(p.id);
    const [flat, log, total] = await redisPipeline([['HGETALL', k.tally], ['LRANGE', k.log, -300, -1], ['LLEN', k.log]]);
    const votes = (log || []).map((x) => JSON.parse(x)).reverse();
    return res.status(200).json({ poll: { id: p.id, title: p.title, status: p.status, pub: p.pub, ipLimit: p.ipLimit, live: !!p.live, noVpn: !!p.noVpn, vpnReady: !!process.env.PROXYCHECK_KEY, results: countsToResults(p, flat), votes, total } });
  }
  if (act === 'create') {
    const b = req.body || {};
    const title = String(b.title || '').trim().slice(0, 150), seen = new Set(), opts = [];
    for (const x of Array.isArray(b.options) ? b.options : []) {
      const t = String(x).trim().slice(0, 100);
      if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); opts.push(t); }
    }
    if (!title || opts.length < 2 || opts.length > 20) return res.status(400).json({ err: 'Podaj tytuł i od 2 do 20 różnych odpowiedzi.' });
    const np = { id: Date.now().toString(36), salt: crypto.randomBytes(16).toString('hex'), title,
      options: opts.map((t, i) => ({ id: 'o' + i, text: t })), status: 'draft', pub: !!b.pub, noVpn: !!b.noVpn,
      ipLimit: Math.max(1, Math.min(50, +b.ipLimit || 1)) };
    await redisPipeline([...(p ? wipe(p.id) : []), ['SET', PK, JSON.stringify(np)]]);
    return res.status(200).json({ ok: 1 });
  }
  if (!p) return res.status(409).json({ err: 'Brak ankiety.' });
  if (act === 'open' || act === 'close') { p.status = act === 'open' ? 'open' : 'closed'; await redis(['SET', PK, JSON.stringify(p)]); }
  else if (act === 'live') { p.live = !!(req.body || {}).visible; await redis(['SET', PK, JSON.stringify(p)]); }
  else if (act === 'reset') await redisPipeline(wipe(p.id));
  else if (act === 'delete') await redisPipeline([...wipe(p.id), ['DEL', PK]]);
  res.status(200).json({ ok: 1 });
}

// Dane dla wykresu kołowego na transmisji (overlay) – chronione tym samym kluczem co overlay (?key=)
async function live(req, res) {
  const key = typeof req.query?.key === 'string' ? req.query.key : '';
  const cfg = await readConfig();
  if (!key || !safeEqual(key, cfg.overlayKey)) return res.status(404).end();
  const p = await getPoll();
  if (!p || !p.live || p.status === 'draft') return res.status(200).json({ show: false });
  const rows = await tallyOf(p);
  res.status(200).json({ show: true, title: p.title, status: p.status, total: rows.reduce((s, x) => s + x.n, 0), rows: rows.map((x) => ({ name: x.text, n: x.n })) });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!process.env.UPSTASH_REDIS_REST_URL && !process.env.KV_REST_API_URL)
      return res.status(503).json({ err: 'Brak bazy danych: w Vercel → Storage podłącz Upstash Redis i zrób Redeploy.' });
    const a = req.query?.a || '';
    if (a === 'live') { if (!method(req, res, 'GET')) return; return await live(req, res); }
    if (!a) { if (!method(req, res, 'GET')) return; return await pub(req, res); }
    if (!method(req, res, 'POST')) return;
    if (a === 'glos') return await vote(req, res);
    const act = String(req.query?.act || '');
    if (a === 'admin' && ['get', 'create', 'open', 'close', 'reset', 'delete', 'live'].includes(act)) return await admin(req, res, act);
    res.status(404).json({ err: 'Nie znaleziono.' });
  } catch (e) { console.error(e); fail(res, e); }
}