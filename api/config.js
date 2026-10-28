import { SCHEMAS, readConfig, writeConfig, effectivePercent, persistent, requireAdmin, fail } from './_lib.js';

const out = (cfg) => ({ config: cfg, serverNow: new Date().toISOString(), persistent: persistent() });

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!requireAdmin(req, res)) return;
    if (req.method === 'GET') return res.status(200).json(out(await readConfig()));
    if (req.method !== 'POST') return res.status(405).json({ error: 'Metoda niedozwolona' });

    const { section, data } = req.body || {};
    const schema = SCHEMAS[section];
    if (!schema) return res.status(400).json({ error: 'Nieznana sekcja' });
    const clean = schema.parse(data);
    const cfg = await readConfig();
    if (section === 'fund') {
      // jeśli admin wpisał inny % niż aktualny – ustawiamy go ręcznie; w przeciwnym razie licznik biegnie dalej
      const now = Date.now();
      const eff = effectivePercent(cfg.fund, now);
      const manual = Math.round(clean.percent) !== Math.floor(eff);
      cfg.fund = { ...clean, percent: manual ? clean.percent : eff, startedAt: new Date(now).toISOString() };
    } else {
      cfg[section] = clean;
    }
    await writeConfig(cfg);
    res.status(200).json(out(cfg));
  } catch (e) { fail(res, e); }
}