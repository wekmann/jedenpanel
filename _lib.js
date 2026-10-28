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
    marginRight: 53,
    marginBottom: 43,
  },
  live_badge: { visible: false, text: 'NA ŻYWO', top: 43, right: 53 },
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
  poll_cmd: { action: 'hide', seq: 0, at: new Date(0).toISOString() },
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
    marginRight: z.number().int().min(0).max(1920),
    marginBottom: z.number().int().min(0).max(1080),
  }),
  live_badge: z.object({
    visible: z.boolean(),
    text: z.string().trim().min(1, 'Podaj tekst plakietki').max(40),
    top: z.number().int().min(0).max(1080),
    right: z.number().int().min(0).max(1920),
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

async function redis(cmd) {
  const r = await fetch(DB_URL(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${DB_TOKEN()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('Błąd bazy danych');
  return j.result;
}
async function dbGet() {
  if (!DB_URL()) return mem[DB_KEY] ? JSON.parse(mem[DB_KEY]) : null;
  const v = await redis(['GET', DB_KEY]);
  return v ? JSON.parse(v) : null;
}
async function dbSet(obj) {
  const s = JSON.stringify(obj);
  if (!DB_URL()) { mem[DB_KEY] = s; return; }
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
  const cfg = { overlayKey: s.overlayKey || derivedKey() };
  for (const k of Object.keys(DEFAULTS)) cfg[k] = { ...DEFAULTS[k], ...(s[k] || {}) };
  return cfg;
}
export async function writeConfig(cfg) {
  await dbSet(cfg);
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
  res.status(e instanceof z.ZodError ? 400 : 500).json({ error: msg });
}
