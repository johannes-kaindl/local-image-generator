import { describe, expect, it } from "vitest";
import { serializeFrontmatter, type FmValue } from "../src/vendor/kit/frontmatter";

const ser = (data: Record<string, FmValue>, order: string[]): string => serializeFrontmatter(data, order);

describe("serializeFrontmatter", () => {
  it("rahmt mit --- und endet mit Newline", () => {
    expect(ser({ a: "x" }, ["a"])).toBe("---\na: x\n---\n");
  });

  it("hält die Reihenfolge aus order ein", () => {
    expect(ser({ b: "2", a: "1" }, ["a", "b"])).toBe("---\na: \"1\"\nb: \"2\"\n---\n");
  });

  it("überspringt Keys aus order, die nicht in data stehen", () => {
    expect(ser({ a: "x" }, ["a", "fehlt"])).toBe("---\na: x\n---\n");
  });

  it("schreibt Zahlen nativ und ungequotet", () => {
    expect(ser({ seed: 199801046 }, ["seed"])).toBe("---\nseed: 199801046\n---\n");
  });

  it("quotet Strings, die wie Zahlen aussehen", () => {
    expect(ser({ a: "199801046" }, ["a"])).toBe("---\na: \"199801046\"\n---\n");
  });

  it("quotet Wikilinks — unquoted bräche [[ das YAML", () => {
    expect(ser({ image: "[[a.png]]" }, ["image"])).toBe("---\nimage: \"[[a.png]]\"\n---\n");
  });

  it("quotet Doppelpunkt-mit-Leerzeichen", () => {
    expect(ser({ a: "foo: bar" }, ["a"])).toBe("---\na: \"foo: bar\"\n---\n");
  });

  it("escapt Anführungszeichen und Backslashes", () => {
    expect(ser({ a: 'he said "hi"' }, ["a"])).toBe('---\na: "he said \\"hi\\""\n---\n');
    expect(ser({ a: 'back\\slash "q"' }, ["a"])).toBe('---\na: "back\\\\slash \\"q\\""\n---\n');
  });

  it("quotet Hash, Kommas und führende Sonderzeichen", () => {
    expect(ser({ a: "tag #x" }, ["a"])).toBe('---\na: "tag #x"\n---\n');
    expect(ser({ a: "x, y" }, ["a"])).toBe('---\na: "x, y"\n---\n');
    expect(ser({ a: "- dash" }, ["a"])).toBe('---\na: "- dash"\n---\n');
  });

  it("quotet YAML-Schlüsselwörter", () => {
    expect(ser({ a: "true" }, ["a"])).toBe('---\na: "true"\n---\n');
    expect(ser({ a: "no" }, ["a"])).toBe('---\na: "no"\n---\n');
  });

  it("quotet führende Emoji", () => {
    expect(ser({ a: "🔥 hot" }, ["a"])).toBe('---\na: "🔥 hot"\n---\n');
  });

  it("emittiert leere Skalare bar (key:)", () => {
    expect(ser({ a: "" }, ["a"])).toBe("---\na:\n---\n");
  });

  it("schreibt Arrays als Flow-Liste", () => {
    expect(ser({ tags: ["a", "b"] }, ["tags"])).toBe("---\ntags: [a, b]\n---\n");
    expect(ser({ tags: [] }, ["tags"])).toBe("---\ntags: []\n---\n");
  });

  it("lässt harmlose Strings unangetastet", () => {
    expect(ser({ a: "an apple" }, ["a"])).toBe("---\na: an apple\n---\n");
  });

  it("lässt einen ISO-Zeitstempel unangetastet", () => {
    expect(ser({ created: "2026-07-16T21:52:43" }, ["created"])).toBe("---\ncreated: 2026-07-16T21:52:43\n---\n");
  });
});
