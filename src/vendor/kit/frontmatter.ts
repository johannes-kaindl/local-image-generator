/** YAML-Frontmatter serialisieren (yaml_lite: flache Skalare + einfache Listen).
 *
 *  VENDORED aus `vault-rag/src/frontmatter.ts` (Stand 2026-07-16). Übernommen ist NUR der
 *  Serialisier-Pfad; parseFrontmatter/mergeFrontmatter/diffFrontmatter/assertParseable des
 *  Originals bleiben draußen (hier ungenutzt, YAGNI). Bei einem Sync mit dem Original:
 *  dort ist die Quelle der Wahrheit für needsQuoting/quoteScalar.
 *
 *  EINE ABWEICHUNG vom Original: FmValue kennt zusätzlich `number`, damit `seed: 199801046`
 *  nativ und ungequotet landet. Das Original kennt nur string|string[] und quotet
 *  zahl-aussehende Strings absichtlich — beides bleibt hier gültig, Zahlen sind ein
 *  zusätzlicher, expliziter Typ.
 *
 *  Kein obsidian-Import (check:pure). */

export type FmValue = string | number | string[];

// Codepoints, die YAML am Skalar-Anfang missdeuten würde.
const NEEDS_QUOTE_LEADING = /^[\s>|@`%&*!?#\-[{'"]/u;

function startsWithEmoji(s: string): boolean {
  const cp = s.codePointAt(0);
  if (cp === undefined) return false;
  // Symbols & pictographs, dingbats, misc symbols, regional indicators, etc.
  return (
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x1f000 && cp <= 0x1f2ff) ||
    cp === 0x2b50 ||
    cp === 0x2705 ||
    cp === 0x274c
  );
}

function needsQuoting(v: string): boolean {
  if (v === "") return false; // leerer Skalar wird bar emittiert (key:)
  if (v !== v.trim()) return true;
  if (v.includes(": ") || v.endsWith(":")) return true;
  if (v.includes(" #") || v.includes("#")) return true;
  if (v.includes("[[") || v.includes("]]")) return true;
  if (v.includes(",")) return true; // Komma würde den Inline-List-Tokenizer spalten
  if (v.includes("\\") || v.includes('"')) return true; // Backslash und Anführungszeichen
  if (NEEDS_QUOTE_LEADING.test(v)) return true;
  if (startsWithEmoji(v)) return true;
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(v)) return true;
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(v)) return true;
  return false;
}

function quoteScalar(v: string): string {
  if (!needsQuoting(v)) return v;
  return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function serializeValue(v: FmValue): string {
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return "[" + v.map(quoteScalar).join(", ") + "]";
  return v === "" ? "" : quoteScalar(v);
}

export function serializeFrontmatter(data: Record<string, FmValue>, order: string[]): string {
  const lines: string[] = ["---"];
  for (const key of order) {
    if (!(key in data)) continue;
    const ser = serializeValue(data[key]!);
    lines.push(ser === "" ? `${key}:` : `${key}: ${ser}`);
  }
  lines.push("---");
  return lines.join("\n") + "\n";
}
