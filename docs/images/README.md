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

### Offen — brauchen einen laufenden Bild-Server

Diese Motive stehen bewusst hier statt zu fehlen; `shots:check` meldet sie bei jedem Lauf,
bis sie aufgenommen sind.

| Datei | Klasse | muss zeigen | Stand |
|---|---|---|---|
| `hero.png` | hero | Das ganze Obsidian-Fenster: Hub rechts mit fertigem Bild in der Ergebnis-Karte, daneben die Notiz, in die es eingefügt wurde. Das Verkaufsbild — es zeigt in einem Blick, wofür es das Plugin gibt. | offen (2026-08-17): kein Bild-Server verfügbar |
| `history.png` | detail | Den History-Reiter mit mehreren echten Läufen — Prompt-Zeile, Seed und Parameter je Eintrag, gruppiert. Muss echte Läufe zeigen: ein nachgebauter Verlauf wäre eine Behauptung über ein Ergebnis, das nie erzeugt wurde. | offen (2026-08-17): kein Bild-Server verfügbar |
| `result-note.png` | feature | Eine Ergebnis-Notiz im Vault: eingebettetes Bild plus das Rezept im Frontmatter (`model`, `seed`, `steps`, `cfg`) — der Teil, der einen Lauf reproduzierbar macht. | offen (2026-08-17): kein Bild-Server verfügbar |

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
