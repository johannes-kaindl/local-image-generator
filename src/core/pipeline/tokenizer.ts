// CLIP-BPE-Tokenizer (Spec §5) — Algorithmus wie openai/CLIP simple_tokenizer:
// bytes_to_unicode (GPT-2-Tabelle), Wort-Regex, BPE-Merges nach Rang, "</w>"-Wortende.
// vocab.json/merges.txt werden zur Laufzeit geladen und hier injiziert (pure).
// Pad-Default ist 0, nicht EOS (49407): MS-Demo onnxruntime-inference-examples
// js/sd-turbo/index.js L256 setzt pad_token_id = 0 — SD-2.x folgt der
// OpenCLIP-Konvention (Pad = Token 0 = "!"), nicht EOS-Padding. opts.pad bleibt Override.
export interface TokenizerData {
  vocab: Record<string, number>;
  merges: string[]; // Zeilen wie "a b", Reihenfolge = Priorität
}

export interface TokenizerOpts {
  maxLen?: number;
  bos?: number;
  eos?: number;
  pad?: number;
}

export const TOKEN_LEN = 77;
export const BOS = 49406;
export const EOS = 49407;
export const PAD = 0;

function bytesToUnicode(): Map<number, string> {
  const bs: number[] = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n);
      n++;
    }
  }
  const map = new Map<number, string>();
  bs.forEach((b, i) => map.set(b, String.fromCodePoint(cs[i]!)));
  return map;
}

const BYTE_ENCODER = bytesToUnicode();
const WORD_RE = /'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+/gu;

// Rang einer Merge-Regel für ein Paar benachbarter Teile. Reale CLIP-BPE-Daten (openai
// simple_tokenizer, vgl. stabilityai/sd-turbo merges.txt) matchen ausschließlich exakt:
// "a b" und "a b</w>" sind zwei unterschiedliche Regeln. Kein Fallback — ein
// "</w>"-Strip-Fallback würde wortfinale Paare mergen, für die nur die nicht-finale Regel
// existiert, und damit von der Referenz-Tokenisierung abweichen.
function pairRank(a: string, b: string, ranks: Map<string, number>): number | undefined {
  return ranks.get(a + " " + b);
}

function bpe(word: string, ranks: Map<string, number>, cache: Map<string, string[]>): string[] {
  const cached = cache.get(word);
  if (cached) return cached;
  let parts = [...word.slice(0, -4)]; // ohne "</w>"
  if (parts.length === 0) return [word];
  parts[parts.length - 1] += "</w>";
  for (;;) {
    let best = Infinity;
    let bestIdx = -1;
    for (let i = 0; i < parts.length - 1; i++) {
      const rank = pairRank(parts[i]!, parts[i + 1]!, ranks);
      if (rank !== undefined && rank < best) {
        best = rank;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    parts = [...parts.slice(0, bestIdx), parts[bestIdx]! + parts[bestIdx + 1]!, ...parts.slice(bestIdx + 2)];
  }
  cache.set(word, parts);
  return parts;
}

export function tokenize(text: string, data: TokenizerData, opts: TokenizerOpts = {}): Int32Array {
  const maxLen = opts.maxLen ?? TOKEN_LEN;
  const bos = opts.bos ?? BOS;
  const eos = opts.eos ?? EOS;
  const pad = opts.pad ?? PAD; // sd-turbo/MS-Demo: Padding mit 0 (siehe Modul-Kommentar), opts.pad bleibt Override
  const ranks = new Map<string, number>(data.merges.map((m, i) => [m, i]));
  const cache = new Map<string, string[]>();

  const clean = text.toLowerCase().replace(/\s+/g, " ").trim();
  const ids: number[] = [bos];
  for (const match of clean.match(WORD_RE) ?? []) {
    const encoded = Array.from(new TextEncoder().encode(match), (b) => BYTE_ENCODER.get(b)!).join("");
    for (const tok of bpe(encoded + "</w>", ranks, cache)) {
      const id = data.vocab[tok];
      if (id !== undefined) ids.push(id);
    }
    if (ids.length >= maxLen - 1) break;
  }
  ids.length = Math.min(ids.length, maxLen - 1);
  ids.push(eos);
  const out = new Int32Array(maxLen).fill(pad);
  out.set(ids);
  return out;
}
