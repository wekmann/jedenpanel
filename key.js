import crypto from 'node:crypto';
import { readConfig, writeConfig, requireAdmin, method, fail } from './_lib.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!method(req, res, 'POST') || !requireAdmin(req, res)) return;
    const cfg = await readConfig();
    cfg.overlayKey = crypto.randomBytes(16).toString('hex');
    await writeConfig(cfg);
    res.status(200).json({ config: cfg });
  } catch (e) { fail(res, e); }
}
