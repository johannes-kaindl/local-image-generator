#!/bin/sh
# Vendort Kit-Module byte-identisch aus dem Schwester-Repo ../obsidian-kit (Dach-AGENTS.md,
# Kit-first). Nie von Hand editieren — Skript neu laufen lassen. Zielordner nach Quellbereich
# getrennt (Kit-README): src/pure/* -> src/vendor/kit/, src/obsidian/* -> src/vendor/kit-obsidian/.
# Der Schnitt ist kein Geschmack: scripts/check-pure.mjs (ROOTS) scannt src/vendor/kit gegen
# jeden obsidian-Import — ein gekoppeltes Modul dort bricht `npm run check:pure`.
#
# Vorlage: koda-agent/tools/sync-kit.sh (Form-A-VENDOR.json + @version im Stempel),
# ergaenzt um den KIT_DIR-Guard aus obsidian-transmute.
#
# GELESEN WIRD AUS EINER FESTEN REF (KIT_REF), NICHT AUS DEM ARBEITSSTAND DES NACHBAR-REPOS
# (CORE-META-22, promotet 2026-08-30). Vorher kopierte das Skript per `cp` aus `$KIT/src/...`
# und stempelte den Pin aus dessen `HEAD` — zwei verschiedene Messungen unter einer Behauptung.
# Sichtbar war das an der eigenen VENDOR.json: sie behauptete 0.27.0 mit `fbb42d4`, waehrend der
# Tag 0.27.0 auf `548041b` zeigt (`fbb42d4` ist ein spaeterer Doku-Commit — der HEAD-Stand des
# Nachbar-Checkouts zum Zeitpunkt des letzten Laufs).
#
# Seit obsidian-kit 0.28.0 ist das kein Schoenheitsfehler mehr, sondern ein DEFEKT: die
# pure-Module sind nach code-kit abgewandert, im Arbeitsstand von 0.29.0 existieren 8 der 9
# unten gelisteten gar nicht mehr. Ein Lauf gegen den Arbeitsstand braeche also ab — und der
# alte Guard `[ -d "$KIT/src/pure" ]` haette das NICHT gesehen, weil der Ordner weiter existiert,
# nur mit anderem Inhalt. Aus dem Tag gelesen ist der Lauf reproduzierbar und stoert ausserdem
# keine parallele Session im Nachbar-Repo (kein Zugriff auf dessen Arbeitsverzeichnis).
#
# Ein Kit-Upgrade ist deshalb ab jetzt eine BEWUSSTE Handlung: `KIT_REF=0.29.0 sh tools/sync-kit.sh`
# (und dann pruefen, ob die Module dort noch liegen), nicht ein Nebeneffekt davon, dass jemand
# im Nachbar-Checkout einen Branch ausgecheckt hat.
set -e

KIT="${KIT_DIR:-../obsidian-kit}"
KIT_REF="${KIT_REF:-0.27.0}"
# Eigener Pin, Absicht: help-setting.ts (Hilfe-Zeile, UI-STANDARD 8) kam mit Kit 0.43.0 und haengt an
# keinem anderen Modul — die uebrigen Module bleiben auf KIT_REF (Vorlage epub-exporter 877eb2c).
KIT_HELP_REF="${KIT_HELP_REF:-0.43.0}"
[ -d "$KIT/.git" ] || { echo "sync-kit: Kit-Repo nicht gefunden unter $KIT (KIT_DIR setzen)" >&2; exit 1; }
git -C "$KIT" rev-parse --verify --quiet "$KIT_REF^{commit}" >/dev/null 2>&1 \
  || { echo "sync-kit: Ref '$KIT_REF' existiert nicht in $KIT (KIT_REF setzen; git -C $KIT tag)" >&2; exit 1; }
# `^{commit}` peelen: obsidian-kit taggt annotiert, ohne die Peelung stuende hier die SHA des
# TAG-OBJEKTS statt die des Commits — ein Pin, den kein `git log` findet (Kit-Nachtrag 7c04a48).
VER=$(git -C "$KIT" describe --tags --abbrev=0 "$KIT_REF")
SHA=$(git -C "$KIT" rev-parse --short "$KIT_REF^{commit}")
git -C "$KIT" cat-file -e "$KIT_HELP_REF:src/obsidian/help-setting.ts" 2>/dev/null \
  || { echo "sync-kit: src/obsidian/help-setting.ts fehlt in Ref $KIT_HELP_REF (KIT_HELP_REF setzen)" >&2; exit 1; }
HELP_VER=$(git -C "$KIT" describe --tags --abbrev=0 "$KIT_HELP_REF")
HELP_SHA=$(git -C "$KIT" rev-parse --short "$KIT_HELP_REF^{commit}")

# Gegenprobe: im Kit liegen die Schichten als src/pure + src/obsidian nebeneinander, hier als
# src/vendor/kit + src/vendor/kit-obsidian — ein kit-interner `../pure/`-Import zeigt hier ins
# Leere. Kein aktuell vendoriertes Modul hat einen (geprueft 2026-08-20: nur clipboard.ts,
# endpoint-list.ts und model-picker.ts kreuzen die Grenze, keines davon steht unten). Kommt eines
# dazu, bricht das Sync hier laut statt spaeter im Typecheck.
no_crossimport() { # no_crossimport <vendored-file>
  if grep -q '["'"'"']\.\./pure/' "$1"; then
    echo "sync-kit: $1 traegt einen kit-internen ../pure/-Import — Vendor-Layout-Umschrieb noetig (s. Dach-Klaerung 'Querimporte im Vendor-Layout')" >&2
    exit 1
  fi
}

mkdir -p src/vendor/kit src/vendor/kit-obsidian

# Erst in eine temporaere Datei, dann `mv` — und das ist NICHT die Vorsichtsform derselben Sache.
# ⚠️ Die Vorlagen (koda-agent, audio-interface, vim-dojo, …) schreiben Stempel und Inhalt in EINER
# Umleitung direkt aufs Ziel und behaupten im Kommentar, `set -e` breche ab, "bevor die Zieldatei
# geschrieben ist". Am 2026-09-02 hier gegengeprobt: **das stimmt nicht.** Die Umleitung leert das
# Ziel, BEVOR das erste Kommando laeuft; `printf` schreibt den Stempel, `git show` scheitert, und
# zurueck bleibt eine 1-Zeilen-Datei, die nur aus dem Stempel besteht — mit der Versionsnummer der
# ANGEFRAGTEN Ref. Also genau das Artefakt, gegen das der Kommentar zu schuetzen glaubt: es sieht
# wie gueltiges Vendoring aus und ist ein Torso. Gemessen mit `KIT_REF=0.29.0` (dort fehlen die
# abgewanderten pure-Module): `src/vendor/kit/cache-download.ts` hatte danach 1 Zeile und trug
# `@0.29.0`. Der `mv` unten macht das Schreiben atomar — entweder ganz oder gar nicht.
vendor() { # vendor <kit-relativer-pfad> <zielpfad> [ref] [version]
  ref="${3:-$KIT_REF}"; ver="${4:-$VER}"
  tmp="$2.tmp"
  if { printf '%s\n' "// vendored from obsidian-kit@$ver, $1 — do not hand-edit; re-vendor via tools/sync-kit.sh"
       git -C "$KIT" show "$ref:$1"; } > "$tmp"; then
    mv "$tmp" "$2"
  else
    rm -f "$tmp"
    echo "sync-kit: '$1' fehlt in Ref $ref — Modul verschoben? (ab obsidian-kit 0.28.0 sind pure-Module nach code-kit abgewandert)" >&2
    exit 1
  fi
}

for m in cache-download endpoint frontmatter i18n num settings settings_schema sha256 timeout; do
  vendor "src/pure/$m.ts" "src/vendor/kit/$m.ts"
  no_crossimport "src/vendor/kit/$m.ts"
  echo "vendored obsidian-kit@$VER/pure/$m.ts"
done

for m in confirm folder-suggest hub settings_walker; do
  vendor "src/obsidian/$m.ts" "src/vendor/kit-obsidian/$m.ts"
  no_crossimport "src/vendor/kit-obsidian/$m.ts"
  echo "vendored obsidian-kit@$VER/obsidian/$m.ts"
done

vendor "src/obsidian/help-setting.ts" "src/vendor/kit-obsidian/help-setting.ts" "$KIT_HELP_REF" "$HELP_VER"
no_crossimport "src/vendor/kit-obsidian/help-setting.ts"
echo "vendored obsidian-kit@$HELP_VER/obsidian/help-setting.ts"

# Wie unten: vendored_mixed_version-Eintraege (Einzel-Vendorings) gehoeren mitgeschrieben.
cat > src/vendor/kit/VENDOR.json <<JSON
{
  "source": "obsidian-kit",
  "version": "$VER",
  "sha": "$SHA",
  "vendored": "cache-download.ts, endpoint.ts, frontmatter.ts, i18n.ts, num.ts, settings.ts, settings_schema.ts, sha256.ts, timeout.ts",
  "vendored_mixed_version": [
    {
      "file": "endpoint-source.ts",
      "source": "obsidian-kit",
      "version": "0.39.0",
      "sha": "044b565",
      "note": "Einzeln vendoriert (git show 0.39.0:src/pure/endpoint-source.ts), NICHT ueber tools/sync-kit.sh — das Skript berechnet eine gemeinsame VER fuer die oben gelisteten Module und haette beim Aufnehmen dieser Datei alle neun auf 0.39.0 gehoben (kit-first-Regel 2 der Welle-7-Auftragsnote). Importiert ../vendor/code-kit/pure/endpoint_config, im Vendor-Layout auf ./endpoint_config umgeschrieben (Dateikopf traegt den Vermerk). Re-vendor manuell mit demselben git-show-Befehl gegen einen neuen Tag; Kopf-Stempel und dieser Eintrag von Hand nachziehen."
    },
    {
      "file": "endpoint_config.ts",
      "source": "code-kit",
      "version": "0.6.0",
      "sha": "918ed85",
      "note": "Einzeln vendoriert (git show 0.6.0:src/ts/pure/endpoint_config.ts) als Abhaengigkeit von endpoint-source.ts. Verbatim, keine Importe."
    },
    {
      "file": "model-choice.ts",
      "source": "code-kit",
      "version": "0.6.0",
      "sha": "918ed85",
      "note": "Einzeln vendoriert (git show 0.6.0:src/ts/pure/model-choice.ts) als Abhaengigkeit von src/vendor/kit-obsidian/model-picker.ts. Verbatim, keine Importe."
    }
  ],
  "note": "Verbatim snapshot aus ZWEI Quellen (obsidian-kit + code-kit); welche Datei woher stammt, sagt ihr eigener Kopf. Never hand-edit (Ausnahme: \\"vendored_mixed_version\\"-Eintraege, die per Definition ausserhalb von tools/sync-kit.sh liegen). Re-vendor via tools/sync-kit.sh. version/sha gelten AUSSCHLIESSLICH fuer die unter \\"vendored\\" gelisteten Dateien; \\"vendored_mixed_version\\" traegt seine Version/SHA je Eintrag selbst. num.ts kommt nur als Abhaengigkeit mit: settings_schema.ts importiert clampInt daraus. kit-obsidian/ siehe dortige VENDOR.json."
}
JSON

# Die vendored_mixed_version-Eintraege endpoint-source/model-picker sind Einzel-Vendorings ausserhalb dieses
# Skripts und muessen hier mitgeschrieben werden, sonst loescht jeder Lauf sie aus der VENDOR.json.
cat > src/vendor/kit-obsidian/VENDOR.json <<JSON
{
  "source": "obsidian-kit",
  "version": "$VER",
  "sha": "$SHA",
  "vendored": "confirm.ts, folder-suggest.ts, hub.ts, settings_walker.ts",
  "vendored_mixed_version": [
    {
      "file": "endpoint-source.ts",
      "source": "obsidian-kit",
      "version": "0.39.0",
      "sha": "044b565",
      "note": "Einzeln vendoriert (git show 0.39.0:src/obsidian/endpoint-source.ts). Importe ../vendor/code-kit/pure/ und ../pure/ im Vendor-Layout auf ../kit/ umgeschrieben (Dateikopf traegt den Vermerk). Re-vendor manuell gegen einen neuen Tag; Kopf-Stempel und dieser Eintrag von Hand nachziehen."
    },
    {
      "file": "model-picker.ts",
      "source": "obsidian-kit",
      "version": "0.39.0",
      "sha": "044b565",
      "note": "Einzeln vendoriert (git show 0.39.0:src/obsidian/model-picker.ts) als Abhaengigkeit von endpoint-source.ts. Import ../vendor/code-kit/pure/model-choice im Vendor-Layout auf ../kit/model-choice umgeschrieben."
    },
    {
      "file": "help-setting.ts",
      "source": "obsidian-kit",
      "version": "$HELP_VER",
      "sha": "$HELP_SHA",
      "note": "Einzeln vendoriert (git show 0.43.0:src/obsidian/help-setting.ts), keine weiteren Kit-Abhaengigkeiten. tools/sync-kit.sh pinnt eine gemeinsame Ref fuer alle Module und haette sie mit auf 0.43.0 gehoben. Re-vendor manuell gegen einen neuen Tag; Kopf-Stempel und dieser Eintrag von Hand nachziehen."
    }
  ],
  "note": "Verbatim snapshot. Never hand-edit (Ausnahme: \\"vendored_mixed_version\\"-Eintraege, die per Definition ausserhalb von tools/sync-kit.sh liegen). Re-vendor via tools/sync-kit.sh. version/sha gelten AUSSCHLIESSLICH fuer die unter \\"vendored\\" gelisteten Dateien; \\"vendored_mixed_version\\" traegt seine Version/SHA je Eintrag selbst. Eigene Ablage neben src/vendor/kit/, weil diese Module \\"obsidian\\" importieren (scripts/check-pure.mjs scannt src/vendor/kit dagegen). HUB_CSS aus hub.ts ist zusaetzlich in styles.css uebernommen — das Kit injiziert kein CSS."
}
JSON

echo "VENDOR.json → $VER ($SHA, aus Ref $KIT_REF)"
