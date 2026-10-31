import crypto from 'node:crypto';
import { AccessToken, EgressClient, StreamOutput, StreamProtocol, EncodingOptionsPreset } from 'livekit-server-sdk';
import * as LK from 'livekit-server-sdk';
import { readConfig, writeConfig, requireAdmin, safeEqual, fail } from './_lib.js';

// LiveKit: tokeny dla widzów/publikującego + start/stop streamu na Twitcha i TikToka (RTMP-out po stronie LiveKit)
const ROOM = 'jeden';
const env = () => ({ url: process.env.LIVEKIT_URL, key: process.env.LIVEKIT_API_KEY, secret: process.env.LIVEKIT_API_SECRET });
const httpHost = (u) => u.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');

async function makeToken({ key, secret }, identity, publish) {
  const at = new AccessToken(key, secret, { identity, ttl: '12h' });
  at.addGrant({ room: ROOM, roomJoin: true, canPublish: publish, canPublishData: publish, canSubscribe: true });
  return at.toJwt();
}
const cleanOp = (x) => String(x || '').replace(/[<>"]/g, '').trim().slice(0, 40);
const target = (base, key) => (base.replace(/\/+$/, '') + '/' + key.replace(/^\/+/, ''));

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const e = env();
    const hasLk = !!(e.url && e.key && e.secret);

    // ZATRZYMAJ / WZNÓW nie potrzebuje LiveKita (działa też na lokalnym oknie PGM i podglądzie) – obsługa przed sprawdzeniem zmiennych
    if (req.method === 'POST' && req.body && req.body.action === 'pause') {
      if (!requireAdmin(req, res)) return;
      const on = !!req.body.paused;
      const c = await readConfig();
      c.game_pause = { paused: on, at: new Date().toISOString() };
      await writeConfig(c);
      return res.status(200).json({ ok: true, paused: on });
    }
    if (req.method === 'POST' && req.body && req.body.action === 'status' && !hasLk) {
      if (!requireAdmin(req, res)) return;
      const c = await readConfig();
      return res.status(200).json({ status: 'off', paused: !!(c.game_pause && c.game_pause.paused) });
    }

    if (!hasLk) return res.status(503).json({ error: 'Brak LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET w zmiennych środowiskowych Vercela' });

    // widz (overlay): tylko oglądanie, wymaga klucza overlayu
    if (req.method === 'GET') {
      const k = typeof req.query?.key === 'string' ? req.query.key : '';
      const cfg = await readConfig();
      if (!k || !safeEqual(k, cfg.overlayKey)) return res.status(404).end();
      const token = await makeToken(e, 'v-' + crypto.randomBytes(5).toString('hex'), false);
      return res.status(200).json({ url: e.url, token, room: ROOM });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Metoda niedozwolona' });
    if (!requireAdmin(req, res)) return;

    const action = req.body && req.body.action;
    const cfg = await readConfig();
    const eg = new EgressClient(httpHost(e.url), e.key, e.secret);

    // ZATRZYMAJ / WZNÓW obraz z gry w streamie (overlay robi przenikanie do czerni i z powrotem; wysyłka na platformy leci dalej)
    if (action === 'pause') {
      const on = !!(req.body && req.body.paused);
      cfg.game_pause = { paused: on, at: new Date().toISOString() };
      await writeConfig(cfg);
      return res.status(200).json({ ok: true, paused: on });
    }

    if (action === 'publisher') {
      const token = await makeToken(e, 'gra', true);
      return res.status(200).json({ url: e.url, token, room: ROOM });
    }

    if (action === 'start') {
      const st = cfg.stream, urls = [];
      if (st.twitchOn && st.twitchKey) urls.push(target(st.twitchUrl || 'rtmp://live.twitch.tv/app', st.twitchKey));
      if (st.tiktokOn && st.tiktokKey) {
        if (!st.tiktokUrl) return res.status(400).json({ error: 'TikTok: wpisz adres serwera (Server URL) z TikTok LIVE' });
        urls.push(target(st.tiktokUrl, st.tiktokKey));
      }
      if (!urls.length) return res.status(400).json({ error: 'Włącz i uzupełnij klucz Twitcha lub TikToka (i kliknij Zapisz)' });
      if (cfg.stream_state.egressId) { try { await eg.stopEgress(cfg.stream_state.egressId); } catch (x) { /* już zakończony */ } }
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const page = `${proto}://${host}/overlay?key=${encodeURIComponent(cfg.overlayKey)}&egress=1`;
      // jakość wysyłki do Twitcha/TikToka: własne parametry (1080p, 60 kl/s, wyższy bitrate, klatka kluczowa co 2 s)
      const fps = st.fps === 30 ? 30 : 60;
      let br = Math.min(12000, Math.max(2500, Number(st.bitrate) || 8000)), clamped = false;
      // Twitch przyjmuje maks. ok. 8,5 Mb/s (zalecane 6) – przy wysyłce także na Twitcha nie przekraczamy 8000, żeby ingest nie odrzucił strumienia
      if (st.twitchOn && st.twitchKey && br > 8000) { br = 8000; clamped = true; }
      const enc = {
        width: 1920, height: 1080, depth: 24, framerate: fps,
        audioCodec: (LK.AudioCodec && LK.AudioCodec.AAC) ?? 2, audioBitrate: 192, audioFrequency: 48000,
        videoCodec: (LK.VideoCodec && LK.VideoCodec.H264_HIGH) ?? 3, videoBitrate: br, keyFrameInterval: 2,
      };
      const encodingOptions = LK.EncodingOptions ? new LK.EncodingOptions(enc) : enc;
      const info = await eg.startWebEgress(page, { stream: new StreamOutput({ protocol: StreamProtocol.RTMP, urls }) }, { encodingOptions, advanced: encodingOptions, awaitStartSignal: true });
      const operator = cleanOp(req.body && req.body.operator);
      cfg.stream_state = { egressId: info.egressId, startedAt: new Date().toISOString(), operator };
      await writeConfig(cfg);
      return res.status(200).json({ ok: true, egressId: info.egressId, targets: urls.length, fps, bitrate: br, clamped });
    }

    // inny operator przejmuje publikację obrazu/dźwięku (stream na platformach leci dalej bez restartu)
    if (action === 'operator') {
      cfg.stream_state = { ...cfg.stream_state, operator: cleanOp(req.body.operator) };
      await writeConfig(cfg);
      return res.status(200).json({ ok: true });
    }

    if (action === 'stop') {
      const id = cfg.stream_state.egressId;
      if (id) { try { await eg.stopEgress(id); } catch (x) { /* już zakończony */ } }
      cfg.stream_state = { egressId: '', startedAt: '', operator: '' };
      cfg.game_pause = { paused: false, at: new Date().toISOString() };   // nowy stream zawsze startuje bez zatrzymania
      await writeConfig(cfg);
      return res.status(200).json({ ok: true });
    }

    if (action === 'status') {
      const id = cfg.stream_state.egressId;
      const paused = !!(cfg.game_pause && cfg.game_pause.paused);
      if (!id) return res.status(200).json({ status: 'off', paused });
      const list = await eg.listEgress({ egressId: id });
      const info = list && list[0];
      // 0 STARTING, 1 ACTIVE, 2 ENDING, 3 COMPLETE, 4 FAILED, 5 ABORTED, 6 LIMIT_REACHED
      if (!info || info.status >= 3) {
        const err = info && info.error ? String(info.error) : '';
        const fresh = await readConfig();   // świeży odczyt, żeby nie nadpisać np. świeżo zapisanej pauzy
        fresh.stream_state = { egressId: '', startedAt: '', operator: '' };
        await writeConfig(fresh);
        return res.status(200).json({ status: 'off', error: err, paused: !!(fresh.game_pause && fresh.game_pause.paused) });
      }
      return res.status(200).json({ paused, status: info.status === 1 ? 'live' : info.status === 2 ? 'ending' : 'starting', startedAt: cfg.stream_state.startedAt, operator: cfg.stream_state.operator || '' });
    }

    return res.status(400).json({ error: 'Zła akcja' });
  } catch (err) { fail(res, err); }
}