#!/usr/bin/env node
// check-no-spec-refs.mjs — Kommentare in src/ nennen kein maintainer-lokales Dokument (Spec-Paragraphen, Review-Runden, Fix-Nummern),
// weil Leser des Repos diese Dokumente nicht haben. Der Grund einer Regel steht in dem Kommentar selbst, nicht in einem Verweis.
// src/vendor/ ist ausgenommen: vendorte Dateien werden nie von Hand editiert.
import { execFileSync } from "node:child_process";

const PATTERN = String.raw`Spec[ -]?[0-9§]|Spec §|Final-Review|Review-Fund|Fixrunde|Fix-Runde|C[0-9]-Fix`;

let hits = "";
try {
  hits = execFileSync("git", ["grep", "-I", "-n", "-E", PATTERN, "--", "src", ":(exclude)src/vendor"], { encoding: "utf8" });
} catch (err) {
  // git grep: exit 1 = keine Treffer, alles andere = echter Fehler
  if (err.status === 1) {
    console.log("check-no-spec-refs: OK — keine Verweise auf maintainer-lokale Dokumente in src/ (ohne src/vendor)");
    process.exit(0);
  }
  console.error(`check-no-spec-refs: git grep schlug fehl: ${err.message}`);
  process.exit(2);
}

console.error("check-no-spec-refs: Verweise auf maintainer-lokale Dokumente in src/:");
console.error(hits.trimEnd());
console.error("→ Den Grund sachbezogen in den Kommentar schreiben statt auf Spec-Paragraph, Review oder Fix-Nummer zu verweisen.");
process.exit(1);
