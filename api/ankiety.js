// ankiety.js — ankiety z głosowaniem (Node 18+, bez zależności)
// Samodzielnie:  ANKIETA_KEY=twojeHaslo node ankiety.js     (PORT=3100)
// W swoim serwerze (Express):
//   const ankiety = require('./ankiety');
//   app.use(async (req, res, next) => { if (!await ankiety.handle(req, res)) next(); });
//   a w /api/state:  poll: ankiety.overlayPoll()   // format jak dotychczasowy sondaż na ekranie
// Strony: /glosuj (głosowanie)   /ankieta-admin (panel admina)
// Za proxy (nginx, Cloudflare): TRUST_PROXY=1, inaczej IP będzie IP proxy.
const http = require('http'), fs = require('fs'), crypto = require('crypto');
const FILE = process.env.ANKIETA_FILE || 'ankiety-data.json';
const KEY = process.env.ANKIETA_KEY || crypto.randomBytes(6).toString('hex');
const TRUST = process.env.TRUST_PROXY === '1';
let db = { salt: crypto.randomBytes(16).toString('hex'), poll: null };
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}
let st; const flush = () => { try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(db)); fs.renameSync(FILE + '.tmp', FILE); } catch (e) { console.error(e); } };
const save = () => { clearTimeout(st); st = setTimeout(flush, 300); };
process.on('exit', flush); process.on('SIGINT', () => process.exit());

const h = s => crypto.createHash('sha256').update(db.salt + s).digest('hex').slice(0, 24);
const J = (res, c, o) => { res.writeHead(c, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); return true; };
const page = (res, s) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(s); return true; };
const body = req => new Promise(r => { let d = ''; req.on('data', c => { d += c; if (d.length > 20000) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch (e) { r({}); } }); });
const auth = req => crypto.timingSafeEqual(Buffer.from(h(String(req.headers['x-key'] || ''))), Buffer.from(h(KEY)));
const nkey = n => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').toLowerCase().split(/\s+/).filter(Boolean).sort().join(' ');
const okName = n => n.length <= 60 && /^[\p{L}][\p{L}'’-]+(\s+[\p{L}][\p{L}'’-]+)+$/u.test(n);
const tally = p => p.options.map(o => ({ id: o.id, text: o.text, n: p.votes.filter(v => v.o === o.id).length }));

function ipKey(req) { // IPv6 liczone po /64, żeby nie dało się obejść zmianą końcówki
  let a = ((TRUST && req.headers['x-forwarded-for']) || '').split(',')[0].trim() || req.socket.remoteAddress || '';
  a = a.replace(/^::ffff:/, '').split('%')[0];
  if (a.includes(':')) { const [x, y] = a.split('::'), H = x ? x.split(':') : [], T = y ? y.split(':') : [];
    const f = y === undefined ? H : H.concat(Array(Math.max(0, 8 - H.length - T.length)).fill('0'), T);
    a = f.slice(0, 4).map(v => v.padStart(4, '0')).join(':'); }
  return h(a);
}
function cookieId(req, res) {
  const m = /(?:^|;\s*)jvid=([a-f0-9]{16,})/.exec(req.headers.cookie || ''); if (m) return m[1];
  if (!res) return '';
  const id = crypto.randomBytes(12).toString('hex');
  res.setHeader('Set-Cookie', 'jvid=' + id + '; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly'); return id;
}
const ids = (req, d) => ({ c: cookieId(req), d: String(d || '').slice(0, 64), i: ipKey(req) });
const rl = new Map(); const limited = k => { const n = Date.now(), a = (rl.get(k) || []).filter(x => n - x < 60000); a.push(n); rl.set(k, a); return a.length > 15; };

function pub(req, u) {
  const p = db.poll; if (!p) return { status: 'none' };
  const m = ids(req, u.searchParams.get('d'));
  const voted = p.votes.some(v => (m.c && v.c === m.c) || (m.d && v.d === m.d)) || p.votes.filter(v => v.i === m.i).length >= p.ipLimit;
  const r = { status: p.status, id: p.id, title: p.title, options: p.options, voted, total: p.votes.length };
  if (p.status === 'closed' && p.pub) r.results = tally(p);
  return r;
}
async function vote(req, res) {
  const b = await body(req), p = db.poll, m = ids(req, b.d);
  if (limited(m.i)) return J(res, 429, { err: 'Zbyt wiele prób. Odczekaj chwilę.' });
  if (!p || p.status !== 'open') return J(res, 409, { err: 'Głosowanie jest zamknięte.' });
  const name = String(b.name || '').trim().replace(/\s+/g, ' ');
  if (!okName(name)) return J(res, 400, { err: 'Wpisz imię i nazwisko (same litery).' });
  if (!p.options.some(o => o.id === b.option)) return J(res, 400, { err: 'Wybierz odpowiedź.' });
  const k = nkey(name);
  if (p.votes.some(v => (m.c && v.c === m.c) || (m.d && v.d === m.d))) return J(res, 409, { err: 'Z tej przeglądarki oddano już głos.' });
  if (p.votes.filter(v => v.i === m.i).length >= p.ipLimit) return J(res, 409, { err: 'Z tego połączenia internetowego oddano już głos.' });
  if (p.votes.some(v => v.k === k)) return J(res, 409, { err: 'Osoba o tym imieniu i nazwisku już głosowała.' });
  p.votes.push({ n: name, k, o: b.option, c: m.c, d: m.d, i: m.i, t: Date.now() }); save();
  return J(res, 200, { ok: 1 });
}
async function admin(req, res, act) {
  if (!auth(req)) return J(res, 401, { err: 'Błędny klucz.' });
  const p = db.poll;
  if (act === 'get') return J(res, 200, { poll: p && { id: p.id, title: p.title, status: p.status, pub: p.pub, ipLimit: p.ipLimit, results: tally(p), votes: p.votes.slice(-300).reverse().map(v => ({ n: v.n, o: v.o, t: v.t })), total: p.votes.length } });
  const b = await body(req);
  if (act === 'create') {
    const title = String(b.title || '').trim().slice(0, 150), seen = new Set(), opts = [];
    for (const x of (Array.isArray(b.options) ? b.options : [])) { const t = String(x).trim().slice(0, 100); if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); opts.push(t); } }
    if (!title || opts.length < 2 || opts.length > 20) return J(res, 400, { err: 'Podaj tytuł i od 2 do 20 różnych odpowiedzi.' });
    db.poll = { id: Date.now().toString(36), title, options: opts.map((t, i) => ({ id: 'o' + i, text: t })), status: 'draft', pub: !!b.pub, ipLimit: Math.max(1, Math.min(50, +b.ipLimit || 1)), votes: [] };
  } else if (!p) return J(res, 409, { err: 'Brak ankiety.' });
  else if (act === 'open' || act === 'close') p.status = act === 'open' ? 'open' : 'closed';
  else if (act === 'reset') p.votes = [];
  else if (act === 'delete') db.poll = null;
  save(); return J(res, 200, { ok: 1 });
}
async function handle(req, res) {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  if (p === '/glosuj') { cookieId(req, res); return page(res, VOTE); }
  if (p === '/ankieta-admin') return page(res, ADMIN);
  if (!p.startsWith('/api/ankieta')) return false;
  try {
    if (p === '/api/ankieta' && req.method === 'GET') return J(res, 200, pub(req, u));
    if (p === '/api/ankieta/glos' && req.method === 'POST') { cookieId(req, res); return await vote(req, res); }
    const m = /^\/api\/ankieta\/admin\/(get|create|open|close|reset|delete)$/.exec(p);
    if (m) return await admin(req, res, m[1]);
  } catch (e) { console.error(e); return J(res, 500, { err: 'Błąd serwera.' }); }
  return J(res, 404, { err: 'Nie znaleziono.' });
}
function overlayPoll() { // do /api/state -> poll (ten sam format co dotychczas); null gdy brak ankiety
  const p = db.poll; if (!p) return null;
  let r = tally(p).sort((a, b) => b.n - a.n); const tot = p.votes.length || 1;
  if (r.length > 8) r = r.slice(0, 7).concat({ text: 'Pozostałe', n: r.slice(7).reduce((s, x) => s + x.n, 0) });
  const C = ['#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#7c3aed', '#0891b2', '#db2777', '#64748b'];
  return { title: p.title, subtitle: 'Oddano głosów: ' + p.votes.length, hideAfter: 15, rows: r.map((x, i) => ({ name: x.text, value: +(x.n / tot * 100).toFixed(1), color: C[i % 8] })) };
}

const CSS = `*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(900px 500px at 10% 0,#16305c,transparent 60%),#050d1c;color:#fff;font:16px Arial,sans-serif;display:flex;justify-content:center;padding:20px}
main{width:100%;max-width:560px}.top{background:#d60f08;border-radius:0 18px 0 0;padding:14px 20px;font:800 26px Arial;letter-spacing:1px;border-bottom:5px solid #7a0000}
.card{background:#0e1c33;padding:22px;border-radius:0 0 14px 14px;box-shadow:0 14px 40px rgba(0,0,0,.5)}h1{font-size:26px;margin:0 0 16px}
input[type=text],input[type=password],input[type=number],textarea{width:100%;padding:13px;border-radius:10px;border:2px solid #2a3b5c;background:#07142a;color:#fff;font:17px Arial;margin:6px 0}
button{padding:14px 18px;border:0;border-radius:10px;background:#d60f08;color:#fff;font:800 16px Arial;cursor:pointer}button.g{background:#2a3b5c}button:disabled{opacity:.5}
.err{color:#ff8a8a;min-height:20px;margin:6px 0}.bar{height:12px;background:#07142a;border-radius:6px;overflow:hidden}.bar i{display:block;height:100%;background:#d60f08;transition:width .5s}.res{margin:12px 0}`;
const ESC = 'const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",\'"\':"&quot;"}[c]));const $=s=>document.querySelector(s);';

const VOTE = `<!DOCTYPE html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Głosowanie — JEDEN</title>
<style>${CSS}.opt{display:block;padding:14px 16px;margin:8px 0;border:2px solid #2a3b5c;border-radius:10px;cursor:pointer;font-weight:700}.opt:has(input:checked){border-color:#ff3b3b;background:#1b2a48}.opt input{margin-right:10px;accent-color:#d60f08}.msg{text-align:center;padding:26px 0;font-size:20px}#go{width:100%;font-size:18px;padding:16px}</style>
<main><div class="top">JEDEN · GŁOSOWANIE</div><div class="card" id="c">Ładowanie…</div></main>
<script>${ESC}
let did=localStorage.getItem('jd');if(!did){did=Math.random().toString(36).slice(2)+Date.now().toString(36);localStorage.setItem('jd',did)}
let cur='';
function draw(r){const k=[r.status,r.id,r.voted,r.results?r.total:''].join();if(k===cur)return;cur=k;const c=$('#c');
 if(r.status==='none'||r.status==='draft'){c.innerHTML='<div class="msg">Brak aktywnej ankiety.<br><small>Ta strona odświeży się sama.</small></div>';return}
 let h='<h1>'+esc(r.title)+'</h1>';
 if(r.status==='open'&&!r.voted){h+=r.options.map(o=>'<label class="opt"><input type="radio" name="o" value="'+o.id+'">'+esc(o.text)+'</label>').join('')+'<input type="text" id="n" placeholder="Imię i nazwisko" autocomplete="name" maxlength="60"><div class="err" id="e"></div><button id="go">Oddaj głos</button>';c.innerHTML=h;$('#go').onclick=send;return}
 if(r.status==='open')h+='<div class="msg">✅ Dziękujemy! Twój głos został zapisany.</div>';
 else{h+='<div class="msg">Głosowanie zakończone.</div>';if(r.results){const t=r.results.reduce((s,x)=>s+x.n,0)||1;h+=r.results.map(x=>'<div class="res"><b>'+esc(x.text)+'</b> — '+x.n+' ('+Math.round(x.n/t*100)+'%)<div class="bar"><i style="width:'+x.n/t*100+'%"></i></div></div>').join('')}}
 c.innerHTML=h}
async function send(){const o=document.querySelector('input[name=o]:checked'),b=$('#go');$('#e').textContent='';
 if(!o){$('#e').textContent='Wybierz odpowiedź.';return}b.disabled=true;
 try{const r=await fetch('/api/ankieta/glos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({option:o.value,name:$('#n').value,d:did})});const j=await r.json();
  if(r.ok){cur='';load()}else{$('#e').textContent=j.err||'Błąd.';b.disabled=false}}catch(e){$('#e').textContent='Brak połączenia.';b.disabled=false}}
async function load(){try{draw(await(await fetch('/api/ankieta?d='+did,{cache:'no-store'})).json())}catch(e){}}
load();setInterval(load,3000);</script></html>`;

const ADMIN = `<!DOCTYPE html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ankiety — admin</title>
<style>${CSS}main{max-width:760px}.row{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}table{width:100%;border-collapse:collapse;font-size:14px}td{padding:6px;border-bottom:1px solid #2a3b5c}.tag{display:inline-block;padding:3px 10px;border-radius:20px;background:#2a3b5c;font-size:13px;font-weight:700}.open{background:#2fb344}.closed{background:#d60f08}label{display:block;margin:6px 0}</style>
<main><div class="top">ANKIETY · ADMIN</div><div class="card">
<div id="login"><input type="password" id="k" placeholder="Klucz admina"><button onclick="setKey()">Zaloguj</button><div class="err" id="le"></div></div>
<div id="app" style="display:none">
<div id="cur"></div><hr style="border-color:#2a3b5c;margin:20px 0">
<h2>Nowa ankieta</h2><input type="text" id="t" placeholder="Tytuł ankiety" maxlength="150">
<textarea id="o" rows="6" placeholder="Odpowiedzi — jedna w linii (2–20)"></textarea>
<div class="row"><button class="g" onclick="o.value='Tak\\nNie'">Tak / Nie</button></div>
<label><input type="checkbox" id="p" checked> Pokaż wyniki głosującym po zamknięciu</label>
<label>Limit głosów z jednego IP: <input type="number" id="l" value="1" min="1" max="50" style="width:80px"></label>
<button onclick="mk()">Utwórz ankietę</button><div class="err" id="e"></div></div></div></main>
<script>${ESC}
let key=sessionStorage.getItem('ak')||'',tm;
function setKey(){key=$('#k').value;sessionStorage.setItem('ak',key);tick()}
async function api(a,b){const r=await fetch('/api/ankieta/admin/'+a,{method:'POST',headers:{'Content-Type':'application/json','x-key':key},body:JSON.stringify(b||{})});return[r.ok,await r.json()]}
async function act(a){if(a==='delete'&&!confirm('Usunąć ankietę wraz z głosami?'))return;if(a==='reset'&&!confirm('Wyzerować wszystkie głosy?'))return;await api(a);tick()}
async function mk(){const[ok,j]=await api('create',{title:$('#t').value,options:$('#o').value.split('\\n'),pub:$('#p').checked,ipLimit:$('#l').value});$('#e').textContent=ok?'':j.err;if(ok)tick()}
async function tick(){clearTimeout(tm);const[ok,j]=await api('get');
 if(!ok){$('#login').style.display='';$('#app').style.display='none';if(key)$('#le').textContent=j.err;return}
 $('#login').style.display='none';$('#app').style.display='';const p=j.poll;
 if(!p)$('#cur').innerHTML='<p>Brak ankiety. Utwórz nową poniżej.</p>';
 else{const t=p.total||1,nm={};p.results.forEach(x=>nm[x.id]=x.text);
  $('#cur').innerHTML='<h1>'+esc(p.title)+' <span class="tag '+p.status+'">'+{draft:'SZKIC',open:'OTWARTA',closed:'ZAMKNIĘTA'}[p.status]+'</span></h1>'
  +'<div class="row"><button onclick="act(\\'open\\')">Otwórz</button><button class="g" onclick="act(\\'close\\')">Zamknij</button><button class="g" onclick="act(\\'reset\\')">Zeruj głosy</button><button class="g" onclick="act(\\'delete\\')">Usuń</button></div>'
  +'<p>Link dla głosujących: <b>'+esc(location.origin)+'/glosuj</b> · głosów: <b>'+p.total+'</b> · limit IP: '+p.ipLimit+'</p>'
  +p.results.map(x=>'<div class="res"><b>'+esc(x.text)+'</b> — '+x.n+' ('+Math.round(x.n/t*100)+'%)<div class="bar"><i style="width:'+x.n/t*100+'%"></i></div></div>').join('')
  +'<h3>Ostatnie głosy</h3><table>'+p.votes.map(v=>'<tr><td>'+esc(v.n)+'</td><td>'+esc(nm[v.o]||'')+'</td><td>'+new Date(v.t).toLocaleTimeString('pl-PL')+'</td></tr>').join('')+'</table>'}
 tm=setTimeout(tick,2000)}
if(key)tick();</script></html>`;

module.exports = { handle, overlayPoll };
if (require.main === module) {
  const P = process.env.PORT || 3100;
  http.createServer(async (q, s) => { if (!await handle(q, s)) { s.writeHead(302, { Location: '/ankieta-admin' }); s.end(); } })
    .listen(P, () => console.log('Admin: http://localhost:' + P + '/ankieta-admin  | klucz: ' + KEY + (process.env.ANKIETA_KEY ? '' : '  (ustaw ANKIETA_KEY, bo ten zmienia się przy każdym starcie)')));
}