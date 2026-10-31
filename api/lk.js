import crypto from 'node:crypto';
import { AccessToken, EgressClient, StreamOutput, StreamProtocol, EncodingOptionsPreset } from 'livekit-server-sdk';
import { readConfig, writeConfig, requireAdmin, safeEqual, fail } from './_lib.js';

// LiveKit: tokeny dla widzów/publikującego + start/stop streamu na Twitcha i TikToka (RTMP-out po stronie LiveKit)
const ROOM = 'jeden';
const env = () => ({ url: process.env.LIVEKIT_URL, key: process.env.LIVEKIT_API_KEY, secret: process.env.LIVEKIT_API_SECRET });
const httpHost = (u) => u.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');

async function makeToken({ key, secret }, identity, publish) {
  const at = new AccessToken(key, secret, { identity, ttl: '12h' });
  at.addGrant({ room: ROOM, roomJoin: true, canPublish: publish, canPublishData: false, canSubscribe: true });
  return at.toJwt();
}
const target = (base, key) => (base.replace(/\/+$/, '') + '/' + key.replace(/^\/+/, ''));

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const e = env();
    if (!e.url || !e.key || !e.secret) return res.status(503).json({ error: 'Brak LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET w zmiennych środowiskowych Vercela' });

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
      const preset = st.fps === 60 ? EncodingOptionsPreset.H264_1080P_60 : EncodingOptionsPreset.H264_1080P_30;
      const info = await eg.startWebEgress(page, { stream: new StreamOutput({ protocol: StreamProtocol.RTMP, urls }) }, { preset, awaitStartSignal: true });
      cfg.stream_state = { egressId: info.egressId, startedAt: new Date().toISOString() };
      await writeConfig(cfg);
      return res.status(200).json({ ok: true, egressId: info.egressId, targets: urls.length });
    }

    if (action === 'stop') {
      const id = cfg.stream_state.egressId;
      if (id) { try { await eg.stopEgress(id); } catch (x) { /* już zakończony */ } }
      cfg.stream_state = { egressId: '', startedAt: '' };
      await writeConfig(cfg);
      return res.status(200).json({ ok: true });
    }

    if (action === 'status') {
      const id = cfg.stream_state.egressId;
      if (!id) return res.status(200).json({ status: 'off' });
      const list = await eg.listEgress({ egressId: id });
      const info = list && list[0];
      // 0 STARTING, 1 ACTIVE, 2 ENDING, 3 COMPLETE, 4 FAILED, 5 ABORTED, 6 LIMIT_REACHED
      if (!info || info.status >= 3) {
        const err = info && info.error ? String(info.error) : '';
        cfg.stream_state = { egressId: '', startedAt: '' };
        await writeConfig(cfg);
        return res.status(200).json({ status: 'off', error: err });
      }
      return res.status(200).json({ status: info.status === 1 ? 'live' : info.status === 2 ? 'ending' : 'starting', startedAt: cfg.stream_state.startedAt });
    }

    return res.status(400).json({ error: 'Zła akcja' });
  } catch (err) { fail(res, err); }
}