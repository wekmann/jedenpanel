// Odczyt wyników sondażu ze zrzutu ekranu przez DeepSeek (model z obsługą obrazów).
// Klucz: zmienna środowiskowa DEEPSEEK_API_KEY (Vercel -> Settings -> Environment Variables).
// Opcjonalnie: DEEPSEEK_MODEL (domyślnie "deepseek-flash").
import { requireAdmin, method, fail } from './_lib.js';

const PROMPT = `Na obrazie jest wynik sondażu lub wyborów (wykres, tabela, zrzut ekranu z grafiki telewizyjnej).
Odczytaj WSZYSTKIE pozycje (partie / kandydaci / odpowiedzi) razem z ich wartościami procentowymi.
Zwróć WYŁĄCZNIE obiekt JSON w formacie:
{"title": "pytanie lub tytuł sondażu albo pusty string", "subtitle": "źródło / podpis albo pusty string", "rows": [{"name": "PiS", "value": 21.43}]}
Zasady:
- zachowaj kolejność z obrazu (od góry / od lewej, zwykle malejąco),
- "name" przepisz dokładnie tak, jak jest na obrazie (skróty, wielkie litery, znaki specjalne),
- "value" to liczba w procentach, kropka jako separator dziesiętny, bez znaku %,
- jeśli wartość jest zapisana z przecinkiem (21,43) zamień na 21.43,
- niczego nie zgaduj ani nie dopisuj – jeśli pozycji lub liczby nie widać wyraźnie, pomiń ją,
- żadnego tekstu poza JSON-em.`;

const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!method(req, res, 'POST') || !requireAdmin(req, res)) return;
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) return res.status(503).json({ error: 'Brak zmiennej DEEPSEEK_API_KEY na serwerze (Vercel → Settings → Environment Variables), potem Redeploy.' });

    const image = String((req.body && req.body.image) || '');
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(image))
      return res.status(400).json({ error: 'Nieprawidłowy obraz (PNG, JPG, WebP lub GIF).' });
    if (image.length > 4_000_000) return res.status(413).json({ error: 'Obraz jest za duży.' });

    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
        temperature: 0,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: image } },
          ],
        }],
      }),
      signal: AbortSignal.timeout(55000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const m = (j.error && (j.error.message || j.error)) || ('HTTP ' + r.status);
      const hint = r.status === 401 ? ' (zły klucz API)' : r.status === 402 ? ' (brak środków na koncie DeepSeek)' : r.status === 429 ? ' (limit zapytań)' : '';
      return res.status(502).json({ error: 'DeepSeek: ' + String(m).slice(0, 200) + hint });
    }

    let txt = String(j.choices?.[0]?.message?.content || '').trim();
    txt = txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let data;
    try { data = JSON.parse(txt); }
    catch { const m = txt.match(/\{[\s\S]*\}/); try { data = m && JSON.parse(m[0]); } catch { data = null; } }
    if (!data || !Array.isArray(data.rows)) return res.status(502).json({ error: 'AI nie zwróciło czytelnych danych. Spróbuj wyraźniejszego obrazu.' });

    const rows = [];
    for (const x of data.rows.slice(0, 20)) {
      const name = clean(x && x.name, 60);
      const v = typeof x.value === 'number' ? x.value : parseFloat(String(x.value ?? '').replace(',', '.').replace(/[^\d.]/g, ''));
      if (!name || !Number.isFinite(v) || v < 0 || v > 100) continue;
      rows.push({ name, value: Math.round(v * 100) / 100 });
    }
    if (!rows.length) return res.status(422).json({ error: 'Nie znaleziono na obrazie żadnych wyników.' });

    res.status(200).json({ title: clean(data.title, 200), subtitle: clean(data.subtitle, 200), rows });
  } catch (e) { fail(res, e); }
}