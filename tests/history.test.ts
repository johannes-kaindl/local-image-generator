import { describe, expect, it } from "vitest";
import { HISTORY_LIMIT, historyLabel, pushHistory } from "../src/core/history";

describe("pushHistory", () => {
  it("nimmt den ersten Prompt auf", () => {
    expect(pushHistory([], "an apple")).toEqual(["an apple"]);
  });

  it("stellt Neues nach vorn", () => {
    expect(pushHistory(["a"], "b")).toEqual(["b", "a"]);
  });

  it("verschiebt ein Duplikat nach vorn statt es zu doppeln", () => {
    expect(pushHistory(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
  });

  it("trimmt den Prompt und erkennt das Duplikat trotz Whitespace", () => {
    expect(pushHistory(["a"], "  a  ")).toEqual(["a"]);
  });

  it("ignoriert leere und reine Whitespace-Prompts", () => {
    expect(pushHistory(["a"], "")).toEqual(["a"]);
    expect(pushHistory(["a"], "   ")).toEqual(["a"]);
  });

  it("schneidet am Limit ab und wirft den ältesten weg", () => {
    const full = Array.from({ length: HISTORY_LIMIT }, (_, i) => `p${i}`);
    const next = pushHistory(full, "neu");
    expect(next).toHaveLength(HISTORY_LIMIT);
    expect(next[0]).toBe("neu");
    expect(next).not.toContain(`p${HISTORY_LIMIT - 1}`);
  });

  it("mutiert die Eingabeliste nicht", () => {
    const list = ["a"];
    pushHistory(list, "b");
    expect(list).toEqual(["a"]);
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
