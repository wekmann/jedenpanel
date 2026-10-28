import { SCHEMAS, readConfig, writeConfig, effectivePercent, persistent, requireAdmin, fail } from './_lib.js';

const out = (cfg) => ({ config: cfg, serverNow: new Date().toISOString(), persistent: persistent() });

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!requireAdmin(req, res)) return;
    if (req.method === 'GET') {
      const cfg = await readConfig();
      // lekka odpowiedź, gdy panel ma już aktualną wersję
      if (req.query?.rev !== undefined && Number(req.query.rev) === cfg.rev)
        return res.status(200).json({ unchanged: true, rev: cfg.rev, serverNow: new Date().toISOString() });
      return res.status(200).json(out(cfg));
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Metoda niedozwolona' });

    const { section, data, patch, auto } = req.body || {};
    const schema = SCHEMAS[section];
    if (!schema) return res.status(400).json({ error: 'Nieznana sekcja' });
    const cfg = await readConfig();
    let input = data;
    // patch = zmiana pojedynczych pól (np. szybki przełącznik „widoczny”) bez dotykania reszty
    if (patch && typeof patch === 'object') {
      input = { ...cfg[section], ...patch };
      if (section === 'fund') input.percent = effectivePercent(cfg.fund);
    }
    const clean = schema.parse(input);
    if (section === 'fund') {
      // jeśli admin wpisał inny % niż aktualny – ustawiamy go ręcznie; w przeciwnym razie licznik biegnie dalej
      const now = Date.now();
      const eff = effectivePercent(cfg.fund, now);
      const manual = !patch && !auto && Math.round(clean.percent) !== Math.floor(eff);
      cfg.fund = { ...clean, percent: manual ? clean.percent : eff, startedAt: new Date(now).toISOString() };
    } else if (section === 'ads') {
      const same = Number(cfg.ads.everyMinutes) === clean.everyMinutes;
      cfg.ads = { ...clean, startedAt: same ? cfg.ads.startedAt : new Date().toISOString() };
    } else {
      cfg[section] = clean;
    }
    await writeConfig(cfg);
    res.status(200).json(out(cfg));
  } catch (e) { fail(res, e); }
}