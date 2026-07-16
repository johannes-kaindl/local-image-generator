import { describe, expect, it } from "vitest";
import { buildImageFilename, dedupeFilename, buildNoteFilename, dirOf, isoStamp } from "../src/core/filename";

describe("buildImageFilename", () => {
  it("Schema lig-YYYYMMDD-HHmmss-s<seed>.png", () => {
    const d = new Date(2026, 6, 16, 14, 5, 9); // 16. Juli 2026, 14:05:09 lokal
    expect(buildImageFilename(d, 12345)).toBe("lig-20260716-140509-s12345.png");
  });
});

describe("dedupeFilename", () => {
  it("gibt den Basis-Pfad zurück, wenn er frei ist", () => {
    expect(dedupeFilename("art/pic.png", () => false)).toBe("art/pic.png");
  });
  it("hängt -2 vor .png an, wenn der Basis-Pfad belegt ist", () => {
    const taken = new Set(["art/pic.png"]);
    expect(dedupeFilename("art/pic.png", (p) => taken.has(p))).toBe("art/pic-2.png");
  });
  it("zählt hoch, bis ein freier Pfad gefunden ist", () => {
    const taken = new Set(["art/pic.png", "art/pic-2.png", "art/pic-3.png"]);
    expect(dedupeFilename("art/pic.png", (p) => taken.has(p))).toBe("art/pic-4.png");
  });
});

describe("buildNoteFilename", () => {
  it("baut Slug + Seed nach dem Muster aus dem Smoke-Test", () => {
    expect(buildNoteFilename("Apple - Sumi-e painting", 199801046)).toBe("Apple - Sumi-e painting - 199801046.md");
  });

  it("entfernt in Obsidian verbotene Zeichen", () => {
    expect(buildNoteFilename('a[b]c#d^e|f/g\\h:i*j?k"l<m>n', 1)).toBe("a b c d e f g h i j k l m n - 1.md");
  });

  it("kollabiert Whitespace", () => {
    expect(buildNoteFilename("a   b\n\nc", 1)).toBe("a b c - 1.md");
  });

  it("kürzt überlange Slugs auf 60 Zeichen", () => {
    const name = buildNoteFilename("x".repeat(80), 1);
    expect(name).toBe(`${"x".repeat(60)} - 1.md`);
  });

  it("lässt am Schnitt keinen Trailing-Space stehen", () => {
    const name = buildNoteFilename(`${"x".repeat(59)}   tail`, 1);
    expect(name).toBe(`${"x".repeat(59)} - 1.md`);
  });

  it("fällt bei leerem Slug auf lig-<seed> zurück", () => {
    expect(buildNoteFilename("", 42)).toBe("lig-42.md");
    expect(buildNoteFilename("   ", 42)).toBe("lig-42.md");
    expect(buildNoteFilename("///", 42)).toBe("lig-42.md");
  });

  it("streift führende Punkte (sonst versteckte Datei)", () => {
    expect(buildNoteFilename("...hidden", 1)).toBe("hidden - 1.md");
    expect(buildNoteFilename("...", 1)).toBe("lig-1.md");
  });

  it("behält Umlaute und Unicode", () => {
    expect(buildNoteFilename("Öl auf Leinwand — Größe", 7)).toBe("Öl auf Leinwand — Größe - 7.md");
  });
});

describe("dirOf", () => {
  it("liefert das Verzeichnis eines Pfads", () => {
    expect(dirOf("Art/Bilder/x.png")).toBe("Art/Bilder");
  });

  it("liefert leeren String im Vault-Root", () => {
    expect(dirOf("x.png")).toBe("");
  });
});

describe("isoStamp", () => {
  it("formatiert lokale Zeit als ISO-8601 ohne Zeitzone", () => {
    expect(isoStamp(new Date(2026, 6, 16, 21, 52, 43))).toBe("2026-07-16T21:52:43");
  });

  it("füllt einstellige Werte auf", () => {
    expect(isoStamp(new Date(2026, 0, 2, 3, 4, 5))).toBe("2026-01-02T03:04:05");
  });
});
