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
   (Draw Things, AUTOMATIC1111, Forge, SD.Next). Fehlt er, **bricht der Treiber ab**, statt
   rote Prüfpunkte zu melden — ein abwesender Server ist kein Plugin-Defekt.

3. **Deployter Stand:**

   ```bash
   OBSIDIAN_PLUGIN_DIR="<vault>/.obsidian/plugins/local-image-generator" npm run deploy
   ```

Dann:

```bash
npm run smoke:gui -- --vault <vault-name>
npm run smoke:gui -- --vault <name> --steps 8 --timeout 1200 --keep
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

## Was der Treiber am Wirt verändert (und zurücksetzt)

Alles davon wird vorher gemerkt und im `finally` zurückgeschrieben — auch nach einem Abbruch:

- `createMode` → `"note"` (sonst gäbe es keine Notiz zu prüfen)
- `outputFolder` / `noteFolder` → `_lig-gui-smoke`
- **die Historie** — der Lauf schreibt zwei Einträge, die niemand bestellt hat

Der Ordner `_lig-gui-smoke` wird angelegt und gelöscht. **Existiert er bereits, bricht der
Treiber ab** statt zu löschen: ein vorgefundener Ordner könnte fremde Dateien tragen.

Der Reroll-Lauf (Punkt 11) wird bewusst ausgewartet, bevor die Historie zurückgesetzt wird —
sonst schöbe er seinen Eintrag hinterher nach und der Smoke hinterließe genau das, was er
aufräumen wollte.

## Durchläufe

<!-- Neueste zuerst. CORE-TEST-02 verlangt den festgehaltenen Lauf als Nachweis. -->

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
