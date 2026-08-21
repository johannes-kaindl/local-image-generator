# Aufnahme-Vertrag — README-Bilder

Was welches Bild zeigen muss, womit es entsteht und was dafür laufen muss. Der Vertrag ist
die Quelle: `scripts/shots.ts` fährt ihn, `readme_lint.py` prüft ihn gegen die Dateien und
gegen beide READMEs.

Erzeugen: `npm run shots -- --setup` (Vault bauen), Obsidian neu starten, dann
`npm run shots` bzw. `npm run shots -- --only <datei>`. Prüfen: `npm run shots:check`.

## Der Grundsatz: die Bilder zeigen den Auslieferungszustand

Seit 0.6 hat das Plugin **zwei Backends**, und der Default ist die **eingebaute Engine**
(SD-Turbo im Renderer). Ein neu installiertes Plugin steht also im builtin-Modus, ohne
geladenes Modell und ohne konfigurierten Server. Genau diesen Weg zeigen die Bilder.

Bis 0.6 zeigten sie den Server-Modus — historisch richtig (0.5 war ein reiner Thin Client),
seit 0.6 aber die Ausnahme statt der Regel. Der Server bekommt deshalb **ein** Bild, das
seinen Einstieg zeigt; sein Ergebnis sieht aus wie jedes andere Ergebnis, ein zweites
Bilderpaar dafür wäre Wiederholung.

**Nebeneffekt, der die Aufnahme trägt:** die builtin-Motive brauchen keinen fremden Server.
Der Lauf ist damit auf jeder Maschine mit WebGPU reproduzierbar, statt an einer App zu
hängen, deren API sich nur von Hand einschalten lässt.

## Was der Lauf voraussetzt

1. **Obsidian mit Debug-Port** und geöffnetem Aufnahme-Vault (`--setup` baut ihn unter
   `$STAGING_VAULTS_DIR/local-image-generator`), Oberflächensprache **Englisch**.
2. **WebGPU mit `shader-f16`** — sonst zeigt das Panel statt der Regler den Hinweis
   `empty.gpuMissing`. Der Treiber prüft das vorab und bricht mit Klartext ab.
3. **Das Modell** (SD-Turbo, ~2,5 GB) muss für alle Motive außer `first-run.png` geladen
   sein. Der Treiber lädt es über den **echten** Weg — den `Download model`-Knopf des Panels
   gegen die voreingestellte Quelle. Kein lokaler Ersatz-Server: der Cache-Schlüssel ist zwar
   basisunabhängig, aber ein Bild soll den Weg dokumentieren, den auch der Nutzer geht.
   Einmal geladen bleibt das Modell im app-weiten Cache; Folgeläufe kosten die Zeit nicht.

   ⚠️ **`first-run.png` räumt den Cache dafür weg** (`removeModel()`) — es ist das einzige
   Motiv, das den leeren Zustand zeigt, und der lässt sich nicht vortäuschen. Ein Volllauf
   lädt die 2,5 GB deshalb jedes Mal neu. Wer nur ein Panel-Bild nachzieht, nimmt
   `npm run shots -- --only generate-panel.png`.
4. **Kein Bild-Server.** Die Endpunkt-Einstellung bleibt leer — genau deshalb steht das
   Plugin im builtin-Modus (`resolveEngine`: leerer Endpunkt → `builtin`).

## Bilder

### Ohne Erzeugung — der Zustand direkt nach der Installation

| Datei | Klasse | referenziert von | muss zeigen |
|---|---|---|---|
| `first-run.png` | detail (380 px) | `README.md`, `README.de.md` | Den Generate-Reiter **wie ein neuer Nutzer ihn beim ersten Öffnen sieht**: Prompt-Feld, Stil-Chips, Regler — und darunter den Onboarding-Hinweis „The built-in model (SD-Turbo, 2.5 GB) is not downloaded yet. Nothing is downloaded before you click." samt dem Knopf `Download model (2.5 GB)`. Der zugesagte Satz steht damit im Bild statt nur in der README. **Dieses Motiv bestimmt die Reihenfolge des ganzen Laufs**: es braucht einen leeren Modell-Cache, jedes andere braucht ihn gefüllt. |
| `generate-panel.png` | feature (456 px) | `README.md`, `README.de.md` | Denselben Reiter im **benutzbaren** Zustand: beide Reiter des Hubs, Prompt-Feld mit Platzhalter „Describe the image…", die Stil-Chips, die Regler `Steps` und `Seed`, der aktive `Generate`-Knopf und die Statuszeile `Model: SD-Turbo (built-in)`. **Dass `Negative prompt`, `Guidance (CFG)` und `Size` fehlen, ist die Aussage des Bildes**, kein Ausschnittfehler: die eingebaute Engine kann sie nicht, und das Panel zeigt keine Regler ohne Wirkung (`vm.controls`). Wer den Vergleich sucht: im Server-Modus sind sie da. |
| `style-chips.png` | detail (380 px) | `README.md`, `README.de.md` | Nur die Stil-Leiste („Styles") mit den mitgelieferten Chips. Zeigt das Merkmal, das den Prompt-Aufbau abkürzt: ein Klick hängt den Stiltext an den Prompt an. Backend-unabhängig — dieses Bild ändert sich mit 0.6 nicht. |
| `settings.png` | feature (515 px) | `README.md`, `README.de.md` | Den Einstellungen-Tab **ganz**, im builtin-Modus: den Abschnitt `Engine` mit dem Umschalter auf `Built-in (SD-Turbo)` und der Modell-Zeile (Größe, `Download`/`Remove`, Zustand `Ready`), darunter Bilder- und Notizordner, `Create button`, Standard-Schrittzahl, die editierbare Stil-Liste und unter `Advanced` die Zeile `Download source`. **Die Server-Endpunkt-Zeile fehlt hier zu Recht** — sie erscheint erst bei `Engine: Server` (bedingte Zeilen werden weggelassen, nicht ausgegraut). **Ausgeblendet wird genau eine Zeile:** der Aufräumer für SD-Turbo-Altgewichte aus der Zeit vor 0.5. Er erscheint nur, wenn im app-weiten Cache noch solche liegen — beim Maintainer ja, in einer frischen Installation nie. Ohne diesen Eingriff zeigte das Bild die Aufnahme-Umgebung statt des Produkts. |
| `settings-server.png` | detail (380 px) | `README.md`, `README.de.md` | Nur den Abschnitt `Engine` mit dem Umschalter auf `Server (Draw Things / A1111)` und der dann erscheinenden Endpunkt-Zeile samt `Test connection`. Das eine Bild des zweiten Wegs: es zeigt, **dass** es ihn gibt und wo er anfängt. Es braucht keinen laufenden Server — die Zeile erscheint unabhängig davon, ob etwas antwortet; der Verbindungstest wird nicht geklickt, ein rotes Ergebnis wäre eine Aussage über die Aufnahme-Maschine, nicht über das Produkt. |

### Mit erzeugtem Bild — die eingebaute Engine bei der Arbeit

Diese drei entstehen gegen die eingebaute Engine (SD-Turbo, 512×512, 4 Steps). **Die Seeds
stehen fest im Rezept**: zwei Aufnahmen sollen dasselbe Bild ergeben, und ein Bild mit
gewürfeltem Zustand ist kein reproduzierbares Bild.

| Datei | Klasse | referenziert von | muss zeigen |
|---|---|---|---|
| `hero.png` | hero (600 px) | `README.md`, `README.de.md` | Das ganze Obsidian-Fenster: die Notiz mit dem fertigen Bild in der Mitte, rechts das Panel mit demselben Ergebnis samt Prompt, Schritten und Seed sowie der Statuszeile `Model: SD-Turbo (built-in)`. Das Verkaufsbild — es zeigt in einem Blick, wofür es das Plugin gibt, und dass dafür nichts außerhalb von Obsidian laufen muss. |
| `history.png` | detail (456 px) | `README.md`, `README.de.md` | Den History-Reiter mit **mehreren echten Läufen**, je Zeile Prompt, Seed, Schrittzahl und Uhrzeit, dazu die Umschalter „Recent / By prompt" und „Clear all". Verschiedene Seeds je Zeile: zwei gleiche sähen aus wie ein Copy-Paste-Fehler. |
| `result-note.png` | feature (496 px) | `README.md`, `README.de.md` | Eine Ergebnis-Notiz: das Rezept im Frontmatter (`prompt`, `seed`, `steps`, `model`, Maße, Bilddatei) und darunter das eingebettete Bild. Der Ausschnitt wird im Rezept auf H/B ≤ 1.55 begrenzt, damit die Klassen-Grenze hält, ohne nachträglich zu schneiden. |

**Was der Lauf dafür am Prüfling tut** — und warum das keine Kosmetik ist: Er klickt den
`Download model`-Knopf und wartet, bis das Modell geprüft im Cache liegt; ohne das bleibt
`Generate` gesperrt und das Rezept wartet auf ein Bild, das nicht kommen kann. Für `hero`
schaltet er `createMode` auf `note` (sonst gäbe es keine Notiz), für `history` zurück auf
`image`. Alles davon ist Nutzer-Konfiguration, kein Produktverhalten.

## Fixture

`docs/images/fixture/` — getrackt, damit jeder Lauf denselben Vault sieht:

- `notes/` — zwei generische englische Beispielnotizen. Keine echten Namen, Firmen, Nummern.
- `obsidian/` — Vault-Konfiguration, die **nur dieses Plugin** aktiviert (fremde Ribbon-Icons
  malen sonst in jedes Bild), Theme hell, Inline-Titel aus.

Plugin-Settings trägt das Fixture bewusst **nicht**: `--setup` löscht `data.json`, das Plugin
startet also mit seinen eigenen Vorgaben. Die Bilder sollen zeigen, was ein Nutzer nach der
Installation sieht — nicht, was der Treiber gesetzt hat. Einzige Ausnahme ist die Breite der
rechten Sidebar (440 px statt ~300): sie ist Nutzer-Sache, kein Produktmerkmal, und in der
Vorgabebreite sind die Reglerzeilen im Bild unlesbar.

**Das Modell gehört nicht ins Fixture.** Es liegt im app-weiten Cache, nicht im Vault, und
2,5 GB sind nichts, was ein Repo trägt. `--setup` lässt es deshalb in Ruhe — der erste Lauf
auf einer neuen Maschine lädt es einmal, jeder weitere findet es vor.
