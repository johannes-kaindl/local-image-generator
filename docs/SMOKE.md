# GUI-Smoke

Was gegen einen Mock geprüft ist, ist spezifiziert — nicht getestet. Die vitest-Suite deckt
die Rechenlogik ab (Tokenizer, Rezepte, ViewModel, Frontmatter); sie sieht strukturell nicht,
ob das Ergebnis auch im DOM ankommt, ob ein Knopf feuert, ob eine Notiz im Vault landet.
Diese Naht zum Host prüft `scripts/gui-smoke.ts` gegen ein **laufendes** Obsidian
(CORE-TEST-02 b).

## Voraussetzungen

1. **Obsidian mit Debug-Port** — der eine Handgriff, der Handarbeit bleibt (Neustart nötig):

   ```bash
   osascript -e 'quit app "Obsidian"'
   open -a Obsidian --args --remote-debugging-port=9222
   ```

2. **Ein laufender A1111-kompatibler Bildserver** auf dem Endpunkt aus den Plugin-Settings
   (Draw Things, AUTOMATIC1111, Forge, SD.Next) — ein abwesender Server ist kein
   Plugin-Defekt, und der Treiber meldet ihn auch nicht als einen. Er prüft die
   Erreichbarkeit **vorab** und sagt an, was fehlt:

   - **Voller Lauf:** Abbruch mit Ansage — die Punkte 5–11 erzeugen ein echtes Bild.
   - **`--quick`:** läuft weiter, überspringt die Punkte 2, 3 und 4. Gemessen werden 1 und 12
     — die Punkte, die ohne jede Server-Verbindung eine Aussage haben. Punkt 4 gehört dazu,
     obwohl er nur die Bedienbarkeit eines Knopfes prüft: `generateEnabled` verlangt
     `server.kind === "ok"`, der Knopf ist ohne Server also zurecht gesperrt.

   Übersprungene Punkte stehen in der Abschlusszeile (`… · N übersprungen (NICHT gemessen)`),
   damit ein Teil-Lauf nicht als bestandener Smoke zitiert wird. Antwortet der Server dagegen
   **falsch** (HTTP-Fehler, kein Modellname), bleibt es ein Abbruch: das ist ein Befund.

3. **Deployter Stand:**

   ```bash
   OBSIDIAN_PLUGIN_DIR="<vault>/.obsidian/plugins/local-image-generator" npm run deploy
   ```

4. **Für die eingebaute Engine (Punkte 13–16, seit 0.6) ein lokaler Asset-Server** — in einem
   zweiten Terminal `npm run smoke:assets` (serviert `dist-assets/`, also die eigene Konversion
   aus `tools/convert-sd-turbo.sh` plus ORT-WASM, auf `http://127.0.0.1:7862` mit CORS). Die
   Punkte laufen nur mit `--builtin` **und** erreichbarem Asset-Server; sie **löschen die
   Modell-Dateien aus dem Plugin-Cache und laden sie neu** (2,5 GB) — deshalb nie gegen das
   HF-Repo, sondern nur gegen diesen Server. Der Server-Teil (1–11) läuft ohne Bild-Server
   gegen `node scripts/mock-a1111.mjs` (Port 7861, Plugin-Endpunkt darauf stellen).

Dann:

```bash
npm run smoke:gui -- --vault <vault-name>
npm run smoke:gui -- --vault <name> --steps 8 --timeout 1200 --keep
npm run smoke:gui -- --vault <name> --builtin          # + 13–16, braucht npm run smoke:assets
```

`--steps` (Default 4) und die fest kleinste Größe halten den Lauf kurz: geprüft wird die
Kette, nicht die Bildqualität. `--keep` lässt den Smoke-Ordner liegen.

## Was der Treiber prüft

| # | Prüfpunkt | Warum gerade der |
|---|---|---|
| 1 | Hub öffnet sich per Command mit dem Generate-Panel | Lebenszeichen der View-Registrierung |
| 2 | „Verbindung testen" meldet den Modellnamen | Kette Knopf → `checkServer` → Notice |
| 3 | Generate-Panel zeigt den **echten** Modellnamen | Regression zu `1d1c046` (s.u.) |
| 4 | „Generieren" ist mit gesetztem Prompt bedienbar | `generateEnabled` am echten Knopf |
| 5 | Der Klick startet einen sichtbaren Lauf | Statuszeile verlässt „Bereit" |
| 6 | Die Statuszeile bewegt sich während des Laufs | eine eingefrorene Zeile ist von einem Hänger nicht zu unterscheiden |
| 7 | Die Generierung liefert ein Bild in die Karte | Ende-zu-Ende über echtes HTTP |
| 8 | Die Ergebnis-Notiz trägt den echten Modellnamen | **die Nutzlast** von `1d1c046` |
| 9 | Die Ergebnis-Notiz bettet das Bild ein | das Produkt, nicht der Zustand |
| 10 | Historien-Klick stellt Prompt **und** Seed her | Jays 0.2-Befund („merkt sich nur den Prompt") |
| 11 | „Reroll" würfelt neu und startet | der Knopf, der sich vom Nachbarn unterscheiden muss |
| 12 | Die Einstellungen erscheinen in der Settings-**Suche** | der Store-Linter prüft nur, DASS `getSettingDefinitions()` existiert — nicht, ob die Zeilen beim Nutzer ankommen |
| 13 | Engine auf „Eingebaut" — Panel zeigt den Modellzustand, Negativ-Prompt weg, CTA da | der Moduswechsel muss die Regler ehrlich machen (Spec 0.6 §6) |
| 14 | Download über den **Panel**-Knopf endet auf „bereit" | der Zero-Setup-Weg darf nicht in den Settings versteckt sein; Fortschritt muss sichtbar sein |
| 15 | Die eingebaute Engine liefert ein Bild, die Notiz trägt `model: sd-turbo` und `steps ≤ 4` | Ende-zu-Ende ohne Server: Ladephase, Schritte, Rezept-Ehrlichkeit |
| 16 | Zurück auf „Server" bringt die Regler zurück | der Wechsel darf nichts hinterlassen |
| 17 | Die modusabhängigen Regler sind auch **gerendert** weg — und kommen zurück | `getComputedStyle`, nicht `classList`: die Klasse war beim Bug vom 2026-08-21 gesetzt, das CSS zog nicht |

Punkt 12 läuft trotz seiner Nummer im `--quick`-Teil, direkt nach 4: er braucht keine
Generierung. Die Nummer ist ein **Name**, keine Reihenfolge — eine Umnummerierung von 5–11
würde die Befund-Rückverweise weiter unten („Punkt 4 war ein Falsch-Rot", „Punkt 3 und 8")
stillschweigend auf andere Prüfungen zeigen lassen.

Er holt seine Erwartung aus `getSettingDefinitions()` selbst statt aus einer Literal-Liste
— sonst misst er nach dem nächsten Umbenennen oder in einer anderen UI-Sprache am eigenen
Gedächtnis vorbei. (Beim Bau genau das zweimal passiert: gesucht wurde „Ausgabeordner", die
Zeile heißt „Bilderordner" — das las sich zwei Runden lang wie ein Produktdefekt.) Zeilen mit
falschem `visible`-Prädikat sind ausgenommen; sie sollen ja gerade **nicht** auftauchen.
Dazu eine Negativkontrolle: findet die Suche auch einen Unsinnsbegriff, beweist ein Treffer
nichts. Fehlt die Suche ganz (Obsidian < 1.13), wird der Punkt übersprungen statt rot.

**Nicht automatisiert** — dafür bleibt die Hand-Runde: „sieht gut aus", Bildqualität,
Layout-Gefühl, Theme-Ästhetik.

### Warum Punkt 3 und 8 doppelt aussehen, aber nicht dasselbe sind

`1d1c046`: Draw Things meldet das aktive Modell als `model`, A1111/Forge/SD.Next als
`sd_model_checkpoint`. `parseOptionsModel` las nur letzteres → `modelName` blieb `null` →
`main.ts` schrieb via `modelName ?? "unknown"` ein `model: unknown` ins Frontmatter **jeder**
Ergebnis-Notiz, also genau in das Feld, das ein Rezept reproduzierbar machen soll.

Punkt 3 misst die Anzeige, Punkt 8 das Produkt. Der Fehler war auf beiden Ebenen sichtbar,
aber nur Ebene 8 richtet dauerhaften Schaden an: eine falsche Anzeige verschwindet beim
nächsten Blick, ein falsches Frontmatter bleibt in der Notiz stehen.

**Der Treiber holt seine Erwartung selbst vom Server** (eigener `fetch` auf
`/sdapi/v1/options`, `sd_model_checkpoint ?? model`) — er fragt nicht das Plugin. Ein
Prüfwerkzeug, das seine Erwartung aus dem Prüfling bezieht, bestätigt nur dessen Meinung;
genau so blieb der Fehlgriff so lange unentdeckt.

### Warum Punkt 17 nicht in 13 und 16 aufgeht

13 und 16 fragen, ob das Panel den Zustand richtig **setzt**. 17 fragt, ob das CSS ihn auch
**durchsetzt**. Das ist nicht dieselbe Frage: am 2026-08-21 war die Klasse `is-hidden` auf der
Negativ-Prompt-Zeile korrekt gesetzt, 237 Unit-Tests und 16 Smoke-Punkte waren grün — und die
Zeile stand trotzdem im builtin-Modus im Bild, weil `.lig-prompt-row { display: flex }` weiter
unten in `styles.css` stand und bei gleicher Spezifität gewinnt. Ein Prüfpunkt auf
`classList.contains("is-hidden")` kann das prinzipiell nicht sehen: er fragt den Prüfling nach
seiner **Absicht**, nicht nach dem **Ergebnis**.

Punkt 17 hängt deshalb an nichts — kein Download, kein Asset-Server, keine Generierung. Er
wechselt den Modus und liest `getComputedStyle`, und läuft damit auch im `--quick`-Lauf. Ein
CSS-Regressionsschutz, der nur im Vollauf mitläuft, fehlt genau dann, wenn man ihn braucht.

Er misst **beide Richtungen** (builtin versteckt, server bringt zurück): ein Punkt, der nur das
Verstecken prüft, wäre mit einem globalen `display: none !important` zu bestehen.

Zwei Ja-Sager derselben Bauart sind bei der Gelegenheit mit umgestellt worden — der CTA-Knopf in
13 und die Bildkarte in 7 fragten ebenfalls die Klasse statt die gerenderte Sichtbarkeit.

**Die Vorbedingung eines Bugs gehört in den Prüfpunkt, der ihn sucht.** Die Steps-Beschriftung
(zweiter Bug vom 2026-08-21: Regler auf 4, Beschriftung „20") kann nur danebenliegen, wenn der
Browser den Wert beim Sinken von `max` überhaupt klemmt. Mit dem Standardwert 4 blieb der Punkt
in der Gegenprobe **grün, obwohl der Defekt wieder eingebaut war** — er schiebt den Regler
seitdem selbst über das builtin-Maximum und meldet es als Befund, wenn kein Klemmen stattfand.

## Was der Treiber am Wirt verändert (und zurücksetzt)

Alles davon wird vorher gemerkt und im `finally` zurückgeschrieben — auch nach einem Abbruch:

- `createMode` → `"note"` (sonst gäbe es keine Notiz zu prüfen)
- `outputFolder` / `noteFolder` → `_lig-gui-smoke`
- **die Historie** — der Lauf schreibt zwei Einträge, die niemand bestellt hat
- **der Steps-Regler** — Punkt 17 schiebt ihn auf das Server-Maximum, um das Klemmen zu
  erzwingen, und stellt den Vorwert danach wieder her (UI-Zustand, kein Setting: der
  `finally`-Block erfasst ihn nicht)
- `engine` → `"server"` für 1–11 (und zurück), mit `--builtin` außerdem `assetBaseUrl` → der
  lokale Asset-Server; **der Modell-Cache** der eingebauten Engine wird in Punkt 13 geleert und
  in 14 neu gefüllt — er wird NICHT zurückgesetzt (ein Wiederholungslauf überspringt den Download
  nicht, weil 13 ihn wieder leert; das ist Absicht: 14 misst den echten Weg)

Der Ordner `_lig-gui-smoke` wird angelegt und gelöscht. **Existiert er bereits, bricht der
Treiber ab** statt zu löschen: ein vorgefundener Ordner könnte fremde Dateien tragen.

Der Reroll-Lauf (Punkt 11) wird bewusst ausgewartet, bevor die Historie zurückgesetzt wird —
sonst schöbe er seinen Eintrag hinterher nach und der Smoke hinterließe genau das, was er
aufräumen wollte.

## Durchläufe

<!-- Neueste zuerst. CORE-TEST-02 verlangt den festgehaltenen Lauf als Nachweis. -->

### 2026-08-22 · 0.6.1 · Obsidian 1.13.7 · `--quick`, ohne Bild-Server · **3/3 grün, 3 übersprungen**

Lauf zum Bau von Punkt 17. Gemessen wurden 1, 12 und 17; 2–4 übersprungen (kein Server),
5–11 und 13–16 nicht angefordert.

**Mit Gegenprobe** — ohne sie wäre das Grün nicht interpretierbar. Beide Bugs vom 2026-08-21
wurden künstlich wieder eingebaut (`.lig-prompt-row { display: flex }` ans Ende von
`styles.css`; die Spar-Bedingung vor `stepsValueEl.setText`) und der Punkt meldete:

```
✗ 17. … — builtin trotzdem sichtbar: .lig-negative-row → display:flex ·
     Steps-Beschriftung ≠ Regler: „50" bei value 4 (max 4), „50" bei value 4 (max 50)
```

Die Gegenprobe fand dabei einen Defekt **im Prüfpunkt selbst**: im ersten Anlauf blieb die
Steps-Hälfte grün, weil der Regler bei 4 stand und gar nicht geklemmt wurde. Siehe oben,
§ „Warum Punkt 17 nicht in 13 und 16 aufgeht".

Nach dem Rückbau: 3/3 grün, `Steps geklemmt 50 → 4/4, zurück 4/50`.

### 2026-08-21 · 0.6.0 + Kit-0.27.0-Vendoring · Obsidian 1.12.4 · A1111-Mock + lokaler Asset-Server · **16/16 grün**

Nachlauf zum Vendoring-Merge (`7390204`): der Umbau tauschte vier Module gegen ihre
Kit-Fassungen, darunter den Hub — und **beide Live-Treiber waren seitdem nicht gelaufen**.
Baseline: 16/16 vom 2026-08-19. Ergebnis nach zwei Werkzeug-Reparaturen wieder 16/16;
Download der 2,5 GB lokal in 36 s, Bild der eingebauten Engine in 15 s, Notiz `model: sd-turbo`.

Drei Befunde, **alle in den Prüfwerkzeugen, keiner im Plugin** — das Muster dieses Repos hält:

1. **Der erste Lauf maß den falschen Prüfling: 15/16, aber gegen den ALTEN Code.**
   `npm run deploy` kopiert Dateien; Obsidian lädt sie nicht nach. Der DOM trug noch das
   `lig-hub-`-Präfix, während die deployte `main.js` ausschließlich `okit-hub-` enthielt (8×,
   kein einziges `lig-hub-tab`) — Punkt 10 fand seinen Reiter nicht und meldete „keine
   Historien-Zeile". Die Manifest-Version verrät das nicht: sie ist zwischen zwei Bauten
   desselben Standes identisch. **Der Treiber lädt das Plugin jetzt selbst neu** (disable +
   enable, ~1,5 s) und sagt es an: „Plugin neu geladen — gemessen wird der deployte Stand".
   Gegenprobe: eine von Hand auf `lig-hub-tab` zurückgepatchte `main.js` deployt — der DOM zeigte
   VOR dem Reload `okit-hub-tab`, danach `lig-hub-tab`. Der Reload liest also wirklich die Platte.
2. **Punkt 10 war flaky — und die Ursache ist eine echte Verhaltensänderung des Kit-Hubs.**
   `setTab` steigt bei gleichem Tab sofort aus („if (id === navState) return"), also ohne
   `onShow()` und damit ohne `render()`. Der aktive Reiter überlebt im Workspace-State: ab dem
   zweiten Lauf stand er schon auf `history`, der Klick des Prüfpunkts war ein No-op, und die
   Liste zeigte den Stand **vor** dem Lauf — während der neue Eintrag längst im State lag
   (belegt per Instrumentierung: `state[0] = 2096352854@14:19:23`, `dom[0] = 972872909@09:58`).
   Deshalb Lauf 2 grün und Lauf 3 rot, ohne eine Zeile Codeänderung dazwischen. Der Prüfpunkt
   **erzwingt den Wechsel jetzt** (erst `generate`, dann `history`) statt ihn anzunehmen.
   Verifiziert im hergestellten Defektzustand (Reiter vorher auf `history` gesetzt): 12/12.
3. **`scripts/mock-assets.mjs` starb an einer Verzeichnis-Anfrage.** Ein `curl` auf `/` ließ
   `createReadStream` mit EISDIR ein unbehandeltes `error`-Event werfen — der Server war weg,
   und der nächste Download des Prüflings hätte eine tote Verbindung gesehen. Verzeichnisse
   sind jetzt 404.

Nicht gelaufen: `npm run shots`. Die Bilder brauchen den Aufnahme-Vault (Vault-Wechsel im
laufenden Obsidian) und einen echten Bild-Server — gegen den Mock entstünden Mock-Motive in der
README. Gemessen wurde stattdessen gezielt die Geometrie, wegen der `scripts/shots.ts:338`
bewusst `.okit-hub-content` aufnimmt: die Box ist 216 × 832 (nicht 0), das Panel scrollt jetzt
selbst (`overflow-y: auto`, `scrollHeight` 4384 bei 832 sichtbar), `.lig-hist-list` misst
4290 statt 0. Die Selektorwahl des Rezepts bleibt damit richtig; der Bildlauf selbst steht aus.

### 2026-08-19 · 0.6.0-dev · Obsidian 1.12.4 · A1111-Mock + **echtes HF-Repo** (`v6t2b9/local-image-generator-models`) · **16/16 grün**

Freigabe-Lauf für 0.6.0 mit `--assets https://huggingface.co/v6t2b9/local-image-generator-models/resolve/main`:
Download der 2,5 GB aus dem Netz in **1169 s** (~2,2 MB/s), SHA-256 aller sechs Dateien gegen
das Manifest bestanden, Bild 8 s, Notiz `model: sd-turbo`. Die Download-Frist des Prüfpunkts
wurde dafür von 15 auf 30 min angehoben (ein erster Versuch endete bei ~10 min, weil der
Treiber-Autor das Plugin währenddessen neu lud — Eigenverschulden, kein Befund).

### 2026-08-19 · 0.6.0-dev · Obsidian 1.12.4 (Electron 39) · A1111-Mock + lokaler Asset-Server · **16/16 grün**

Erster Lauf mit den Punkten 13–16 (eingebaute Engine, Spec 0.6). Baseline: 12/12 vom
2026-08-18 (`598f050`). Server-Teil gegen `scripts/mock-a1111.mjs`, Engine-Teil gegen
`scripts/mock-assets.mjs` mit der eigenen SD-Turbo-Konversion. Gemessen: Download + SHA-256 der
2,5 GB in 30 s (lokal), Bild der eingebauten Engine in 10 s (warm; kalt 19,5 s mit 8 s
Modell-Laden), Notiz `model: sd-turbo`, `steps: 4`. Der Lauf wurde **ohne** Plugin-Reload
zwischen zwei Läufen gefahren — absichtlich der härteste Fall.

Drei Befunde in den Prüfwerkzeugen, keiner im Plugin:

1. **Punkt 14 endete sofort rot**, weil das Poll-Prädikat `not-downloaded` als Endzustand nahm —
   das war der **Start**zustand. Jetzt gilt er erst nach gesehenem Fortschritt (Abbruch) als Ende.
2. **Punkt 7 nahm das Bild des vorigen Laufs.** Ohne Reload zeigt die Karte noch das letzte Bild;
   „ist ein Bild da" war grün, bevor der neue Lauf fertig war — 8 las die alte Notiz-Quelle
   (`model: sd-turbo` statt Mock), 10 klickte in eine Historie ohne den neuen Eintrag. Dieselbe
   Falle wie beim Aufnahme-Rezept am 2026-08-17. Punkt 7 und 15 verlangen jetzt ein **neues** Bild
   (Signatur vor dem Klick gemerkt).
3. **Der A1111-Mock lieferte für jeden Seed dieselben Bytes** — damit gab es nie ein „neues" Bild,
   Punkt 7 saß die Frist ab. Der Mock ist jetzt seed-treu wie ein echter Server.

### 2026-08-17 · 0.5.2 · Obsidian 1.13.7 · Draw Things, FLUX.2 klein 9B · **12/12 grün**

**Der erste vollständige Freigabe-Smoke seit 0.5.0.** Alle zwölf Prüfpunkte grün, darunter
erstmals die ganze Generierungs-Kette: Bild in der Karte (280 KB Data-URL), Ergebnis-Notiz
mit `model: flux_2_klein_9b_kv_f16.ckpt` im Frontmatter, eingebettetes Bild, Historien-Klick
stellt Prompt **und** Seed wieder her, Reroll würfelt neu (1292222129 → 169117011) und
startet.

Möglich wurde das, nachdem in Draw Things ein Modell aktiviert wurde, das der Server auch
laden kann — der Lauf davor scheiterte an einem Modellnamen, den die App meldete und die
Engine nicht kannte.

Vault-Zustand nachher geprüft: kein `_lig-gui-smoke`, Settings auf den echten Werten,
Historie unverändert bei 20 Einträgen.

### 2026-08-17 · 0.5.2 · Obsidian 1.13.7 · Draw Things **mit** API, aber ohne ladbares Modell

**7 grün, 1 rot, 4 nicht erreicht.** Erstmals seit dem 2026-08-06 wieder gegen einen
erreichbaren Server gefahren: **Punkt 2 und 3 sind gemessen** (Verbindungstest und echter
Modellname, beide grün). Punkt 7 ist rot — und das ist ein Zustand des Servers, nicht des
Prüflings: Draw Things meldet unter `/sdapi/v1/options` das Modell `flux_2_dev_i8x.ckpt`,
weist es bei `/sdapi/v1/txt2img` aber mit **HTTP 422 „Unrecognized model name"** zurück. Die
Datei existiert nicht mehr; im Modellordner liegt `flux_2_klein_9b_kv_f16.ckpt`. Das aktive
Modell lässt sich nur in der App wechseln (`POST /sdapi/v1/options` → 404).

**Das Plugin verhält sich dabei richtig**: die Statuszeile zeigt binnen Sekunden
„Fehler: txt2img HTTP 422", kein Hänger, kein stiller Fehlschlag.

**Zwei Befunde im Treiber** — beide erst durch diesen Serverzustand sichtbar:

1. **Punkt 5 meldete grün, obwohl nie ein Lauf startete.** Er prüfte „Text ≠ Bereit", und ein
   Fehlertext erfüllt das. Der Prüfpunkt kannte nur ein falsches Ende (Statuszeile bewegt sich
   nicht), nicht das zweite (sie bewegt sich in einen Fehler).
2. **Punkt 7 saß die volle Frist ab — zwanzig Minuten**, während der Grund die ganze Zeit in
   der Statuszeile stand. Schlimmer als die Wartezeit war die Meldung: „kein Bild innerhalb
   der Frist" liest sich wie ein langsamer Server und verschweigt, dass der Prüfling den
   Grund längst genannt hatte.

Beide haben jetzt **zwei Ausgänge** (dieselbe Regel wie beim Server-Guard, CORE-TEST-02 g):
Punkt 5 ist rot, wenn der „gestartete Lauf" ein Fehlertext ist; Punkt 7 bricht ab, sobald das
Plugin einen Fehlschlag meldet, und zitiert ihn. Verifiziert im selben Lauf: aus zwanzig
Minuten Frist wurden Sekunden, und die rote Zeile nennt jetzt den Servertext.

**Offen bleiben 8–11** (Ergebnis-Notiz, Bild-Einbettung, Historien-Klick, Reroll). Sie
brauchen ein erzeugtes Bild — also ein Modell, das der Server auch laden kann.

Vault-Zustand nachher geprüft: kein `_lig-gui-smoke`, Settings auf den echten Werten,
Historie unverändert bei 20 Einträgen.

### 2026-08-17 · 0.5.2 · Obsidian 1.13.7 · **ohne** Bild-Server (nach der Brücken-Migration)

`--quick`: **2/2 grün · 3 übersprungen** — identisch zum Lauf vom 2026-08-14. Der Treiber
trägt die CDP-Brücke seit diesem Lauf nicht mehr inline, sondern importiert sie aus
`obsidian-plugins/tools/obsidian-cdp/`; `attachTo("workspace", …)` wählt das Fenster jetzt
über die Sache (nur das Hauptfenster hat einen Workspace) statt über den lokalisierten
Titel. Beim Anschluss fielen zwei Typfehler **in der zentralen Brücke** auf, die nur unter
`noUncheckedIndexedAccess` sichtbar sind — dort behoben, nicht hier umgangen.

**Weiterhin offen: der vollständige Freigabe-Smoke** (Punkte 2, 3 und 5–11). Er braucht
einen laufenden Bild-Server; Draw Things' API-Server ist nur in dessen Oberfläche
einschaltbar (die App rendert in Metal — weder Menübefehl noch Voreinstellung auf der
Platte, per Skript nicht erreichbar).

### 2026-08-14 · 0.5.2 · Obsidian 1.13.7 · **ohne** Bild-Server

**`--quick`: 2/2 grün · 3 übersprungen.** Punkt 12 lief hier zum ersten Mal überhaupt im
Treiber — er war beim Bau (2026-08-06) nie ausgeführt worden, weil der Server tot war und
der Treiber deshalb schon vor dem ersten Prüfpunkt abbrach. Ergebnis: **6/6 Settings-Zeilen
in der Suche**, Negativkontrolle sauber. Damit ist die Wirkung der Settings-Migration am
Produkt gemessen, nicht nur am Store-Urteil abgelesen.

**Gegenprobe** (eigenes `getSettingDefinitions()` umbenannt, deployt, Plugin per CDP neu
geladen): **Punkt 12 rot, Punkt 1 grün** — kein Kollateralschaden. Danach zurückgesetzt,
neu deployt, neu geladen: wieder grün. Der Prüfpunkt ist als Detektor belegt.

**Zwei Befunde im Treiber**, beide durch den Server-Guard aufgedeckt:

1. **Punkt 4 war server-abhängig, ohne es zu wissen.** Der erste Lauf mit Guard meldete ihn
   rot („Knopf ist gesperrt") — zu Unrecht: `generateEnabled` verlangt `server.kind === "ok"`
   (`src/core/viewmodel.ts`), ohne Server ist der Knopf zurecht tot. Der Prüfpunkt warf dem
   Plugin also vor, die fehlende Umgebung korrekt abzubilden. Jetzt wird er mit übersprungen.
2. **Der Typ-Guard von Punkt 12 war toter Code.** `typeof tab.getSettingDefinitions ===
   "function"` ist unter 1.13 **immer** wahr: Obsidian bringt die Methode in
   `PluginSettingTab` selbst mit. Aufgefallen erst an der Gegenprobe — nach dem Rückbau hiess
   die eigene Methode anders, und der Ausdruck blieb trotzdem wahr. Geprüft wird jetzt, ob
   das Plugin sie auf dem Prototyp seiner Klasse **selbst definiert**; genau das meint der
   Store-Linter. Zudem war dieser Fall als `skip` geführt — der gesuchte Defekt wäre als
   Nichtmessung verbucht worden, die Gegenprobe hätte ihn nicht rot gesehen.

Der Vault-Zustand nachher geprüft: kein `_lig-gui-smoke`, Settings auf den echten Werten,
Historie unverändert bei 20 Einträgen, `community-plugins.json` unberührt (das Plugin war in
Pallas deaktiviert und wurde per `enablePlugin()` nur in den Speicher geladen — das
persistiert nicht).

### 2026-08-06 · 0.5.0 (Freigabe-Smoke) · Obsidian 1.13.5 · Draw Things, FLUX.2 dev int8

**Voller Lauf: 10/11 grün.** Rot war allein Punkt 2 — und das war ein Fehler im Treiber,
nicht im Plugin (s.u.). Nach der Korrektur `--quick`: 4/4.

**Gegenprobe** (den Fix aus `1d1c046` zurückgebaut, deployt, Plugin per CDP neu geladen):
**2/4** — genau die Punkte 2 und 3 rot, mit dem historischen Symptom im Text („Modell: –",
„Platzhalter statt Name"). Punkte 1 und 4 blieben grün: kein Kollateralschaden. Damit ist
der Smoke als Detektor belegt, nicht nur grün gelaufen.

Nachher geprüft: `_lig-gui-smoke/` entfernt, `createMode`/`outputFolder`/`noteFolder`
zurückgesetzt, Historie wieder bei 20 Einträgen ohne Smoke-Reste.

**Drei Befunde im Treiber selbst** — die Ausbeute, für die es den Gegenprobe-Schritt gibt:

1. **Das Settings-Modal öffnet in einem anderen Fenster.** Sind mehrere Obsidian-Fenster
   desselben Vaults offen, hängt `app.setting.open()` das Modal ins aktuelle Fenster der
   App — nicht zwingend in das, an dem CDP klebt. `document.querySelectorAll(".modal")`
   blieb leer, während `app.setting.activeTab.id` korrekt gesetzt war. Das las sich als
   „Modal hat sich nicht geöffnet" und sah wie ein Plugin-Defekt aus. Gegriffen wird jetzt
   am Tab-Container; die Notice wird über alle beteiligten Dokumente gesucht.
2. **Punkt 4 war ein Falsch-Rot.** Der Prüfpunkt setzte ein Rezept, das zeichengleich dem
   Bild des vorigen Laufs entsprach — `recipeUnchanged` sperrt den Generate-Knopf dann
   völlig zu Recht. Der Prüfpunkt stellt seine Voraussetzung jetzt selbst her (Würfel-Knopf).
3. **Namenskollision mit dem eingespleißten `waitFor`.** Eine eigene Warteschleife neben
   einem `waitFor()` darf ihre Variable nicht `deadline` nennen — sonst SyntaxError, der
   als „Renderer: Uncaught" ankommt. Deshalb liest `evaluate()` jetzt auch
   `exceptionDetails.exception.description`: eine Fehlermeldung ohne Inhalt macht blind.

**Offen:** Der Detektor von Punkt 8 (Frontmatter-Modellname) ist nicht live gegengeprüft —
das bräuchte einen vollen Lauf mit zurückgebautem Fix (~20 min). Strukturell ist er
abgesichert (eigener `note === null`-Zweig, frischer Ordner pro Lauf, Vergleich gegen das
Server-Orakel); die Gegenprobe steht beim nächsten vollständigen Lauf aus.
