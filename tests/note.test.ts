import { describe, expect, it } from "vitest";
import { buildImageNote } from "../src/core/note";
import type { GenParams } from "../src/core/viewmodel";

const params = (over: Partial<GenParams> = {}): GenParams => ({
  prompt: "an apple",
  seed: 199801046,
  steps: 4,
  model: "sd-turbo",
  date: "2026-07-16T21:52:43",
  ...over,
});

describe("buildImageNote", () => {
  it("baut Frontmatter + Embed", () => {
    expect(buildImageNote(params(), "Art/lig-20260716-215243-s199801046.png")).toBe(
      [
        "---",
        "prompt: an apple",
        "seed: 199801046",
        "steps: 4",
        "model: sd-turbo",
        "created: 2026-07-16T21:52:43",
        'image: "[[Art/lig-20260716-215243-s199801046.png]]"',
        "---",
        "",
        "![[Art/lig-20260716-215243-s199801046.png]]",
        "",
      ].join("\n"),
    );
  });

  it("schreibt seed und steps als native Zahlen", () => {
    const note = buildImageNote(params(), "x.png");
    expect(note).toContain("seed: 199801046");
    expect(note).toContain("steps: 4");
  });

  it("quotet einen Prompt mit Doppelpunkt", () => {
    expect(buildImageNote(params({ prompt: "style: sumi-e" }), "x.png")).toContain('prompt: "style: sumi-e"');
  });

  it("quotet einen Prompt mit Wikilink-Klammern", () => {
    expect(buildImageNote(params({ prompt: "see [[note]]" }), "x.png")).toContain('prompt: "see [[note]]"');
  });

  // KORRIGIERT gegenüber Task-Brief: Ein Anführungszeichen MITTEN im Wert löst laut
  // serializeFrontmatter (Task 4, siehe tests/frontmatter.test.ts "lässt Anführungszeichen
  // und Backslashes in der Mitte ungequotet") bewusst KEIN Quoting aus — gültiger
  // YAML-Plain-Scalar. Die Brief-Erwartung 'prompt: "an \"apple\""' widersprach dieser
  // bereits getesteten, dokumentierten Entscheidung; note.ts delegiert das Quoting
  // vollständig an serializeFrontmatter (Step 6 des Briefs), verändert es also nicht.
  it("lässt Anführungszeichen im Prompt ungequotet (gültiger YAML-Plain-Scalar)", () => {
    expect(buildImageNote(params({ prompt: 'an "apple"' }), "x.png")).toContain('prompt: an "apple"');
  });

  it("quotet einen Prompt mit Komma", () => {
    expect(buildImageNote(params({ prompt: "an apple, sumi-e" }), "x.png")).toContain('prompt: "an apple, sumi-e"');
  });

  it("verkraftet einen leeren Prompt", () => {
    expect(buildImageNote(params({ prompt: "" }), "x.png")).toContain("\nprompt:\n");
  });
});
