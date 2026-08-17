# Aufnahme-Vertrag — README-Bilder

Was welches Bild zeigen muss, womit es entsteht und was dafür laufen muss. Der Vertrag ist
die Quelle: `scripts/shots.ts` fährt ihn, `readme_lint.py` prüft ihn gegen die Dateien und
gegen beide READMEs.

Erzeugen: `npm run shots -- --setup` (Vault bauen), Obsidian neu starten, dann
`npm run shots` bzw. `npm run shots -- --only <datei>`. Prüfen: `npm run shots:check`.

## Was der Lauf voraussetzt

1. **Obsidian mit Debug-Port** und geöffnetem Aufnahme-Vault (`--setup` baut ihn unter
   `$STAGING_VAULTS_DIR/local-image-generator`), Oberflächensprache **Englisch**.
2. **Für die server-abhängigen Motive: ein laufender A1111-kompatibler Bild-Server** auf dem
   Endpunkt aus den Plugin-Settings (Draw Things, AUTOMATIC1111, Forge, SD.Next).
   Das Plugin erzeugt selbst keine Bilder — ohne Server gibt es kein Ergebnis zu zeigen, und
   der `Generate`-Knopf ist zurecht gesperrt (`generateEnabled` verlangt `server.kind === "ok"`).
   Der Treiber prüft die Erreichbarkeit vorab und **überspringt** diese Motive mit Ansage,
   statt leere Kästen aufzunehmen.

Draw Things' API-Server lässt sich nur in dessen Oberfläche einschalten (die App rendert in
Metal, sie hat dafür weder Menübefehl noch Voreinstellung auf der Platte) — dieser Schritt
bleibt Handarbeit.

## Bilder

| Datei | Klasse | referenziert von | muss zeigen |
|---|---|---|---|
| `generate-panel.png` | feature (456 px) | `README.md`, `README.de.md` | Den Generate-Reiter des Hubs im Zustand **direkt nach der Installation**: beide Reiter, Prompt-Feld mit Platzhalter „Describe the image…", Negativ-Prompt, die Stil-Chips, die Regler `Size` / `Steps` / `Guidance (CFG)` / `Seed` — und darunter den Onboarding-Hinweis samt Statuszeile „No image server configured". Dass der `Generate`-Knopf dabei ausgegraut ist, gehört zum Bild: ohne Server ist er zurecht gesperrt, und ein vorgetäuschter Verbindungszustand wäre eine Behauptung. |
| `style-chips.png` | detail (380 px) | `README.md`, `README.de.md` | Nur die Stil-Leiste („Styles") mit den mitgelieferten Chips. Zeigt das Merkmal, das den Prompt-Aufbau abkürzt: ein Klick hängt den Stiltext an den Prompt an. |
| `settings.png` | feature (515 px) | `README.md`, `README.de.md` | Den Einstellungen-Tab **ganz**: Server-Endpunkt mit `Test connection`, Bilder- und Notizordner, `Create button`, Standard-Schrittzahl und die editierbare Stil-Liste. **Ausgeblendet wird dabei genau eine Zeile** — der Aufräumer für SD-Turbo-Altgewichte. Er erscheint laut `visible`-Prädikat nur, wenn im app-weiten Cache noch Gewichte aus der Zeit vor 0.5 liegen; auf dem Rechner des Maintainers ist das so, in einer frischen Installation nie. Ohne diesen Eingriff zeigte das Bild die Aufnahme-Umgebung statt des Produkts. |

### Die drei Motive mit erzeugtem Bild

Sie brauchen einen laufenden Bild-Server und entstanden am 2026-08-17 gegen Draw Things
(`flux_2_klein_9b_kv_f16.ckpt`, 4 Steps, 512×512). Die Seeds stehen fest im Rezept: zwei
Aufnahmen sollen dasselbe Bild ergeben.

| Datei | Klasse | referenziert von | muss zeigen |
|---|---|---|---|
| `hero.png` | hero (600 px) | `README.md`, `README.de.md` | Das ganze Obsidian-Fenster: die Notiz mit dem fertigen Bild in der Mitte, rechts das Panel mit demselben Ergebnis samt Prompt, Größe, Schritten, Guidance und Seed. Das Verkaufsbild — es zeigt in einem Blick, wofür es das Plugin gibt. |
| `history.png` | detail (456 px) | `README.md`, `README.de.md` | Den History-Reiter mit **mehreren echten Läufen**, je Zeile Prompt, Seed, Schrittzahl und Uhrzeit, dazu die Umschalter „Recent / By prompt" und „Clear all". Verschiedene Seeds je Zeile: zwei gleiche sähen aus wie ein Copy-Paste-Fehler. |
| `result-note.png` | feature (496 px) | `README.md`, `README.de.md` | Eine Ergebnis-Notiz: das Rezept im Frontmatter (`prompt`, `seed`, `steps`, `cfg`, `model`, Maße, Bilddatei) und darunter das eingebettete Bild. Der Ausschnitt wird im Rezept auf H/B ≤ 1.55 begrenzt, damit die Klassen-Grenze hält, ohne nachträglich zu schneiden. |

**Was der Lauf dafür am Prüfling tut** — und warum das keine Kosmetik ist: Er setzt den
Endpunkt und ruft `checkServer()`, weil `generateEnabled` `server.kind === "ok"` verlangt;
ohne diesen Aufruf bleibt der Knopf gesperrt und das Rezept wartet auf ein Bild, das nicht
kommen kann. Für `hero` schaltet er `createMode` auf `note` (sonst gäbe es keine Notiz),
für `history` zurück auf `image`. Alles davon ist Nutzer-Konfiguration, kein
Produktverhalten.

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
