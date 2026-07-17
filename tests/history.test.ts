import { describe, expect, it } from "vitest";
import { HISTORY_LIMIT, historyLabel, pushHistory, groupByPrompt, deleteEntry } from "../src/core/history";
import type { HistoryEntry } from "../src/core/settings";

function e(prompt: string, seed: number, steps = 4, created = "2026-07-17T10:00:00"): HistoryEntry {
  return { prompt, seed, steps, model: "sd-turbo", created };
}

describe("pushHistory", () => {
  it("nimmt den ersten Eintrag auf", () => {
    expect(pushHistory([], e("an apple", 1))).toEqual([e("an apple", 1)]);
  });

  it("stellt Neues nach vorn", () => {
    expect(pushHistory([e("a", 1)], e("b", 2))).toEqual([e("b", 2), e("a", 1)]);
  });

  it("dedupliziert nach vollem Rezept (prompt+seed+steps identisch → nach vorn)", () => {
    const list = [e("a", 1), e("b", 2), e("c", 3)];
    expect(pushHistory(list, e("c", 3))).toEqual([e("c", 3), e("a", 1), e("b", 2)]);
  });

  it("behält Variationen: gleicher Prompt, anderer Seed = eigener Eintrag", () => {
    const next = pushHistory([e("a", 1)], e("a", 2));
    expect(next).toEqual([e("a", 2), e("a", 1)]);
  });

  it("behandelt anderen Steps-Wert als eigenes Rezept", () => {
    const next = pushHistory([e("a", 1, 4)], e("a", 1, 2));
    expect(next).toHaveLength(2);
  });

  it("trimmt den Prompt und erkennt das Duplikat trotz Whitespace", () => {
    const next = pushHistory([e("a", 1)], { ...e("  a  ", 1), prompt: "  a  " });
    expect(next).toEqual([e("a", 1)]);
  });

  it("ignoriert leere und reine Whitespace-Prompts", () => {
    expect(pushHistory([e("a", 1)], e("", 9))).toEqual([e("a", 1)]);
    expect(pushHistory([e("a", 1)], e("   ", 9))).toEqual([e("a", 1)]);
  });

  it("schneidet am Limit ab und wirft den ältesten weg", () => {
    const full = Array.from({ length: HISTORY_LIMIT }, (_, i) => e(`p${i}`, i));
    const next = pushHistory(full, e("neu", 999));
    expect(next).toHaveLength(HISTORY_LIMIT);
    expect(next[0]).toEqual(e("neu", 999));
    expect(next.some((x) => x.prompt === `p${HISTORY_LIMIT - 1}`)).toBe(false);
  });

  it("mutiert die Eingabeliste nicht", () => {
    const list = [e("a", 1)];
    pushHistory(list, e("b", 2));
    expect(list).toEqual([e("a", 1)]);
  });
});

describe("groupByPrompt", () => {
  it("gruppiert nach Prompt, Gruppen nach jüngstem Eintrag zuerst, innen neueste zuerst", () => {
    // Liste ist MRU (neueste zuerst): a@t3, b@t2, a@t1
    const list = [e("a", 3, 4, "t3"), e("b", 2, 4, "t2"), e("a", 1, 4, "t1")];
    expect(groupByPrompt(list)).toEqual([
      { prompt: "a", entries: [e("a", 3, 4, "t3"), e("a", 1, 4, "t1")] },
      { prompt: "b", entries: [e("b", 2, 4, "t2")] },
    ]);
  });

  it("liefert eine leere Liste für leere Historie", () => {
    expect(groupByPrompt([])).toEqual([]);
  });
});

describe("deleteEntry", () => {
  it("entfernt genau den passenden Eintrag über Wert (nicht Index)", () => {
    const list = [e("a", 1), e("a", 2), e("b", 3)];
    expect(deleteEntry(list, e("a", 2))).toEqual([e("a", 1), e("b", 3)]);
  });

  it("lässt die Liste unverändert, wenn nichts passt", () => {
    const list = [e("a", 1)];
    expect(deleteEntry(list, e("z", 9))).toEqual([e("a", 1)]);
  });

  it("mutiert die Eingabeliste nicht", () => {
    const list = [e("a", 1)];
    deleteEntry(list, e("a", 1));
    expect(list).toEqual([e("a", 1)]);
  });
});

describe("historyLabel", () => {
  it("lässt kurze Prompts unverändert", () => {
    expect(historyLabel("an apple")).toBe("an apple");
  });

  it("kürzt lange Prompts mit Ellipse", () => {
    const label = historyLabel("x".repeat(80), 10);
    expect(label).toBe("xxxxxxxxx…");
    expect(label).toHaveLength(10);
  });

  it("ersetzt Zeilenumbrüche durch Leerzeichen", () => {
    expect(historyLabel("a\nb")).toBe("a b");
  });
});
