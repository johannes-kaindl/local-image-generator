#!/bin/sh
# Vendort Kit-Module byte-identisch aus dem Schwester-Repo ../obsidian-kit (Dach-AGENTS.md,
# Kit-first). Nie von Hand editieren — Skript neu laufen lassen. Zielordner nach Quellbereich
# getrennt (Kit-README): src/pure/* -> src/vendor/kit/, src/obsidian/* -> src/vendor/kit-obsidian/.
# Der Schnitt ist kein Geschmack: scripts/check-pure.mjs (ROOTS) scannt src/vendor/kit gegen
# jeden obsidian-Import — ein gekoppeltes Modul dort bricht `npm run check:pure`.
#
# Vorlage: koda-agent/tools/sync-kit.sh (Form-A-VENDOR.json + @version im Stempel),
# ergaenzt um den KIT_DIR-Guard aus obsidian-transmute.
set -e

KIT="${KIT_DIR:-../obsidian-kit}"
[ -d "$KIT/src/pure" ] || { echo "sync-kit: Kit nicht gefunden unter $KIT (KIT_DIR setzen)" >&2; exit 1; }
VER=$(node -p "require('$KIT/package.json').version")
SHA=$(git -C "$KIT" rev-parse --short HEAD)

stamp() { # stamp <vendored-file> <kit-relative-path>
  header="// vendored from obsidian-kit@$VER, $2 — do not hand-edit; re-vendor via tools/sync-kit.sh"
  printf '%s\n' "$header" | cat - "$1" > "$1.tmp"
  mv "$1.tmp" "$1"
}

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

for m in cache-download endpoint frontmatter i18n num settings settings_schema sha256 timeout; do
  cp "$KIT/src/pure/$m.ts" "src/vendor/kit/$m.ts"
  no_crossimport "src/vendor/kit/$m.ts"
  stamp "src/vendor/kit/$m.ts" "src/pure/$m.ts"
  echo "vendored obsidian-kit@$VER/pure/$m.ts"
done

for m in confirm folder-suggest hub settings_walker; do
  cp "$KIT/src/obsidian/$m.ts" "src/vendor/kit-obsidian/$m.ts"
  no_crossimport "src/vendor/kit-obsidian/$m.ts"
  stamp "src/vendor/kit-obsidian/$m.ts" "src/obsidian/$m.ts"
  echo "vendored obsidian-kit@$VER/obsidian/$m.ts"
done

cat > src/vendor/kit/VENDOR.json <<JSON
{
  "source": "obsidian-kit",
  "version": "$VER",
  "sha": "$SHA",
  "vendored": "cache-download.ts, endpoint.ts, frontmatter.ts, i18n.ts, num.ts, settings.ts, settings_schema.ts, sha256.ts, timeout.ts",
  "note": "Verbatim snapshot. Never hand-edit. Re-vendor via tools/sync-kit.sh. version/sha gelten AUSSCHLIESSLICH fuer die unter \"vendored\" gelisteten Dateien. num.ts kommt nur als Abhaengigkeit mit: settings_schema.ts importiert clampInt daraus. kit-obsidian/ siehe dortige VENDOR.json."
}
JSON
cat > src/vendor/kit-obsidian/VENDOR.json <<JSON
{
  "source": "obsidian-kit",
  "version": "$VER",
  "sha": "$SHA",
  "vendored": "confirm.ts, folder-suggest.ts, hub.ts, settings_walker.ts",
  "note": "Verbatim snapshot. Never hand-edit. Re-vendor via tools/sync-kit.sh. version/sha gelten AUSSCHLIESSLICH fuer die unter \"vendored\" gelisteten Dateien. Eigene Ablage neben src/vendor/kit/, weil diese Module \"obsidian\" importieren (scripts/check-pure.mjs scannt src/vendor/kit dagegen). HUB_CSS aus hub.ts ist zusaetzlich in styles.css uebernommen — das Kit injiziert kein CSS."
}
JSON
echo "VENDOR.json → $VER ($SHA)"
