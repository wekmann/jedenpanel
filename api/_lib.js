import crypto from 'node:crypto';
import { z } from 'zod';

/* ---------- domyślna konfiguracja (jak w plikach referencyjnych) ---------- */
export const DEFAULTS = {
  bar: {
    visible: true,
    line1: 'MAKABRYCZNY "BIZNES" W SZPITALU POŁUDNIOWYM',
    line2: 'TRWAŁ OD DAWNA - NIKT NIE REAGOWAŁ',
    news: [
      '100% BADANYCH ZGADZA SIĘ ŻE PREMIER DOMINIK TARCZA KŁAMIE!',
      'NIELEGALNE PRZEJĘCIE PVT',
      'PiS NAJLEPSZĄ PARTIĄ WEDŁUG SONDAŻU?',
      'NeoPVT ATAKUJE POSŁÓW PRAWA I SUWERENNOŚCI!',
    ],
    speed: 106,
    offsetX: 0,
    marginBottom: 43,
    hideHead: false,
  },
  live_badge: { visible: false, text: 'NA ŻYWO', top: 43, right: 53 },
  qr: { visible: false },
  age: { visible: false, rating: 12 },
  lower_third: { visible: false, name: '', role: '', hideAfter: 0 },
  break_screen: {
    visible: false,
    kind: 'break',
    title: '',
    subtitle: '',
    footer: '',
    endsAt: '',
    startedAt: '',
    music: true,
    volume: 60,
  },
  poll: {
    title: 'Sondaż poparcia',
    subtitle: 'Sondaż przeprowadzony na zlecenie JEDEN',
    hideAfter: 25,
    rows: [
      { name: 'PiS', value: 21.43, color: '#1b4f9c', logo: '' },
      { name: 'MORWIN', value: 17.86, color: '#dc0432', logo: '' },
      { name: 'ZLN+BN', value: 14.29, color: '#2e9e44', logo: '' },
      { name: 'PN', value: 10.71, color: '#f0c93a', logo: '' },
      { name: 'KPN', value: 10.71, color: '#4a8fe7', logo: '' },
      { name: 'LN', value: 10.71, color: '#e6761a', logo: '' },
      { name: 'AO', value: 7.14, color: '#8a4fd1', logo: '' },
      { name: 'PPMŻ', value: 3.57, color: '#18a8a8', logo: '' },
      { name: 'KD', value: 3.57, color: '#9aa3b2', logo: '' },
    ],
  },
  fund: {
    visible: false,
    line1: 'POTRZEBUJEMY',
    amount: '250 000ZŁ',
    line2: 'NA ORGANIZACJĘ TRANSMISJI MARSZU 11 LISTOPADA',
    percent: 0,
    everySeconds: 0,
    startedAt: new Date(0).toISOString(),
  },
  poll_cmd: { action: 'hide', seq: 0, at: new Date(0).toISOString() },
  ads: { volume: 100, everyMinutes: 0, label: true, startedAt: new Date(0).toISOString() },
  ads_cmd: { action: 'stop', n: 0, seq: 0, at: new Date(0).toISOString() },
};

/* ---------- walidacja (zod) ---------- */
const txt = (max) => z.string().max(max);
export const SCHEMAS = {
  bar: z.object({
    visible: z.boolean(),
    line1: txt(200),
    line2: txt(200),
    news: z.array(z.string().trim().min(1, 'Pusty news').max(300)).max(50),
    speed: z.number().min(10, 'Prędkość min. 10').max(1000, 'Prędkość max. 1000'),
    offsetX: z.number().int().min(-960, 'Przesunięcie min. -960').max(960, 'Przesunięcie max. 960'),
    marginBottom: z.number().int().min(0).max(1080),
    hideHead: z.boolean().default(false),
  }),
  fund: z.object({
    visible: z.boolean(),
    line1: txt(80),
    amount: txt(40),
    line2: txt(160),
    percent: z.number().min(0, '% min. 0').max(100, '% max. 100'),
    everySeconds: z.number().min(0, 'Sekundy min. 0').max(86400, 'Sekundy max. 86400'),
  }),
  ads: z.object({
    volume: z.number().min(0, 'Głośność min. 0').max(100, 'Głośność max. 100'),
    everyMinutes: z.number().min(0, 'Minuty min. 0').max(1440, 'Minuty max. 1440'),
    label: z.boolean(),
  }),
  live_badge: z.object({
    visible: z.boolean(),
    text: z.string().trim().min(1, 'Podaj tekst plakietki').max(40),
    top: z.number().int().min(0).max(1080),
    right: z.number().int().min(0).max(1920),
  }),
  qr: z.object({
    visible: z.boolean(),
  }),
  age: z.object({
    visible: z.boolean(),
    rating: z.number().int().refine((n) => [7, 12, 16, 18].includes(n), 'Wiek: 7, 12, 16 lub 18'),
  }),
  lower_third: z.object({
    visible: z.boolean(),
    name: z.string().trim().max(80),
    role: z.string().trim().max(120),
    hideAfter: z.number().min(0, 'Sekundy min. 0').max(3600, 'Sekundy max. 3600'),
  }),
  break_screen: z.object({
    visible: z.boolean(),
    kind: z.enum(['break', 'brb', 'start']),
    title: z.string().trim().max(60),
    subtitle: z.string().trim().max(120),
    footer: z.string().trim().max(80),
    endsAt: z.string().max(40),
    startedAt: z.string().max(40),
    music: z.boolean(),
    volume: z.number().min(0, 'Głośność min. 0').max(100, 'Głośność max. 100'),
  }),
  poll: z.object({
    title: txt(200),
    subtitle: txt(200),
    hideAfter: z.number().min(0).max(3600),
    rows: z
      .array(
        z.object({
          name: z.string().trim().min(1, 'Opcja bez nazwy').max(60),
          value: z.number().min(0, '% min. 0').max(100, '% max. 100'),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Zły kolor'),
          logo: z
            .string()
            .trim()
            .max(2000)
            .refine((u) => u === '' || /^https?:\/\//i.test(u), 'Logo musi być adresem http(s)'),
        }),
      )
      .min(1, 'Dodaj co najmniej jedną opcję')
      .max(20, 'Maks. 20 opcji'),
  }),
};

/* ---------- storage: Upstash/Vercel KV (REST); lokalnie pamięć ---------- */
const DB_URL = () => process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const DB_TOKEN = () => process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const DB_KEY = 'jeden:stream:v1';
const mem = (globalThis.__jedenMem ||= {});

export async function redis(cmd) {
  const r = await fetch(DB_URL(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${DB_TOKEN()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('Błąd bazy danych');
  return j.result;
}
export async function redisPipeline(cmds) {
  const r = await fetch(DB_URL().replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: `Bearer ${DB_TOKEN()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(j)) throw new Error('Błąd bazy danych');
  return j.map((x) => { if (x.error) throw new Error('Błąd bazy danych'); return x.result; });
}
async function dbGet() {
  if (!DB_URL()) return mem[DB_KEY] ? JSON.parse(mem[DB_KEY]) : null;
  const v = await redis(['GET', DB_KEY]);
  return v ? JSON.parse(v) : null;
}
export const persistent = () => !!DB_URL();
async function dbSet(obj) {
  const s = JSON.stringify(obj);
  if (!DB_URL()) {
    // na Vercelu pamięć funkcji nie jest współdzielona – lepiej zgłosić błąd niż zapisywać „w próżnię”
    if (process.env.VERCEL) throw new Error('Brak bazy danych: w Vercel → Storage podłącz Upstash Redis do projektu i zrób Redeploy');
    mem[DB_KEY] = s; return;
  }
  await redis(['SET', DB_KEY, s]);
}

/* ---------- sekret / klucz overlayu ---------- */
export function adminPassword() {
  const p = process.env.ADMIN_PASSWORD;
  if (!p) throw new Error('Brak zmiennej ADMIN_PASSWORD na serwerze');
  return p;
}
const hmac = (label) => crypto.createHmac('sha256', adminPassword()).update(label).digest('hex');
// domyślny klucz jest wyliczany z hasła, więc link działa nawet zanim ktokolwiek go wygeneruje
const derivedKey = () => hmac('overlay-key').slice(0, 32);

export async function readConfig() {
  const s = (await dbGet()) || {};
  const cfg = { overlayKey: s.overlayKey || derivedKey(), rev: Number(s.rev) || 0 };
  for (const k of Object.keys(DEFAULTS)) cfg[k] = { ...DEFAULTS[k], ...(s[k] || {}) };
  return cfg;
}
export async function writeConfig(cfg) {
  cfg.rev = (Number(cfg.rev) || 0) + 1; // numer wersji – panele po nim wykrywają zmiany wprowadzone przez innych
  await dbSet(cfg);
}

// aktualny % zbiórki: wartość bazowa + 1% co everySeconds sekund od startedAt (bez górnego zaokrąglania)
export function effectivePercent(f, now = Date.now()) {
  const inc = f.everySeconds > 0 ? Math.max(0, now - Date.parse(f.startedAt)) / 1000 / f.everySeconds : 0;
  return Math.max(0, Math.min(100, (Number(f.percent) || 0) + inc));
}

export const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

/* ---------- sesja admina (cookie jeden-panel) ---------- */
const COOKIE = 'jeden-panel';
const SESSION_MS = 7 * 24 * 3600 * 1000;

export function makeSessionCookie(req) {
  const exp = Date.now() + SESSION_MS;
  const val = `${exp}.${hmac('session.' + exp)}`;
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${COOKIE}=${val}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${secure}`;
}
export const clearSessionCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;

function getCookie(req, name) {
  for (const p of (req.headers.cookie || '').split(';')) {
    const i = p.indexOf('=');
    if (i > 0 && p.slice(0, i).trim() === name) return p.slice(i + 1).trim();
  }
  return null;
}
export function isAdmin(req) {
  try {
    const c = getCookie(req, COOKIE);
    if (!c) return false;
    const [exp, sig] = c.split('.');
    if (!exp || !sig || !(Number(exp) > Date.now())) return false;
    return safeEqual(sig, hmac('session.' + exp));
  } catch { return false; }
}
export function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  res.status(401).json({ error: 'Brak dostępu' });
  return false;
}

export function method(req, res, m) {
  if (req.method === m) return true;
  res.setHeader('Allow', m);
  res.status(405).json({ error: 'Metoda niedozwolona' });
  return false;
}
export function fail(res, e) {
  const msg = e instanceof z.ZodError
    ? e.issues.map((i) => i.message).join('; ')
    : (e && e.message) || 'Błąd serwera';
  res.status(e instanceof z.ZodError ? 400 : 500).json({ error: msg, err: msg });
}