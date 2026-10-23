# Entscheidungen in local-image-generator — das Warum

Verdichtete Design-Essenz zu den Regeln im Kern (`AGENTS.md`) und in `.claude/rules/`; die Herleitungen liegen im Coding-Cockpit des Maintainers. Vor dem Übernehmen einer Altentscheidung gilt Johannes' Regel: Grund aufsuchen, messen, ob er heute trägt, Ergebnis melden.

## Der HF-Namespace ist eine Vertrauenszusage

**Der Namespace ist eine Vertrauenszusage, kein Detail:** die URL steht als Platzhalter der
  Settings-Zeile „Download source" im Bild, und wer 2,6 GB laedt, gleicht den Namen mit dem
  Plugin-Autor ab — er wurde deshalb am 2026-08-21 auf `johannes-kaindl` gezogen, damals
  identisch mit dem GitHub-Profil.
  ✅ **Die Kopplung gilt wieder (seit 2026-09-24, gemessen 2026-10-16):** `authorUrl` zeigt auf `https://github.com/johannes-kaindl` und damit auf denselben Account wie der HF-Namespace. Vom 03. bis 24.09.2026 zeigte sie auf `https://jkaindl.de`, weil das GitHub-Konto geflaggt war; das ist Chronik.
  **HuggingFace ist davon NICHT betroffen** — eigener Dienst, eigenes Konto; das Modell-Repo
  antwortet unveraendert (gemessen 2026-09-03: 200 auf das Repo, 307 aufs CDN). Der HF-Namespace
  bleibt deshalb, wie er ist: ein Umzug wuerde jede Bestandsinstallation ins Leere laden
  (`assetBaseUrl` ist ein gespeichertes Setting, s. u.) und loeste ein Problem, das es nicht
  gibt. Das alte `v6t2b9/…` bleibt online: `assetBaseUrl` ist ein GESPEICHERTES
  Setting, eine 0.6.0-Installation traegt die alte URL in ihrer `data.json` und wuerde nach
  einem Repo-Umzug ins Leere laden.

## Vertrieb: Community-Store und Sideloader (Stand 2026-10-16)

Der Ausstieg aus GitHub und dem Community-Store vom 02. bis 24.09.2026 ist aufgehoben (Dach `.claude/rules/release-und-store.md`): Das GitHub-Konto ist wieder frei, das `github`-Remote steht (`git@github.com:johannes-kaindl/local-image-generator.git`), `npm run release` läuft ohne `--no-github`, das Repo steht nicht mehr in `tools/mirror_drift_check.py::AUSNAHMEN`, das GitHub-Repo ist öffentlich und `local-image-generator` steht in `community-plugins.json` (alles gemessen 2026-10-16).

GitHub bekommt Branch und Tag nur über den Dual-Push von `release.mjs`, es gibt keinen Forgejo-Push-Mirror; der Tag stößt `release.yml` an. Daneben bleibt der eigene Weg: `anysource-sideloader` installiert aus Releases jeder Forge, das Plugin steht im Katalog `obsidian-catalog` (Generator `tools/catalog/build_catalog.py` im Dach). Der Rescan im Developer Dashboard ist eine URL (`store_rescan.py`, Dach-AGENTS); öffnen muss ihn Johannes.

## Store-Scorecard (gemessen 2026-08-30, Release 0.10.0)

**Health `Excellent` · Review `Passed`** — zum SECHSTEN Mal in Folge, zum dritten Mal mit
**zero warnings**. Keine `low`/`medium`/`high`-Befunde.

**Die Befundliste ist gegenueber 0.8.0 UNVERAENDERT — Zeile fuer Zeile, in beiden Kategorien.**
Das ist die eigentliche Messung dieser Runde, denn 0.9.0 hat einiges hinzugefuegt, das nach
„das kostet bestimmt eine Warnung" aussieht: ein ZWEITES eingebautes Modell mit **7,0 GB**
Download, ein UNet, das als **13 External-Data-Buckets** geladen wird, ein Bestaetigungsdialog
vor dem grossen Download und ein Modellteil, der bewusst in fp32 ausgeliefert wird. Der Scanner
bewertet davon **nichts** — weder Groesse noch Stueckelung noch die Zahl der Dateien.
`Plugin references unrecognized WASM files` stand schon vorher da und ist nicht gewachsen.

**Kostensatz, der ueber dieses Plugin hinausgeht:** ein weiteres Modell derselben Bauart ist in
der Store-Wertung **gratis**. Was zaehlt, ist die ART des Zugriffs (Netzweg, Vault-Weg,
Code-Ausfuehrung), nicht sein Umfang. Wer eine zweite Modellstufe plant, muss dafuer nichts
einpreisen — wohl aber fuer eine neue Zugriffsart (`vault.getFiles()` kostete in 0.8.0 genau
eine `info`-Zeile, s.u.).

**Zweimal an einem Tag bestaetigt, mit zwei verschiedenen Zuwaechsen.** 0.9.0 und 0.10.0 wurden
am 2026-08-30 nacheinander gescannt (Johannes), und beide Male war die Befundliste Zeile fuer
Zeile identisch mit der von 0.8.0. Der zweite Fall haerten die Aussage von der anderen Seite:
0.10.0 brachte keine Groesse, sondern eine neue oeffentliche API-Methode (`recheck()`) mit einem
zusaetzlichen Netzaufruf — und auch das bewegt nichts, weil es **dieselbe Zugriffsart** ist
(derselbe `requestUrl`-Weg zu demselben Endpunkt, nur zu einem anderen Zeitpunkt).
`Number of network request calls` steht als `info` ohne Zahl da und waechst nicht mit.

Zusammen ergeben die beiden Messungen die Regel: **es zaehlt, WELCHE Sorte Zugriff im Code
vorkommt — nicht wie oft, nicht wie gross, und nicht, wer ihn ausloest.** (Dritter Beleg dafuer
aus 0.7.0: eine oeffentliche `plugin.api`, ueber die ein FREMDES Plugin in den Vault schreiben
laesst, liess `Vault Write` ein `pass` bleiben.)

### Historie: was 0.8.0 gegenueber 0.7.0 gekostet hat

**Die Befundliste hatte sich gegenueber 0.7.0 um GENAU EINE `info`-Zeile veraendert — und die
liess sich auf eine einzige Codezeile zurueckfuehren:**

> `**Vault Enumeration**: Enumerates all files in the vault (vault.getFiles, getMarkdownFiles, …).`

Ursache ist `app.vault.getFiles()` im `ImagePickerModal` (`src/obsidian/image-picker.ts:21`) —
die Vorlagen-Auswahl fuer img2img. In 0.7.0 gab es keinen einzigen `getFiles`-Aufruf; der Scanner
misst also praezise, was dazukam.

**Damit ist ein Kostensatz gemessen, der ueber dieses Plugin hinausgeht:** ein Vault-Datei-Picker
(`FuzzySuggestModal` ueber `vault.getFiles()`) kostet **eine `info`-Zeile und sonst nichts** —
die Note bleibt `Passed`. Wer eine Dateiauswahl plant, muss dafuer nichts einpreisen. `info` ist
eine *Recommendation*, keine *Warning*; nur `medium` und darueber druecken die Note.

`pass` (unveraendert): Attestierungen fuer `main.js`/`styles.css`, `Build reproduced the release
main.js byte-for-byte`, keine verwundbaren Abhaengigkeiten, **`Vault Write`**.

`info`: `AGPL copyleft`, `Number of network request calls`, `runtime base64 encode or decode`,
**`Vault Enumeration`** (neu, s.o.), **`Dynamic Code Execution`** (das `new Function(` der
Emscripten-embind in der ORT-Glue), `Plugin references unrecognized WASM files`.

⚠️ **Drei Pruefungen liefen wieder gar nicht:** `Malware scan not available`,
`Obfuscation scan not available`, `Network requests scan not available` — inzwischen **fuenfte
Version in Folge** (in 0.9.0 unveraendert vorhanden). Das steht unter `info` und sieht wie ein Befund aus, ist aber die Abwesenheit einer
Messung. Nicht als Freibrief lesen: wer eine riskante Bauart plant, hat hier **keine**
Bestaetigung bekommen, nur kein Widerwort.

**Was 0.7.0 schon gezeigt hatte und weiter gilt:** eine oeffentliche `plugin.api`, ueber die ein
FREMDES Plugin Bilder erzeugen und in den Vault schreiben laesst, erzeugt **keine** neue
Kategorie — `Vault Write` bleibt ein `pass`, weil der Scanner den *Weg* bewertet (Obsidian-API
statt `fs`), nicht den Ausloeser. Dasselbe gilt fuer img2img: ein zweiter HTTP-Endpunkt zum
selben Server kostet nichts.

Nachlesen: `python3 <obsidian-store-recherche>/scripts/scorecard.py local-image-generator`.
**Der Scan laeuft nie von selbst an** — nach jedem Release im Developer Dashboard einen
Rescan anstossen (0.9.0: von Johannes am 2026-08-30 angestossen, Ergebnis oben; 0.8.0 am
2026-08-23).

## Warum die Engine im Renderer sitzt (0.5 → 0.6)

0.5 hatte die Engine ganz entfernt, weil die in-process-Fassung dem Store Warnungen brachte (`child_process`/`fs`, ein 34-MB-Bundle). 0.6 hat sie im Renderer zurückgeholt, ohne `mflux`, ohne Inline-WASM, mit Assets vom eigenen HF-Repo; der Spike vom 2026-08-19 maß, dass das Nachladen der Assets nur `info` kostet, keine Warnung.
