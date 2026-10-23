---
paths:
  - "src/core/engine.ts"
  - "src/core/engine-sdxl.ts"
  - "src/core/engine-errors.ts"
  - "src/core/pipeline/**"
  - "src/core/generation.ts"
---

# Eingebaute Engine — Pipeline (Encoder, Tokenizer, UNet-Feeds)

Gotchas zu den Text-Encodern, dem Tokenizer und den Session-Feeds der eingebauten Engine (`src/core/engine*.ts`, `src/core/pipeline/`).

- **SDXLs Text-Encoder liefern die Hidden States als INDIZIERTE EINZELAUSGAENGE**, nicht als
  einen Ausgang `hidden_states`: `hidden_states.0` … `.12` beim ersten (CLIP-L, 13 Stueck) und
  `.0` … `.32` beim zweiten (bigG, 33 Stueck). SDXL braucht den VORLETZTEN — also `.11` bzw.
  `.31`. Wer auf den Namen `hidden_states` prueft, findet nie etwas; wer `last_hidden_state`
  nimmt, bekommt kein Fehlerbild, sondern ein stillschweigend schlechteres Bild.
  Ebenso: beim zweiten Encoder steht `text_embeds` (pooled) an Position 0, nicht
  `last_hidden_state` — die Reihenfolge der Ausgaenge ist keine Zusage des Exports.
- **Das Pad-Token ist pro Tokenizer verschieden — und die Abweichung sitzt beim ERSTEN.**
  Gemessen 2026-08-23 an den HF-Configs: sd-turbo `!` = 0 · sdxl-turbo `tokenizer` (CLIP-L)
  `<|endoftext|>` = **49407** · sdxl-turbo `tokenizer_2` (bigG) `!` = 0. Der bestehende
  `tokenize()`-Default 0 ist fuer SD-Turbo und den ZWEITEN SDXL-Encoder richtig und fuer den
  ERSTEN falsch. Auch das kostet nur Qualitaet, nie einen Fehler.
- **`pickHidden()` (`src/core/engine-sdxl.ts`) nimmt den VORLETZTEN indizierten
  `hidden_states.N`-Ausgang und faellt NICHT auf `last_hidden_state` zurueck — bewusst.**
  Fehlt der erwartete Index (weniger als zwei indizierte Ausgaenge gefunden), wirft die
  Funktion, statt still ein schlechteres Ergebnis zu liefern (Spec §9-Risiko 1: genau der
  leise Qualitaetsverlust, den ein Fallback waere). Ein Fehlerbild ist hier das gewollte
  Verhalten, kein fehlender Edge-Case.
- **Feeds an die Session anpassen, nie hardcoden:** `Session.inputTypes` (Dtype) UND
  `Session.inputShapes` (Rang). Die eigene Konversion deklariert `timestep` als 0-d-Skalar
  (`shape []`) — `dims [1]` bricht das UNet mit „Gemm: must be 2 dimensional" (gemessen
  2026-08-19, erster Live-Lauf). `scripts/verify-model.mjs` zeigt Dtypes + Shapes.
- **Tokenizer:** CLIP-BPE exact-match (kein `</w>`-Fallback); Referenz ist `js/sd-turbo/index.js` aus microsoft/onnxruntime-inference-examples (nicht `main.js`).
