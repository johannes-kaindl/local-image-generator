# Local Image Generator

Eine Oberfläche für Prompts, Stile und Verlauf zur Bilderzeugung in Obsidian, hinter der
ein lokaler Bild-Server steht, den du selbst betreibst. Dieses Plugin erzeugt keine
Bilder — es spricht mit [Draw Things](https://drawthings.ai/),
[AUTOMATIC1111](https://github.com/AUTOMATIC1111/stable-diffusion-webui),
[Forge](https://github.com/lllyasviel/stable-diffusion-webui-forge) oder
[SD.Next](https://github.com/vladmandic/sdnext) über deren gemeinsame,
A1111-kompatible HTTP-API. Alles bleibt auf deinem Rechner: Prompts und Bilder wandern
zwischen zwei lokalen Prozessen, die du kontrollierst — Obsidian und deinem
Bild-Server — und nirgendwo sonst.

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Release](https://img.shields.io/gitea/v/release/jkaindl/local-image-generator?gitea_url=https%3A%2F%2Fgit.jkaindl.de&label=release)](https://git.jkaindl.de/jkaindl/local-image-generator/releases)
[![Obsidian](https://img.shields.io/badge/obsidian-1.8.7%2B-purple)](https://obsidian.md)

> **Hinweis:** Diese Übersetzung folgt der englischen [`README.md`](README.md).
> Bei Abweichungen gilt die englische Fassung.

## Features

- Den Generator über das Ribbon-Icon oder den Befehl **Generator öffnen** aufrufen.
- Einen Prompt eingeben, optional einen **Negativ-Prompt** (was vermieden werden soll),
  eine **Größe** aus 7 kuratierten Seitenverhältnissen wählen (quadratisch, hoch, quer)
  und **Schritte** (1–50), **CFG** (Führungsstärke, 1–15) sowie den **Seed** nach
  Geschmack einstellen. Ein Klick auf einen Stil-Chip (Sumi-e, Watercolor, Photo, Oil —
  in den Einstellungen änder- und erweiterbar) hängt dessen Anmutung an den Prompt; ein
  zweiter Klick nimmt sie wieder weg.
- **Erzeugen** nutzt den Seed aus dem Feld (würfelt nie neu) und wird ausgegraut, sobald
  Prompt, Negativ-Prompt, Seed, Schritte, Größe und CFG exakt deinem letzten Ergebnis
  entsprechen — ein erneuter Lauf ohne Änderung brächte dasselbe Bild. **Neu würfeln**
  zieht einen frischen Seed und erzeugt trotzdem eine neue Variante; das Würfel-Symbol
  würfelt den Seed, ohne zu erzeugen.
- Der Reiter **Verlauf** zeigt frühere Erzeugungen als vollständige Rezepte
  (Prompt · Negativ-Prompt · Seed · Schritte · Größe · CFG · Zeit) — nach Prompt
  gruppierbar, per Klick zurück in den Generator ladbar, einzeln löschbar oder komplett
  leerbar.
- **Anlegen** speichert das Bild als neuen Anhang. Standardmäßig ist das alles (es
  öffnet das Bild außerdem) — stellt man die Auswahl **Anlegen-Schaltfläche** in den
  Einstellungen auf **Bild + Notiz**, entsteht zusätzlich eine Notiz mit Prompt, Seed,
  Schritten, Größe und Datum im Frontmatter und eingebettetem Bild, und diese Notiz wird
  geöffnet. **Einfügen** speichert das Bild immer nur und bettet es an der
  Cursorposition der aktuellen Notiz ein.
- Welches Modell tatsächlich läuft, entscheidest du in deiner Server-App (Draw Things,
  AUTOMATIC1111, …), nicht in diesem Plugin — es schickt generische
  Erzeugungsparameter und zeigt den Namen des aktiven Modells als Statushinweis.

Die Oberfläche gibt es auf Englisch und Deutsch und folgt automatisch der
Spracheinstellung von Obsidian — eine eigene Sprachoption gibt es nicht.

## Installation

1. Das Plugin über Obsidians Community-Plugin-Browser installieren und aktivieren (oder
   manuell — siehe
   [Releases](https://github.com/johannes-kaindl/local-image-generator/releases)).
2. Einen lokalen Bild-Server einrichten (siehe unten) und seine URL notieren.
3. **Einstellungen → Local Image Generator** öffnen, diese URL unter **Server-Endpunkt**
   eintragen und **Verbindung testen** klicken, um zu bestätigen, dass das Plugin ihn
   erreicht.

### Einen Server einrichten

Einen davon auswählen — das Plugin spricht mit allen auf dieselbe Weise:

**Draw Things** (macOS, der einfachste Einstieg — keine Kommandozeile):
1. Draw Things aus dem Mac App Store installieren.
2. In den Einstellungen von Draw Things den **API-Server** aktivieren. Die
   Standardadresse ist `http://127.0.0.1:7860`.
3. Diese Adresse als **Server-Endpunkt** des Plugins eintragen.

**AUTOMATIC1111** (`stable-diffusion-webui`):
Mit dem Schalter `--api` starten (z.B. `--api` zu `COMMANDLINE_ARGS` hinzufügen). Die
API liegt standardmäßig ebenfalls auf `http://127.0.0.1:7860`.

**Forge** (`stable-diffusion-webui-forge`):
Dieselbe A1111-kompatible API — mit `--api` starten, gleiche Standardadresse.

**SD.Next**:
Dieselbe A1111-kompatible API-Familie — falls die API nicht standardmäßig an ist, den
passenden Startschalter in der dortigen Doku nachsehen.

In allen vier Fällen gilt: sobald der Server läuft und seine API erreichbar ist, die URL
in den Plugin-Einstellungen eintragen und **Verbindung testen** klicken. Statuszeile und
Einstellungen zeigen danach den Namen des aktiven Modells.

## Verwendung

1. Sicherstellen, dass dein Bild-Server (Draw Things, AUTOMATIC1111, Forge oder
   SD.Next) läuft und seine API erreichbar ist — das Generator-Panel sagt dir, wenn
   nicht.
2. Den Generator öffnen (Ribbon-Icon oder Befehl **Generator öffnen**).
3. Einen Prompt eingeben (optional einen Negativ-Prompt), Größe / Schritte / CFG / Seed
   einstellen und **Erzeugen** drücken.
4. **Anlegen** speichert das Bild als neuen Anhang und öffnet es, **Einfügen** speichert
   es und bettet es an der Cursorposition ein. Wenn zusätzlich eine Notiz mit den Daten
   der Erzeugung im Frontmatter entstehen soll, vorher die Auswahl
   **Anlegen-Schaltfläche** in den Einstellungen auf **Bild + Notiz** stellen.
5. Frühere Erzeugungen findest du jederzeit im Reiter **Verlauf**.

## Voraussetzungen

- **Nur Obsidian Desktop** (`isDesktopOnly: true` — dieses Plugin läuft nicht auf
  Obsidian Mobile).
- Ein beliebiger A1111-kompatibler lokaler Bild-Server, laufend und erreichbar — Draw
  Things, AUTOMATIC1111, Forge oder SD.Next (siehe [Installation](#installation) oben).
  Dieses Plugin erzeugt selbst keine Bilder und bringt keine Modellgewichte mit und lädt
  auch keine herunter; die Server-App, die du betreibst, besitzt das Modell, seine
  Hardware-Anforderungen und seinen Speicherbedarf.

## Konfiguration

**Einstellungen → Local Image Generator**:

- **Server-Endpunkt** — die URL deines lokalen Bild-Servers (z.B.
  `http://127.0.0.1:7860`), dazu eine Schaltfläche **Verbindung testen**, die
  Erreichbarkeit prüft und das aktive Modell des Servers meldet.
- **Ausgabe** — der Bildordner (leer lassen für Obsidians Anhang-Ordner, mit
  Autovervollständigung über bestehende Ordner), der Notiz-Ordner für den Fall, dass
  Anlegen eine Notiz erzeugt (leer lassen, um die Notiz neben das Bild zu legen), die
  Auswahl **Anlegen-Schaltfläche** (nur Bild oder Bild + Notiz) und der Startwert des
  Schritte-Reglers (1–50).
- **Stile** — dieselben Stil-Vorlagen, die als Chips unter dem Prompt-Feld erscheinen.
  Beschriftung oder Prompt-Text einer Vorlage ändern, sie löschen oder eine neue
  anlegen.
- **Alte SD-Turbo-Gewichte löschen** (nur sichtbar, wenn welche gefunden werden) — wer
  von einer Version vor 0.5 kommt, die Bilder im Prozess selbst erzeugte und dafür rund
  2,5 GB Modellgewichte in der Cache-API des Browsers ablegte, löscht sie hier mit einem
  Klick. Sie haben keinen Zweck mehr, seit die Erzeugung auf deinen externen Server
  gewandert ist. Siehe
  [Wie Netzwerk und Speicher genutzt werden](#wie-netzwerk-und-speicher-genutzt-werden).

## Funktionsweise

Das Plugin ist ein **dünner Client**: ihm gehört die Oberfläche — Prompt, Vorlagen,
Verlauf, wo Dateien landen — und deiner Server-App gehören Modell, Hardware und die
eigentliche Erzeugung. So bleiben beide Hälften austauschbar.

Eine Erzeugung ist ein `POST /sdapi/v1/txt2img` gegen den von dir konfigurierten
Endpunkt und trägt nichts weiter als die generischen Parameter aus dem Panel (Prompt,
Negativ-Prompt, Größe, Schritte, CFG, Seed). Währenddessen fragt das Panel einmal pro
Sekunde `GET /sdapi/v1/progress` nach einem Prozentwert — ein Server, der diesen
Endpunkt nicht anbietet, führt lediglich zu einer unbestimmten Anzeige statt zu einem
Fehler. Verbindungstest und Modellname in der Statuszeile kommen von
`GET /sdapi/v1/options`.

Alle drei Aufrufe laufen über Obsidians eigenes `requestUrl`, das den CORS-Regeln des
Browsers nicht unterliegt, und bringen ein eigenes, kurzes Zeitlimit mit: `requestUrl`
kennt weder Abbruch noch Timeout, ohne dieses Limit würde ein nicht erreichbarer Server
das Panel also ewig hängen lassen, statt gemeldet zu werden.

Das zurückgelieferte Bild wird dekodiert und als gewöhnlicher Anhang in deinen Vault
geschrieben. Das Rezept dahinter (Prompt, Seed, Schritte, Größe, CFG, Zeit) landet in
der lokalen Datendatei des Plugins, aus der der Verlauf liest — die Bilddatei selbst
hängt in keiner Weise vom Plugin ab.

## Wie Netzwerk und Speicher genutzt werden

- **Die einzige Netzwerkverbindung dieses Plugins geht an den Server-Endpunkt, den du
  selbst konfigurierst**, und nur dann, wenn du ein Bild erzeugst, die Verbindung testest
  oder das Panel den Fortschritt abfragt. Kein anderer Netzzugriff, keine Telemetrie und
  keinerlei Downloads — das Plugin lädt nie Modellgewichte oder sonstige Daten; das ist
  vollständig Sache deiner Server-App und außerhalb der Kontrolle dieses Plugins.
- Prompts und erzeugte Bilder verlassen deinen Rechner nie — sie werden zwischen zwei
  lokalen Prozessen ausgetauscht (Obsidian und deiner Server-App), nicht an einen
  entfernten Dienst geschickt.
- Erzeugte Bilder werden als normale Anhänge in deinem Vault gespeichert, genau wie ein
  Bild, das du selbst hinzufügst. Der Erzeugungsverlauf (Prompts, Seeds, Einstellungen)
  liegt in der lokalen Datendatei des Plugins, ebenfalls auf deinem Rechner.
- **Upgrade von einer Version vor 0.5?** Frühere Fassungen betrieben ein Bildmodell im
  Prozess und legten rund 2,5 GB Modellgewichte in der Cache-API des Browsers ab. Dieser
  Cache wird nicht mehr genutzt. Beim Laden prüft das Plugin einmalig, ob es ihn gibt,
  und zeigt gegebenenfalls einen einmaligen Hinweis; löschen kannst du ihn jederzeit
  unter **Einstellungen → Local Image Generator**.

## Datenschutz

- **Keine Telemetrie.** Das Plugin erhebt, überträgt und meldet keinerlei
  Nutzungsdaten, Prompts oder Bilder.
- **Kein Netzzugriff** außer dem lokalen Server-Endpunkt, den du selbst konfigurierst.
  Dieses Plugin lädt nie etwas von sich aus herunter.

## Modell & Lizenzen

- **Plugin-Code:** AGPL-3.0-or-later (siehe `LICENSE`).
- **Modelle und ihre Lizenzen:** Dieses Plugin bringt kein Modell mit, lädt keines
  herunter und wählt keines aus — das ist vollständig Sache der Server-App, die du
  betreibst, und des Modells, das du dort lädst. Erzeugte Bilder können den
  Lizenzbedingungen dieses Modells unterliegen; prüfe seine Modellkarte, bevor du
  erzeugte Bilder verwendest, besonders kommerziell.

## Ausblick

Die Thin-Client-Architektur — generische Bedienelemente für Prompt, Negativ-Prompt,
Größe, Schritte und CFG gegen eine A1111-kompatible HTTP-API — ist bewusst nicht an
einen bestimmten Server oder ein bestimmtes Modell gebunden und kann deshalb ohne
weiteren Umbau wachsen. In Erwägung: img2img (die meisten Ziel-Server bieten
`/sdapi/v1/img2img` in derselben API-Familie bereits an) und eine kleine Anbieter-API,
damit andere Community-Plugins Bilder über einen bereits konfigurierten Server anfordern
können, ohne die Verbindungslogik dieses Plugins nachzubauen.

## Lizenz

AGPL-3.0-or-later — siehe [LICENSE](LICENSE). Die Lizenzierung der Modelle ist eine
eigene Sache — siehe [Modell & Lizenzen](#modell--lizenzen) oben.
