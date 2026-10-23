---
paths:
  - "src/obsidian/http.ts"
  - "src/core/txt2img.ts"
  - "scripts/mock-a1111.mjs"
---

# Server-Backend (A1111-kompatible API)

Gotchas zum Server-Modus (Draw Things, AUTOMATIC1111, Forge, SD.Next): die vier Endpunkte, `requestUrl` und der Fortschritt (`src/obsidian/http.ts`, `src/core/txt2img.ts`).

- **Vier Endpunkte, mehr nicht (Server-Modus):** `POST /sdapi/v1/txt2img` erzeugt,
  `POST /sdapi/v1/img2img` rechnet von einer Vorlage aus weiter (seit 0.8; derselbe Body plus
  `init_images` und `denoising_strength`),
  `GET /sdapi/v1/progress` liefert den Fortschritt (1-s-Polling), `GET /sdapi/v1/options`
  nennt das aktive Modell und dient als Verbindungstest. Alles Weitere gehoert dem
  Server, nicht uns.
- **`requestUrl` kennt weder Abort noch Timeout** (`src/obsidian/http.ts`). Ohne das
  selbst gesetzte kurze Zeitlimit haengt das Panel an einem toten Server ewig, statt ihn
  als unerreichbar zu melden. Diese Zeile nicht "vereinfachen".
- **Ein Server ohne `/progress` ist kein Fehlerfall:** liefert er 404 oder eine fremde
  Form, faellt die Anzeige auf unbestimmt zurueck — der Lauf selbst bleibt gueltig.
  Seit `598f050` fragt der `ProgressPoller` (`src/core/txt2img.ts`, eine Instanz pro Lauf)
  nach dem **ersten 404 nicht mehr** — Draw Things kennt den Endpunkt nicht, und ~240
  vergebliche Anfragen pro Bild sind Last auf einem rechnenden Server. Nur 404 schaltet ab;
  Timeout und 5xx sind voruebergehend und pollen weiter. Nicht "vereinheitlichen".
- **Der Server bestimmt das Modell.** Das Plugin schickt generische Parameter und zeigt
  den gemeldeten Modellnamen als Statushinweis; es waehlt nie ein Modell aus.
