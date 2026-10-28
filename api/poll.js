import { readConfig, writeConfig, requireAdmin, method, fail } from './_lib.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!method(req, res, 'POST') || !requireAdmin(req, res)) return;
    const action = req.body && req.body.action;
    if (action !== 'show' && action !== 'hide') return res.status(400).json({ error: 'Zła akcja' });
    const cfg = await readConfig();
    cfg.poll_cmd = { action, seq: (Number(cfg.poll_cmd.seq) || 0) + 1, at: new Date().toISOString() };
    await writeConfig(cfg);
    res.status(200).json({ config: cfg });
  } catch (e) { fail(res, e); }
}
