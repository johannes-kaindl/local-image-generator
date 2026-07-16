import { describe, expect, it } from "vitest";
import { tokenize, type TokenizerData } from "../src/core/pipeline/tokenizer";

// Mini-Vocab: Einzelzeichen + ein Merge "ab". BOS/EOS wie CLIP (49406/49407)
// funktionieren unabhängig von der Vocab-Größe, weil sie als Opts übergeben werden.
const data: TokenizerData = {
  vocab: { "a": 1, "b": 2, "c": 3, "a</w>": 4, "b</w>": 5, "c</w>": 6, "ab": 7, "ab</w>": 8, "abc</w>": 9 },
  merges: ["a b", "ab c</w>"],
};
const opts = { maxLen: 8, bos: 100, eos: 101, pad: 101 };

describe("CLIP-BPE-Tokenizer", () => {
  it("wendet Merges in Prioritätsreihenfolge an: 'abc' → ein Token", () => {
    const ids = tokenize("abc", data, opts);
    expect(Array.from(ids)).toEqual([100, 9, 101, 101, 101, 101, 101, 101]);
  });
  it("einzelnes Wortende bekommt </w>: 'c' → c</w>", () => {
    const ids = tokenize("c", data, opts);
    expect(ids[1]).toBe(6);
  });
  it("lowercase + Whitespace-Normalisierung", () => {
    expect(Array.from(tokenize("  ABC  ", data, opts))).toEqual(Array.from(tokenize("abc", data, opts)));
  });
  it("mehrere Wörter, truncation auf maxLen (EOS bleibt am Ende)", () => {
    const ids = tokenize("abc abc abc abc abc abc abc abc abc", data, opts);
    expect(ids.length).toBe(8);
    expect(ids[0]).toBe(100);
    expect(ids[7]).toBe(101);
  });
  it("liefert immer exakt maxLen Tokens (Padding)", () => {
    expect(tokenize("", data, opts).length).toBe(8);
  });
  it("merged NICHT am Wortende, wenn nur die nicht-finale Regel existiert (exact match wie CLIP)", () => {
    const d: TokenizerData = { vocab: { "a": 1, "b</w>": 2, "ab</w>": 3 }, merges: ["a b"] };
    const ids = tokenize("ab", d, { maxLen: 6, bos: 100, eos: 101, pad: 101 });
    // Pair (a, b</w>) darf NICHT über die Regel "a b" gemerged werden → Tokens a, b</w>
    expect(Array.from(ids)).toEqual([100, 1, 2, 101, 101, 101]);
  });
});
