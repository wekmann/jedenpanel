import { readConfig, writeConfig, requireAdmin, method, fail } from './_lib.js';

// n = numer reklamy (1.mp4, 2.mp4…); n = 0 → następna w kolejności; action 'all' → wszystkie po kolei
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!method(req, res, 'POST') || !requireAdmin(req, res)) return;
    const { action, n } = req.body || {};
    if (!['play', 'all', 'stop'].includes(action)) return res.status(400).json({ error: 'Zła akcja' });
    const num = Math.max(0, Math.min(999, Math.floor(Number(n) || 0)));
    const cfg = await readConfig();
    cfg.ads_cmd = { action, n: num, seq: (Number(cfg.ads_cmd.seq) || 0) + 1, at: new Date().toISOString() };
    await writeConfig(cfg);
    res.status(200).json({ config: cfg });
  } catch (e) { fail(res, e); }
}