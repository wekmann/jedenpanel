import { SCHEMAS, readConfig, writeConfig, requireAdmin, fail } from './_lib.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!requireAdmin(req, res)) return;
    if (req.method === 'GET') return res.status(200).json({ config: await readConfig() });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Metoda niedozwolona' });

    const { section, data } = req.body || {};
    const schema = SCHEMAS[section];
    if (!schema) return res.status(400).json({ error: 'Nieznana sekcja' });
    const clean = schema.parse(data);
    const cfg = await readConfig();
    cfg[section] = clean;
    await writeConfig(cfg);
    res.status(200).json({ config: cfg });
  } catch (e) { fail(res, e); }
}
