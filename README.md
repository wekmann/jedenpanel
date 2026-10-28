# JEDEN – overlay OBS + panel admina

- `/panel` – panel admina (hasło z `ADMIN_PASSWORD`)
- `/overlay?key=...` – strona do OBS (źródło „Przeglądarka” 1920×1080, przezroczyste tło)

Moduły: pasek dolny, plakietka NA ŻYWO, sondaż.

## Wdrożenie (GitHub → Vercel)
1. Wrzuć folder na GitHuba, zaimportuj repo w Vercel (Framework: Other, bez build command).
2. Vercel → Storage → Upstash Redis (darmowy) → podłącz do projektu
   (doda `KV_REST_API_URL` / `KV_REST_API_TOKEN` albo `UPSTASH_REDIS_REST_*`).
3. Vercel → Settings → Environment Variables → `ADMIN_PASSWORD` = hasło admina.
4. Redeploy, wejdź na `/panel`, w zakładce Overlay skopiuj link do OBS.

Bez bazy ustawienia nie zapisują się trwale na Vercelu.

## Lokalnie
`npm install && ADMIN_PASSWORD=cokolwiek npm run dev` → http://localhost:3000/panel
