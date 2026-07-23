# Spec: Thin-Client-Architektur (A1111-kompatibler lokaler Server)

**Datum:** 2026-07-23 · **Status:** entschieden (Fable-Brainstorming mit Jay) ·
**Ergebnis von:** `docs/superpowers/briefs/2026-07-23-store-warnings-architektur-brief.md`
**Ziel-Version:** 0.5.0

## 1. Entscheidung & Begründung

Das Plugin wird die **Produkt-Schicht über einem A1111-kompatiblen lokalen Bild-Server**
(Draw Things, AUTOMATIC1111, Forge, SD.Next). Es spricht nur noch
`POST /sdapi/v1/txt2img` via `requestUrl` — kein `fs`, kein `child_process`, kein ORT/`eval`,
kein Großbundle. Alle vier Store-Findings fallen; der Review-Weg wird vollautomatisch.

**Der Weg dorthin (Session-Verlauf, für die Nachwelt):**

1. Jays Ziel: warning-frei („das Plugin definiert sich durch das *Was*, nicht das *Wie*").
2. Verifiziert: Warning-frei geht NUR, wenn das Plugin die Systemarbeit nicht selbst tut.
   Store-Installer liefert exakt 3 Dateien (main.js/manifest.json/styles.css) → WASM-
   Externalisierung tot; Laufzeit-Code-Download verboten; In-Process-FLUX unrealistisch.
3. Eigener Mini-Server (Python/uv) verworfen: „Niemand lädt mein Plugin, wenn man sich dazu
   noch ein dubioses anderes Repo laden muss" — die Einstiegshürde eines Eigen-CLI killt
   das Produkt.
4. Health-Vitals-Vergleich geklärt: dessen Null-Warnings sind Aufgaben-Natur (reines
   Datei-Parsing), kein übertragbares Muster — unsere Warnings sind Fähigkeits-
   Offenlegungen, keine Code-Muster-Findings.
5. **Gewählt: Thin-Client zu etablierten Apps** (Ollama-Muster der LLM-Plugins). Draw
   Things ist die polierte Mac-App-Store-Doppelklick-App, die SD *und* FLUX hält; A1111/
   Forge/SD.Next decken andere Plattformen ab. Ein Protokoll, vier Server.
6. Kit-first-Fund: yijing-oracle hat den A1111-Client bereits
   (`yijing-oracle/src/obsidian/image-client.ts`, `Txt2ImgClient` + injiziertes
   `httpPostJson` über `requestUrl`) — er ist unsere Referenz-Implementierung.

**Aufgegeben wird** die Selbst-Enthaltenheit (Zero-Install-SD-Turbo). Der Nutzer
installiert eine etablierte App und aktiviert deren API-Server (Draw Things: Toggle in den
App-Einstellungen; A1111: `--api`-Flag). Die FLUX-Nutzung setzte schon bisher eine
Nutzer-Installation voraus (mflux).

## 2. Nicht-Ziele (v1 = 0.5.0)

- **Kein ComfyUI-Adapter** (kein `/sdapi`); später als zweite `ImageBackend`-Implementierung.
- **Kein Modell-Management im Plugin:** Modellwahl/-download passiert in der Server-App.
- **Kein Mobile-Support:** `isDesktopOnly` bleibt `true` (Thin-Client macht Mobile künftig
  denkbar — bewusst vertagt).
- **Kein Cancel/Interrupt** (`/sdapi/v1/interrupt`) in v1.
- **Kein eigener Server, keine Prozess-Starts, keine Gewichte-Downloads** — nie wieder.

## 3. Architektur

```
src/core/txt2img.ts        Txt2ImgClient (pure; HttpPostJson injiziert; nach yijing-Referenz,
                           erweitert um cfg + Modell-/Progress-Discovery)
src/obsidian/http.ts       httpPostJson/httpGetJson über requestUrl (+ raceTimeout aus
                           timeout.ts für kurze Discovery-Calls)
src/vendor/kit/endpoint.ts normalizeEndpoint (Kit-Vendoring, wie yijing)
```

- **Pure-Core-Schnitt bleibt:** `src/core/` importiert nie `obsidian`; der Client bekommt
  HTTP injiziert (Muster `Txt2ImgClient`/`ChatClient` in yijing). `check:pure` unverändert.
- **Provider-API 0.2 bleibt:** `ImageBackend.generate()` unverändert für yijing; der Router
  in `main.ts` routet jetzt auf den HTTP-Client statt auf ORT/mflux. Neue Request-Felder
  (negativePrompt, cfg, width, height) sind optional mit Defaults.

### API-Nutzung (alle Calls gegen den konfigurierten Endpoint, Default-Port 7860)

| Call | Zweck | Fallback wenn nicht unterstützt |
| --- | --- | --- |
| `POST /sdapi/v1/txt2img` | Generierung: prompt, negative_prompt, width, height, steps, seed, cfg_scale → `images[0]` als Base64-PNG | — (Pflicht) |
| `GET /sdapi/v1/options` | Verbindungstest + aktives Modell (`sd_model_checkpoint`) | Test gilt als OK, Modellname = "unknown" |
| `GET /sdapi/v1/progress` | Fortschritt während Generierung (Polling 1 s) | Statuszeile zeigt Sekundenzähler (bestehendes Muster) |

- Base64-PNG → `ArrayBuffer` → Vault-Write über bestehenden Speicherpfad. Der
  RGBA→PNG-Encoder (`src/obsidian/png.ts`) stirbt.
- Kein Timeout auf `txt2img` (FLUX auf schwacher Hardware darf Minuten dauern);
  `raceTimeout` (3 s) nur auf Discovery-Calls (`options`/`progress`).
- Fehlerbilder mit Klartext in der Statuszeile (i18n): Endpoint leer → Onboarding-Hinweis;
  nicht erreichbar → „Server nicht erreichbar" + Kurzanleitung; HTTP ≠ 200 / leeres
  `images` → Fehlertext. Retry = Generate-Button (bestehendes `generateEnabled`-Muster).

## 4. UI/UX-Änderungen

**Generate-Tab:**
- **Neu, endlich ehrlich** (die Keine-Attrappen-Linie aus 0.2 löst sich auf, weil echte
  Modelle sie ehren): **Negative-Prompt-Feld** (Textarea, leer erlaubt) und
  **CFG-Slider** (1–15, Schritt 0.5, Default 7).
- Steps-Slider generisch **1–50, Default 20** (bisher modellgebunden 1–4/1–8).
- Größen-Dropdown: die 7 kuratierten Größen aus dem 0.4-FLUX-Katalog, für alle Server.
- **Modell-Dropdown entfällt.** Stattdessen Read-only-Zeile „Model: <name>" aus
  `options`-Discovery (oder „(im Server gewählt)" wenn nicht ermittelbar). Modellwechsel
  macht der Nutzer in der Server-App.
- Onboarding-Zustand: ohne konfigurierten Endpoint zeigt der Tab statt der Regler einen
  Hinweis (Draw Things aus dem Mac App Store / A1111 mit `--api`; API-Server aktivieren;
  Endpoint in den Settings eintragen) + Button zu den Settings.

**Settings:**
- **Neu:** `endpoint` (Text, Default `""`, Placeholder `http://127.0.0.1:7860`) +
  **Test-Button** (ruft `options`, Notice mit Ergebnis + Modellname).
- **Weg:** mflux-Pfad, Modell-Speicherort, Download-Sektion/Fortschritt (der
  `prefer-setting-definitions`-Override entfällt ersatzlos, wenn kein state-getriebenes
  Re-Rendering mehr nötig ist — im Plan prüfen).
- **Aufräum-Offerte:** existiert der alte SD-Turbo-Cache (Cache API), erscheint eine
  Settings-Zeile „Alte SD-Turbo-Gewichte löschen (~2,5 GB)" + einmalige Notice pro
  Session. Cache-API-Zugriff ist Browser-API — keine neue Warning.

**Statuszeile:** Phasen „Kontaktiere Server…" → „Generiere… (X %)" (Progress-Polling) bzw.
„Generiere… (m:ss)" (Fallback) → fertig. Bestehende i18n-Statuszeilen-Mechanik.

## 5. Datenmodell & Migration (0.4 → 0.5)

- `HistoryEntry` + Rezept: **+ `negativePrompt: string`, + `cfg: number`.**
  `recipeKey`/`deleteEntry`/Frontmatter (`negative_prompt` nur wenn nicht leer, `cfg`
  immer) werden erweitert. Sanitize-Migration: fehlende Felder → `""` / `7`.
- `LigSettings`: + `endpoint`; `mfluxPath`, `modelsDir`, `selectedModel` werden **tote
  Keys** (Muster `sectionsCollapsed`: bleiben ladbar, kein Codepfad liest sie).
  `defaultSteps`-Sanitize weitet auf 1–50, Default 20.
- Alt-Historie bleibt erhalten (Prompts/Seeds sind weiter wertvoll); exakte Reproduktion
  alter Bilder war schon durch den Modellwechsel nie garantiert.

## 6. Was stirbt (Lösch-Liste)

| Bereich | Dateien |
| --- | --- |
| ORT-Pipeline | `src/core/engine.ts`, `src/core/pipeline/*` (f16, image, prng, scheduler, tokenizer), `src/obsidian/ort-host.ts`, `src/types/wasm.d.ts` |
| Modell-Download | `src/core/model-manifest.ts`, `src/obsidian/model-store.ts` (nur die Lösch-Funktion für den Alt-Cache bleibt/entsteht neu) |
| mflux | `src/core/mflux-args.ts`, `mflux-detect.ts`, `mflux-output.ts`, `src/obsidian/mflux-engine.ts`, `mflux-host.ts` |
| Katalog | `src/core/models.ts` (ersetzt durch Konstanten: Größenliste, Steps-/CFG-Grenzen) |
| Sonstiges | `src/obsidian/png.ts`; zugehörige Tests (engine, f16, image, prng, scheduler, tokenizer, mflux-\*, model-manifest, model-store, models) |

Zusätzlich: esbuild-Config verliert WASM-Inlining/ORT-Sonderbehandlung; Abhängigkeit
`onnxruntime-web` fliegt aus `package.json`.

## 7. Qualitäts-Gates (neu)

- Gate erweitert um **Größen-Check**: Build schlägt fehl, wenn `main.js` > 2 MB
  (Erwartung: < 300 KB) — verhindert stilles Zurückrutschen über die 5-MB-Grenze.
- Gate erweitert um **Fähigkeits-Grep**: Build schlägt fehl, wenn `main.js`
  `child_process`, `require("fs`/`require("original-fs` oder `eval(` enthält
  (Store-Scanner-Vorwegnahme, Lesson „Scanner ≠ lokaler Lint").
- Bestehende Gates unverändert: typecheck, vitest, check:pure, eslint-Store-Config.

## 8. README / manifest / Store

- **README:** Neuschreiben der Identität („Produkt-Schicht über deinem lokalen
  Bild-Server"), Setup-Anleitungen je Server-App (Draw Things prominent), Abschnitt „How
  network and storage are used" neu: Netzwerk = ausschließlich der selbst konfigurierte
  lokale Endpoint; keine Downloads, keine Telemetrie. `## Installation` + Usage-Abschnitte
  explizit (Scanner-README-Heuristik).
- **manifest:** `description` neu (ohne „Obsidian", Title Case), Version 0.5.0.
- **Release/Store:** Release-Kette wie etabliert (Codeberg + GitHub-Mirror, Attestation).
  Danach Store-Einreichung aktualisieren (bestehender PR) — manueller Jay-Schritt.

## 9. Tests

- **Neu (pure):** `Txt2ImgClient` (Request-Mapping inkl. cfg/negative_prompt,
  Fehlerpfade Status ≠ 200 / leeres images / kein JSON), Options-/Progress-Parsing,
  Settings-Sanitize (endpoint, tote Keys, Steps-Range), History (erweiterter recipeKey,
  deleteEntry-Gleichheit), Frontmatter mit negative_prompt/cfg, Viewmodel-Phasen
  (Onboarding/Fehler/Progress-Fallback).
- **Obsidian-Layer:** bestehende happy-dom-Muster; `timeout.test.ts` bleibt.
- Erwartung: Testzahl sinkt (Maschinenraum-Tests sterben mit) — das ist korrekt, nicht
  kaschieren.

## 10. Offene Punkte (bewusst vertagt)

- ComfyUI als zweite `ImageBackend`-Implementierung (Bedarf abwarten).
- Mobile (`isDesktopOnly: false` + LAN-Endpoint) — erst nach Store-Aufnahme prüfen.
- img2img/Editing (Stufe B alt) — auf A1111-API neu bewerten (`/sdapi/v1/img2img`
  existiert; deutlich billiger als der alte mflux-Editing-Plan).
- yijing könnte langfristig unseren Provider statt eigenem Client nutzen — separates Thema.
