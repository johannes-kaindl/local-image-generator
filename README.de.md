# Local Image Generator

Bilder in Obsidian erzeugen — auf dem eigenen Rechner, ohne Cloud und ohne Konto. Zwei
Wege, wählbar in den Einstellungen:

- **Eingebaut (Standard):** ein kleines, schnelles Modell (SD-Turbo) rechnet **auf deiner
  GPU in Obsidian** per WebGPU. Nichts zu installieren: einmal **Modell herunterladen**
  klicken (≈ 2,5 GB, per Prüfsumme geprüft, außerhalb des Vaults abgelegt), dann Prompt
  eingeben und Generieren — ein Bild in Sekunden.
- **Server:** ein lokaler Bild-Server, den du selbst betreibst —
  [Draw Things](https://drawthings.ai/),
  [AUTOMATIC1111](https://github.com/AUTOMATIC1111/stable-diffusion-webui),
  [Forge](https://github.com/lllyasviel/stable-diffusion-webui-forge) oder
  [SD.Next](https://github.com/vladmandic/sdnext) über deren gemeinsame, A1111-kompatible
  HTTP-API — mit den Modellen, die er geladen hat, und allen Reglern (Negativ-Prompt,
  Guidance, Größen).

So oder so verlassen Prompts und Bilder deinen Rechner nie.

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Release](https://img.shields.io/gitea/v/release/jkaindl/local-image-generator?gitea_url=https%3A%2F%2Fgit.jkaindl.de&label=release)](https://git.jkaindl.de/jkaindl/local-image-generator/releases)
[![Obsidian](https://img.shields.io/badge/obsidian-1.8.7%2B-purple)](https://obsidian.md)

> **Hinweis:** Diese Übersetzung folgt der englischen [`README.md`](README.md).
> Bei Abweichungen gilt die englische Fassung.

<p align="center">
  <img src="https://git.jkaindl.de/jkaindl/local-image-generator/raw/branch/main/docs/images/hero.png" alt="Obsidian mit einem Bild der eingebauten Engine: die Notiz in der Mitte zeigt das fertige Bild, das Generator-Panel rechts dasselbe Ergebnis samt Prompt, Schrittzahl und Seed und nennt SD-Turbo als verwendetes Modell." width="600">
</p>

## Features

<p align="center">
  <img src="https://git.jkaindl.de/jkaindl/local-image-generator/raw/branch/main/docs/images/generate-panel.png" alt="Das Generator-Panel in Obsidians rechter Seitenleiste mit einsatzbereiter eingebauter Engine: Prompt-Feld, Stil-Chips sowie Regler für Schritte und Seed. Negativ-Prompt, Guidance und Größe fehlen, weil SD-Turbo sie nicht unterstützt." width="456">
</p>

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
- **Eingebaute Engine:** SD-Turbo ist ein destilliertes Modell — 512 × 512, 1–4 Schritte,
  keine Guidance — deshalb zeigt das Panel in diesem Modus nur, was das Modell auch
  beachtet: Prompt, Schritte (1–4), Seed und die Stil-Chips. Negativ-Prompt, CFG und die
  Größenwahl erscheinen, sobald du auf einen Server umstellst.
- **Server:** Welches Modell tatsächlich läuft, entscheidest du in deiner Server-App (Draw
  Things, AUTOMATIC1111, …), nicht in diesem Plugin — es schickt generische
  Erzeugungsparameter und zeigt den Namen des aktiven Modells als Statushinweis.

Die Oberfläche gibt es auf Englisch und Deutsch und folgt automatisch der
Spracheinstellung von Obsidian — eine eigene Sprachoption gibt es nicht.

<p align="center">
  <img src="https://git.jkaindl.de/jkaindl/local-image-generator/raw/branch/main/docs/images/style-chips.png" alt="Die Stil-Chips unter dem Prompt-Feld: Sumi-e, Watercolor, Photo und Oil." width="380">
</p>

## Installation

1. Das Plugin über Obsidians Community-Plugin-Browser installieren und aktivieren (oder
   manuell — siehe
   [Releases](https://github.com/johannes-kaindl/local-image-generator/releases)).
2. **Eingebaute Engine (Standard):** den Generator öffnen und **Modell herunterladen
   (2,5 GB)** klicken — oder in **Einstellungen → Local Image Generator → Engine**. Sobald
   der Status *Bereit* meldet, generieren. Das ist die ganze Einrichtung.
3. **Lieber ein Server?** **Engine** auf *Server (Draw Things / A1111)* stellen, die URL
   des Servers unter **Server-Endpunkt** eintragen und **Verbindung testen** klicken.

<p align="center">
  <img src="https://git.jkaindl.de/jkaindl/local-image-generator/raw/branch/main/docs/images/first-run.png" alt="Das Generator-Panel direkt nach der Installation: Prompt-Feld, Stil-Chips und Regler, darunter der Hinweis, dass das eingebaute Modell noch nicht geladen ist, mit dem Knopf „Download model (2.5 GB)“." width="380">
</p>

### Einen Server einrichten (optional)

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

<p align="center">
  <img src="https://git.jkaindl.de/jkaindl/local-image-generator/raw/branch/main/docs/images/settings-server.png" alt="Der Engine-Abschnitt der Einstellungen im Server-Modus: die Engine-Auswahl mit „Server (Draw Things / A1111)“ und das Feld für den Server-Endpunkt samt Knopf „Test connection“." width="380">
</p>

## Verwendung

1. Eingebaute Engine: sicherstellen, dass das Modell geladen ist (das Panel bietet den
   Knopf an, wenn nicht). Server-Modus: sicherstellen, dass dein Bild-Server (Draw Things,
   AUTOMATIC1111, Forge oder SD.Next) läuft und seine API erreichbar ist — das Panel sagt
   dir, wenn nicht.
2. Den Generator öffnen (Ribbon-Icon oder Befehl **Generator öffnen**).
3. Einen Prompt eingeben, Schritte / Seed (und im Server-Modus Negativ-Prompt / Größe /
   CFG) einstellen und **Erzeugen** drücken. Das erste Bild nach einem Obsidian-Start
   dauert mit der eingebauten Engine ein paar Sekunden länger — das Modell wird in die
   GPU geladen; die Statuszeile zählt mit.
4. **Anlegen** speichert das Bild als neuen Anhang und öffnet es, **Einfügen** speichert
   es und bettet es an der Cursorposition ein. Wenn zusätzlich eine Notiz mit den Daten
   der Erzeugung im Frontmatter entstehen soll, vorher die Auswahl
   **Anlegen-Schaltfläche** in den Einstellungen auf **Bild + Notiz** stellen.
5. Frühere Erzeugungen findest du jederzeit im Reiter **Verlauf**.

<p align="center">
  <img src="https://git.jkaindl.de/jkaindl/local-image-generator/raw/branch/main/docs/images/history.png" alt="Der History-Reiter mit zwei Läufen, jeder mit Prompt, Seed, Schrittzahl und Uhrzeit, nach Aktualität sortiert, mit den Umschaltern Recent und By prompt und einem Knopf Clear all." width="456">
</p>

<p align="center">
  <img src="https://git.jkaindl.de/jkaindl/local-image-generator/raw/branch/main/docs/images/result-note.png" alt="Eine Ergebnis-Notiz: das Rezept im Frontmatter — Prompt, Seed, Schritte, CFG, Modell, Größe und Bilddatei — darunter das eingebettete Bild." width="496">
</p>

## Voraussetzungen

- **Nur Obsidian Desktop** (`isDesktopOnly: true` — dieses Plugin läuft nicht auf
  Obsidian Mobile).
- **Eingebaute Engine:** eine GPU, die Obsidians WebGPU mit 16-Bit-Shadern
  (`shader-f16`) nutzen kann — Apple-Silicon-Macs erfüllen das, ebenso die meisten
  aktuellen dedizierten GPUs — dazu rund 4 GB freier Arbeitsspeicher während ein Bild
  entsteht und 2,5 GB Platz für das Modell. Das Panel sagt dir, wenn die GPU nicht
  reicht; dann ist der Server-Modus der Ausweg.
- **Server-Modus:** ein beliebiger A1111-kompatibler lokaler Bild-Server, laufend und
  erreichbar — Draw Things, AUTOMATIC1111, Forge oder SD.Next. Die Server-App besitzt das
  Modell, seine Hardware-Anforderungen und seinen Speicherbedarf.

## Konfiguration

<p align="center">
  <img src="https://git.jkaindl.de/jkaindl/local-image-generator/raw/branch/main/docs/images/settings.png" alt="Die Einstellungen des Plugins mit gewählter eingebauter Engine: die Engine-Auswahl, die SD-Turbo-Modellzeile mit dem Zustand Ready und einem Remove-Knopf, Bilder- und Notizordner, Modus des Create-Knopfes, Standard-Schrittzahl, die editierbare Liste der Stil-Chips und die Download-Quelle unter Advanced." width="515">
</p>

**Einstellungen → Local Image Generator**:

- **Engine** — *Eingebaut (SD-Turbo)* oder *Server (Draw Things / A1111)*.
  - Eingebaut zeigt die **Modell-Zeile**: Größe, Lizenz, Status und
    **Herunterladen** / **Abbrechen** / **Entfernen**. Ohne Klick auf Herunterladen wird
    nichts geladen.
  - Server zeigt den **Server-Endpunkt** — die URL deines lokalen Bild-Servers (z.B.
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
- **Erweitert → Download-Quelle** — die Basis-URL, von der die Modell-Dateien geholt
  werden. Standard ist das Modell-Repository dieses Plugins auf Hugging Face; für einen
  Spiegel oder einen lokalen Server änderbar. Bereits geladene Dateien bleiben gültig,
  egal was die URL sagt.
- **Alte SD-Turbo-Gewichte löschen** (nur sichtbar, wenn welche gefunden werden) — wer
  von einer Version vor 0.5 kommt, die eine andere Konversion des Modells in der
  Cache-API des Browsers ablegte, löscht diese ~2,5 GB hier mit einem Klick. Die
  0.6-Engine nutzt eigene Dateien und liest die alten nie.

## Funktionsweise

Das Plugin besitzt die Oberfläche — Prompt, Stile, Verlauf, Ablageort — und eines von
zwei **Backends** besitzt die Erzeugung:

**Eingebaute Engine.** SD-Turbo läuft in Obsidian über
[onnxruntime-web](https://onnxruntime.ai/docs/tutorials/web/) auf dem WebGPU-Backend. Die
Modell-Dateien sind die **eigene ONNX-Konversion** dieses Plugins aus den offiziellen
`stabilityai/sd-turbo`-Gewichten (fp16-Gewichte, fp32-Ein-/Ausgänge), veröffentlicht im
Modell-Repository des Plugins samt Lizenz und Hinweis; das Konversionsskript liegt in
`tools/convert/`. Beim ersten Lauf nach dem Start von Obsidian werden die drei Sessions
(Text-Encoder, UNet, VAE-Decoder) in die GPU geladen — die Statuszeile zählt die
Sekunden —, danach kostet jedes Bild einen Text-Encoder-Durchlauf, 1–4 UNet-Schritte und
einen VAE-Decode. Die Pipeline (CLIP-Tokenizer, Euler-Ancestral-Scheduler, geseedetes
Rauschen) ist reines TypeScript und gegen Fake-Sessions getestet.

**Server.** Eine Erzeugung ist ein `POST /sdapi/v1/txt2img` gegen den eingetragenen
Endpunkt, mit nichts als den generischen Parametern des Panels (Prompt, Negativ-Prompt,
Größe, Schritte, CFG, Seed). Währenddessen fragt das Panel einmal pro Sekunde
`GET /sdapi/v1/progress` nach einem Prozentwert — ein Server ohne diesen Endpunkt (Draw
Things antwortet 404) zeigt stattdessen einen Sekundenzähler, und das Plugin fragt nach
dem ersten 404 nicht mehr. Verbindungstest und Modellname in der Statuszeile kommen aus
`GET /sdapi/v1/options`. Alle drei Aufrufe gehen über Obsidians eigenes `requestUrl`, das
keinen Browser-CORS-Regeln unterliegt, und tragen ein eigenes kurzes Zeitlimit:
`requestUrl` kennt weder Abbruch noch Timeout — ohne eigenes Limit hinge das Panel an
einem unerreichbaren Server ewig, statt ihn als unerreichbar zu melden.

So oder so landet das Bild als gewöhnlicher Anhang im Vault. Das Rezept dahinter (Prompt,
Seed, Schritte, Größe, CFG, Modell, Zeit) wandert in die lokale Datendatei des Plugins,
aus der der Verlaufs-Tab liest — die Bilddatei selbst hängt nicht vom Plugin ab.

## Wie Netzwerk und Speicher genutzt werden

**Ab Werk lädt das Plugin nichts herunter.** Die eingebaute Engine braucht ihre
Modell-Dateien und holt sie **einmal, nur wenn du auf Herunterladen klickst** (im
Generator-Panel oder in den Einstellungen), aus dem Modell-Repository dieses Plugins auf
Hugging Face:

| Datei | Größe | Was es ist | Lizenz |
|---|---|---|---|
| `sd-turbo/text_encoder/model.onnx` | ≈ 681 MB | CLIP-Text-Encoder (fp16) | Stability AI Community License |
| `sd-turbo/unet/model.onnx` | ≈ 1,7 GB | UNet (fp16) | Stability AI Community License |
| `sd-turbo/vae_decoder/model.onnx` | ≈ 99 MB | VAE-Decoder (fp16) | Stability AI Community License |
| `sd-turbo/tokenizer/vocab.json`, `merges.txt` | ≈ 1,6 MB | CLIP-BPE-Tokenizer-Daten | (Teil des Modell-Releases) |
| `runtime/ort-<version>/ort-wasm-simd-threaded.asyncify.wasm` | ≈ 24 MB | ONNX Runtime Web (dieselbe Version, gegen die das Plugin gebaut ist) | MIT |

Jede Datei wird vor der Verwendung gegen eine im Plugin hinterlegte SHA-256 geprüft; bei
Abweichung wird sie verworfen und gemeldet. Die Dateien liegen in der Cache-API des
Browsers im Obsidian-Profil — **außerhalb deines Vaults**, werden also nie gesynct — und
**Entfernen** in den Einstellungen löscht sie wieder. Ein Download lässt sich jederzeit
abbrechen; fertige Dateien bleiben.

Die Download-Quelle ist die einzige Netzwerkverbindung der eingebauten Engine. Im
Server-Modus ist die einzige Verbindung der Server-Endpunkt, den du konfigurierst — und
das nur beim Generieren, beim Verbindungstest und beim Abfragen des Fortschritts. Kein
anderer Netzzugriff, keine Telemetrie.

- Prompts und erzeugte Bilder verlassen deinen Rechner nie.
- Erzeugte Bilder werden als normale Anhänge in deinem Vault gespeichert, genau wie ein
  Bild, das du selbst hinzufügst. Der Verlauf (Prompts, Seeds, Einstellungen) liegt in der
  lokalen Datendatei des Plugins, ebenfalls auf deinem Rechner.
- **Upgrade von einer Version vor 0.5?** Diese Fassungen legten eine andere
  Modell-Konversion (~2,5 GB) in der Cache-API ab. Die 0.6-Engine nutzt sie nicht; das
  Plugin zeigt einmalig einen Hinweis, wenn es sie findet, und **Einstellungen → Alte
  SD-Turbo-Gewichte löschen** entfernt sie.

## Datenschutz

- **Keine Telemetrie.** Das Plugin erhebt, überträgt und meldet keinerlei
  Nutzungsdaten, Prompts oder Bilder.
- **Kein Netzzugriff** außer (a) dem Modell-Download, den du selbst anstößt, von der in
  den Einstellungen gezeigten Download-Quelle, und (b) im Server-Modus dem lokalen
  Server-Endpunkt, den du konfigurierst. Ohne deinen Klick wird nichts geholt.

## Modell & Lizenzen

- **Plugin-Code:** AGPL-3.0-or-later (siehe `LICENSE`).
- **Eingebautes Modell:** [SD-Turbo](https://huggingface.co/stabilityai/sd-turbo) von
  Stability AI, weiterverteilt als eigene ONNX-Konversion dieses Plugins unter der
  [Stability AI Community License](https://huggingface.co/stabilityai/sd-turbo/blob/main/LICENSE.md)
  — frei für Forschung, nicht-kommerzielle und begrenzt kommerzielle Nutzung; lies die
  Lizenz, bevor du erzeugte Bilder kommerziell verwendest. *Powered by Stability AI.* Die
  Konversion ist aus den offiziellen Gewichten mit `tools/convert-sd-turbo.sh`
  reproduzierbar; keine Drittkonversion ist beteiligt.
- **Server-Modus:** das Modell ist, was deine Server-App geladen hat — seine Lizenz gilt
  für die Bilder, die es erzeugt. Prüfe seine Modellkarte, bevor du erzeugte Bilder
  verwendest, besonders kommerziell.

## Ausblick

Das Zwei-Backend-Design hält beide Hälften austauschbar. In Erwägung: ein zweites
eingebautes Modell mit freundlicherer Lizenz und hübscheren Bildern (ein LCM-destilliertes
SD 1.5, MIT) als weiterer Katalogeintrag; img2img (die meisten Ziel-Server bieten
`/sdapi/v1/img2img` in derselben API-Familie bereits an); und eine kleine Anbieter-API,
damit andere Community-Plugins Bilder über ein bereits konfiguriertes Backend anfordern
können, ohne die Logik dieses Plugins nachzubauen.

## Lizenz

AGPL-3.0-or-later — siehe [LICENSE](LICENSE). Die Lizenzierung der Modelle ist eine
eigene Sache — siehe [Modell & Lizenzen](#modell--lizenzen) oben.
