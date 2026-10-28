import { adminPassword, safeEqual, makeSessionCookie, clearSessionCookie, isAdmin, fail } from './_lib.js';

const fails = (globalThis.__jedenFails ||= new Map());

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') return res.status(200).json({ admin: isAdmin(req) });
    if (req.method === 'DELETE') {
      res.setHeader('Set-Cookie', clearSessionCookie());
      return res.status(200).json({ ok: true });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Metoda niedozwolona' });

    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
    const f = fails.get(ip);
    if (f && f.n >= 5 && Date.now() - f.t < 60_000)
      return res.status(429).json({ error: 'Za dużo prób. Spróbuj za minutę.' });

    const pw = req.body && typeof req.body.password === 'string' ? req.body.password : '';
    if (!safeEqual(pw, adminPassword())) {
      fails.set(ip, { n: (f && Date.now() - f.t < 60_000 ? f.n : 0) + 1, t: Date.now() });
      await new Promise((r) => setTimeout(r, 500));
      return res.status(401).json({ error: 'Błędne hasło' });
    }
    fails.delete(ip);
    res.setHeader('Set-Cookie', makeSessionCookie(req));
    res.status(200).json({ ok: true });
  } catch (e) { fail(res, e); }
}
