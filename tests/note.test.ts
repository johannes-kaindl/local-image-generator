import { describe, expect, it } from "vitest";
import { buildImageNote } from "../src/core/note";
import type { GenParams } from "../src/core/viewmodel";

const params = (over: Partial<GenParams> = {}): GenParams => ({
  initImage: null,
  denoising: null,
  prompt: "an apple",
  seed: 199801046,
  steps: 4,
  model: "sd-turbo",
  width: 512,
  height: 512,
  date: "2026-07-16T21:52:43",
  negativePrompt: "",
  cfg: 7,
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
        "cfg: 7",
        "model: sd-turbo",
        "width: 512",
        "height: 512",
        "created: 2026-07-16T21:52:43",
        'image: "[[Art/lig-20260716-215243-s199801046.png]]"',
        "---",
        "",
        "![[Art/lig-20260716-215243-s199801046.png]]",
        "",
      ].join("\n"),
    );
  });

  it("Frontmatter enthält cfg immer, auch bei negativePrompt=''", () => {
    const note = buildImageNote(params(), "x.png");
    expect(note).not.toContain("negative_prompt");
    expect(note).toContain("cfg: 7");
  });

  // C1 (Final-Review 2026-09-06): im comfy-Modus bestimmt das Plugin das CFG NICHT — der
  // Workflow laeuft mit dem Wert, den der Nutzer eingestellt hat. Eine Notiz mit `cfg: 1`
  // waere dieselbe erfundene Angabe, gegen die die Steps-Abweisung gebaut wurde. Der zweite
  // Fall ist die Gegenprobe: ohne ihn waere der Test von "cfg wird NIE geschrieben" nicht
  // unterscheidbar.
  it("laesst cfg bei null weg — und schreibt es bei einer Zahl sehr wohl", () => {
    expect(buildImageNote(params({ cfg: null }), "x.png")).not.toContain("cfg:");
    expect(buildImageNote(params({ cfg: 1 }), "x.png")).toContain("cfg: 1");
  });

  it("Frontmatter enthält negative_prompt nur bei nicht-leerem Wert, direkt nach prompt", () => {
    const note = buildImageNote(params({ negativePrompt: "blurry, low quality" }), "x.png");
    expect(note).toMatch(/prompt: an apple\nnegative_prompt: "blurry, low quality"\nseed:/);
  });

  it("negativePrompt aus reinem Whitespace erzeugt kein negative_prompt-Feld", () => {
    const note = buildImageNote(params({ negativePrompt: "   " }), "x.png");
    expect(note).not.toContain("negative_prompt");
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

  it("Frontmatter enthält width/height zwischen model und created", () => {
    const note = buildImageNote(
      {
        initImage: null,
        denoising: null,
        prompt: "a",
        seed: 1,
        steps: 2,
        model: "flux2-klein-4b",
        width: 1024,
        height: 576,
        date: "2026-07-18T10:00:00",
        negativePrompt: "",
        cfg: 7,
      },
      "img.png",
    );
    expect(note).toMatch(/model: flux2-klein-4b\nwidth: 1024\nheight: 576\ncreated:/);
  });
});

describe("buildImageNote — img2img", () => {
  it("schreibt denoising und init_image bei einem Lauf mit Vorlage", () => {
    const md = buildImageNote(params({ denoising: 0.4, initImage: "Bilder/a.png" }), "Bilder/neu.png");
    expect(md).toContain("denoising: 0.4");
    expect(md).toContain('init_image: "[[Bilder/a.png]]"');
  });

  it("laesst beide Felder weg, wenn es kein img2img war", () => {
    const md = buildImageNote(params(), "Bilder/neu.png");
    expect(md).not.toContain("denoising");
    expect(md).not.toContain("init_image");
  });

  // Ein Fremdplugin schickt Bytes ohne Vault-Datei. Dann ist der Lauf trotzdem img2img —
  // nur die Herkunft ist nicht benennbar. Die Notiz behauptet dann keine.
  it("schreibt denoising ohne init_image, wenn die Vorlage keinen Pfad hat", () => {
    const md = buildImageNote(params({ denoising: 0.4, initImage: null }), "Bilder/neu.png");
    expect(md).toContain("denoising: 0.4");
    expect(md).not.toContain("init_image");
  });
});
