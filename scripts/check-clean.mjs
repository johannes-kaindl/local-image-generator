// Store-Scanner-Vorwegnahme (Spec §7): main.js darf keine System-Fähigkeiten tragen und
// muss klein bleiben. Läuft NACH esbuild gegen das Artefakt (nicht src/): genau das prüft
// auch der Scanner. Lesson „Scanner ≠ lokaler Lint" (_docs/LESSONS.md 2026-07-23).
import { readFileSync, statSync } from "node:fs";

const MAX_BYTES = 2 * 1024 * 1024;
const FORBIDDEN = [/require\(["']child_process["']\)/, /require\(["']fs["']\)/, /require\(["']original-fs["']\)/, /\beval\(/, /new Function\(/];

const size = statSync("main.js").size;
if (size > MAX_BYTES) {
  console.error(`check-clean: main.js ist ${(size / 1e6).toFixed(1)} MB (> ${MAX_BYTES / 1e6} MB) — Thin-Client-Versprechen verletzt.`);
  process.exit(1);
}
const src = readFileSync("main.js", "utf8");
const hit = FORBIDDEN.find((re) => re.test(src));
if (hit) {
  console.error(`check-clean: verbotenes Muster im Bundle: ${hit}`);
  process.exit(1);
}
console.log(`check-clean: ok (${(size / 1024).toFixed(0)} KB, keine System-Fähigkeiten im Bundle)`);
