# Warm-Start-Brief: Store-Warnings & Architektur-Fork

**Datum:** 2026-07-23 · **Status:** Problem-Statement, KEINE entschiedene Architektur ·
**Zweck:** heißer Einstieg für eine Fable-Brainstorming-Session, die den Architektur-Fork
durchdenkt und in einem Design-Doc entscheidet.

> Dies ist ein **Brief**, kein Spec. Ein Spec (`docs/superpowers/specs/`) ist das *Ergebnis*
> des Brainstorms. Dieser Text liefert nur den Kontext, damit die Session nicht bei null
> startet. Nichts hierin ist beschlossen.

---

## 1. Auslöser & Ziel

0.4.4 wurde beim Community-Store-Review erneut in die **manuelle Deeper-Inspection**
geroutet (Bot: „automated review could not be completed → admin investigates" beim 0.4.3-Stand;
0.4.4 „Pending — more checks running"). Der Bot-Report zeigt vier BEHAVIOR/RELEASES-Findings
(unten).

**Jays Zielsetzung (wörtlich sinngemäß):** State-of-the-Art-Code anbieten, der **keine
Warnings wirft**. Wenn die aktuelle Umsetzung das verhindert, einen **neuen Weg** finden.
Leitsatz: *„Das Plugin definiert sich durch das, was es anbietet — nicht durch das Wie."*

Daraus folgt der Auftrag an den Brainstorm: die Features (**lokale Bildgenerierung, keine
Cloud** — Einstieg SD-Turbo, Qualität FLUX.2) erhalten, aber das *Wie* so wählen, dass es
sauber und warning-frei ist.

## 2. Warning → Ursache (verifiziert im Code)

| Finding (Bot) | Severity | Echte Quelle | Narrow-Fix ohne Architektur? |
| --- | --- | --- | --- |
| `main.js > 5 MB` | Warning | Inline gebundelte ORT-WASM (~27 MB); Store verbietet Laufzeit-Code-Nachladen → WASM *muss* inline | Nein (evtl. Teil-Externalisierung als Plugin-Dir-Asset — unsicher, s. §6) |
| `Dynamic Code Execution (eval/new Function)` | Recommendation | Steckt **in** onnxruntime-web (Emscripten-Glue) | Nein — ohne ORT kein In-Process-WebGPU |
| `Direct Filesystem Access (fs)` | Warning | `mflux-engine.ts` (temp-Dir + Output-PNG lesen) + `mflux-host.ts` (Binary-Detection: `existsSync`/`readdirSync`) | Nein — Subprozess-IO |
| `Shell Execution (child_process)` | Warning | `mflux-engine.ts` `spawn` (ein Prozess pro FLUX-Bild) | Nein — dito |

Bestandene Checks: beide Assets haben GitHub-Attestation (Pass), Vault-Write nutzt die
Obsidian-API (Pass).

## 3. Kernbefund: jede Warning ist *tragend* — und keine ist ein Code-Smell

Zwei Dinge, die den Brainstorm rahmen:

1. **Die Warnings sind Fähigkeits-Offenlegungen, keine Qualitätsmängel.** Der Code
   (`model-store.ts`, `mflux-engine.ts`) ist sauber und sorgfältig — Streaming mit `tee()`,
   Watchdog, Teil-Download-Cleanup, scoped temp-Dirs mit Best-Effort-`rm`. `child_process`
   trippt „Shell Execution" **nicht weil der Code schlecht ist**, sondern weil real ein
   Prozess gestartet wird. Der Review-Mechanismus arbeitet korrekt.
2. **Darum ist „sauberer machen" hier kein Refactoring, sondern ein Verschieben der
   Fähigkeit über eine Vertrauensgrenze.** Man entfernt `fs`/`child_process` nicht durch
   besseren Code, sondern nur, indem das Plugin die Systemarbeit nicht mehr selbst tut.

## 4. Konvergenz-Einsicht

Eine echt **warning-freie** Version konvergiert auf **eine** Architektur:

> **Das Plugin wird ein dünner HTTP-Client zu einem lokalen Bild-Dienst.** Es macht nur
> noch `fetch("http://localhost:…")` → kein `fs`, kein `child_process`, kein `eval`, kein
> Großbundle. Der Dienst (ComfyUI / SD.Next / A1111 / ein kleiner eigener Localhost-Server)
> hält Modelle, GPU und ggf. Subprozesse — außerhalb des Plugins.

Das ist das etablierte Obsidian-Muster für schwere lokale ML (die Ollama-Plugins passen so
die Review sauber). Es **ehrt Jays Leitsatz vollständig**: das *Was* (lokal, keine Cloud)
bleibt; nur das *Wie* wandert hinter eine saubere Grenze. **Preis:** der Nutzer betreibt den
lokalen Dienst (bei FLUX/mflux ist das schon heute so). **Verlust:** das „Zero-Install,
läuft einfach"-Versprechen des In-Process-SD-Turbo.

## 5. Architektur-Optionen (für den Brainstorm — nicht entschieden)

- **A — Status quo behalten, Warnings akzeptieren.** In-Process-ORT + mflux-Subprozess. Die
  Findings sind non-blocking und bei Schwester-Plugins (yijing) Realität; die manuelle Review
  ist erwartbar, kein Defekt. Kosten: nie warning-frei; wiederkehrende Deeper-Inspection.
- **B — Thin-Client (Konvergenz aus §4).** Plugin = HTTP-Client zu einem lokalen Dienst.
  Warning-frei. Kosten: externer Dienst nötig; SD-Turbo verliert Zero-Install; neue Frage,
  *welchen* Dienst (fremd wie ComfyUI vs. eigener schlanker Server) und wie das
  yijing-`ImageBackend`-Interface erhalten bleibt.
- **C — Hybrid / Teilwege.** Z.B. FLUX weiter als Subprozess (akzeptiert die zwei mflux-
  Warnings), aber ORT-WASM externalisieren, um `main.js > 5 MB` zu killen; oder SD-Turbo →
  Thin-Client, FLUX bleibt. Jede Teil-Kombi bringt nur *einige* Warnings auf null — zu
  bewerten, ob „ein paar weniger" den Umbau wert ist oder nur A oder B konsequent sind.

Offene Kern-Trade-offs für Fable: Zero-Install vs. Zero-Warning · Selbst-enthalten vs.
externer Dienst · eigener Server (mehr Kontrolle, mehr Wartung) vs. fremder Server (weniger
Wartung, weniger Kontrolle, Format-/Versionsdrift) · Abwärtskompatibilität der Provider-API
0.2 (yijing konsumiert `ImageBackend`).

## 6. Unklarheiten, die der Brainstorm klären sollte

- Lässt sich `main.js < 5 MB` erreichen, indem ORT-WASM als **Plugin-Dir-Asset** (nicht
  remote!) ausgeliefert und via `ort.env.wasm.wasmPaths` geladen wird? Verändert das den
  `eval`-Befund? (Store erlaubt Plugin-eigene lokale Assets; verboten ist *remote* Code.)
- Gibt es einen In-Process-FLUX-Pfad, der real läuft (transformers.js/ORT bei ~4-8 GB)? Das
  Cockpit hält das für unrealistisch — kurz gegenprüfen, nicht annehmen.
- Wenn Thin-Client: eigener minimaler Localhost-Server (Python, vom Nutzer via `uv`/`pipx`
  gestartet, hält SD-Turbo *und* FLUX hinter einer HTTP-API) — Aufwand vs. Fremd-Server?

## 7. Unabhängige, kleinere Baustelle: Integrität & Herkunft der Gewichte

Getrennt vom Warning-Thema, aber im selben Bereich und **auf eigenen Füßen** stehend:

- **Keine Hash-Prüfung.** `isDownloadComplete` vergleicht nur `received === Content-Length`
  (Vollständigkeit, nicht Integrität). Kein SHA-256. Der README sagt sogar „integrity is
  checked against its expected size" — Größe ≠ Integrität.
- **`/resolve/main/`** verfolgt den Branch-HEAD eines **persönlichen** HF-Repos
  (`schmuell/sd-turbo-ort-web`), keinen gepinnten Commit. Ändert sich `main`, laden wir still
  andere Bytes.
- Fix (klein, in sich geschlossen): SHA-256 je Datei ins Manifest, nach Download verifizieren,
  URL auf einen Commit-SHA pinnen. **Entfernt keine Warning**, härtet aber Sicherheit/Vertrauen.
- Hinweis: In Architektur B (Thin-Client) könnte dieser Punkt zum Dienst wandern und sich
  ganz erübrigen — daher *nach* der Architektur-Entscheidung terminieren, nicht davor.

## 8. Nicht verhandelbar / Randbedingungen

- **Identität:** lokal, keine Cloud, Prompts/Bilder verlassen die Maschine nie.
- **Store-Regeln:** kein Laufzeit-Nachladen von *Code*; Gewichte-Download nur auf explizite
  Nutzeraktion; ehrliche README-Offenlegung (existiert bereits vorbildlich, `README.md` §„How
  network and storage are used" — als Stärke bewahren).
- **Provider-API:** yijing-oracle konsumiert das `ImageBackend`-Interface (Provider-API 0.2) —
  Abwärtskompatibilität mitdenken.
- **Bestehende Pure-Core-Trennung** (`src/core` importiert nie `obsidian`) als Architektur-
  Tugend erhalten.

## 9. Zeiger

- Code: `src/obsidian/model-store.ts` (SD-Turbo-Download, Cache API) ·
  `src/core/model-manifest.ts` (URLs, `isDownloadComplete`) ·
  `src/obsidian/mflux-engine.ts` (spawn + fs) · `src/obsidian/mflux-host.ts` (Detection) ·
  `README.md` §„How network and storage are used".
- Cockpit: `10_Pallas/25_Coding/local-image-generator/` (§🧭 Warum, Zeiger auf diesen Brief).
- Vorgeschichte: `docs/superpowers/specs/2026-07-18-multi-modell-flux2-design.md` (warum
  mflux-Subprozess für FLUX gewählt wurde — „Stufe 2" des Ursprungskonzepts).
