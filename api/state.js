import { readConfig, safeEqual, method, fail } from './_lib.js';

// publiczny endpoint dla overlayu – bez poprawnego ?key= zwraca 404 i żadnych danych
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!method(req, res, 'GET')) return;
    const key = typeof req.query?.key === 'string' ? req.query.key : '';
    const cfg = await readConfig();
    if (!key || !safeEqual(key, cfg.overlayKey)) return res.status(404).end();
    res.status(200).json({
      serverNow: new Date().toISOString(),
      bar: cfg.bar,
      live_badge: cfg.live_badge,
      qr: cfg.qr,
      timer: cfg.timer,
      flash: cfg.flash,
      age: cfg.age,
      lower_third: cfg.lower_third,
      map: cfg.map,
      break_screen: cfg.break_screen,
      fund: cfg.fund,
      poll: cfg.poll,
      poll_cmd: cfg.poll_cmd,
      ads: cfg.ads,
      ads_cmd: cfg.ads_cmd,
      game_pause: cfg.game_pause,
    });
  } catch (e) { fail(res, e); }
}