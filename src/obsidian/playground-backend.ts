// Viertes Backend (Spec 2026-09-27-shortcuts-bridge-design.md, Baustein 5): Image Playground
// per Apple-Kurzbefehl — mobil das EINZIGE Backend, das ist das Kernversprechen der Welle 13.
// Implementiert dasselbe ImageBackend wie A1111Client/ComfyClient/LocalEngineBackend — main.ts
// sieht keinen Unterschied. Kein obsidian-Import: die Bruecke selbst (aus src/vendor/kit-obsidian,
// braucht eine Plugin-Instanz) wird injiziert, wie Store/Session-Fabrik bei LocalEngineBackend.
import type { ImageBackend, ImageRequest } from "../core/txt2img";

export interface PlaygroundBridge {
  run(req: {
    shortcut: string;
    input: string;
    timeoutMs: number;
    expectFile: { vaultPathPrefix: string };
  }): Promise<{ ok: true; file?: string; durationMs: number } | { ok: false; reason: string; message: string; durationMs: number }>;
}

export interface PlaygroundDeps {
  bridge: PlaygroundBridge;
  /** Vault-relativer Pfad → Bytes (`app.vault.adapter.readBinary`, injiziert wie bei
   *  LocalEngineBackend). */
  readBinary: (path: string) => Promise<ArrayBuffer>;
  /** Raeumt die vom Kurzbefehl geschriebene Rohdatei auf, NACHDEM sie gelesen wurde — sonst
   *  entstuende ein Duplikat: die normale Panel-Pipeline (main.ts::resolveImagePath) schreibt
   *  das zurueckgegebene Base64-Bild gleich noch einmal an den eigentlichen Zielpfad mit der
   *  ueblichen Namensgebung/Dedup. Zwei Kopien desselben Bilds im selben Ordner waeren die
   *  Ueberraschung, kein Feature. */
  deleteFile: (path: string) => Promise<void>;
  arrayBufferToBase64: (buf: ArrayBuffer) => string;
}

export class PlaygroundBackend implements ImageBackend {
  constructor(
    private readonly shortcutName: string,
    /** Nutzt bewusst dieselbe Ablage wie der Rest des Plugins (`settings.outputFolder`,
     *  Auftrag Welle 13: "bestehende Attachment-Logik nutzen, nicht neu bauen") — kein
     *  eigenes Zielordner-Setting. */
    private readonly vaultPathPrefix: string,
    private readonly timeoutMs: number,
    private readonly deps: PlaygroundDeps,
  ) {}

  async generate(req: ImageRequest): Promise<string> {
    // Dieselbe Wache wie A1111Client: ein schon abgebrochener Auftrag wird gar nicht erst
    // losgeschickt (AGENTS.md, "`signal` ist im builtin-Modus ein echter Abbruch...").
    if (req.signal?.aborted === true) throw new Error("Lauf abgebrochen (aborted)");
    // negativePrompt/cfg/width/height/denoising werden bewusst NICHT gelesen — der Kurzbefehl
    // nimmt nur den Prompt entgegen. Die Ehrlichkeit darueber sitzt in generation.ts
    // (backendCapabilities, ctx.mode === "playground") und params.ts (cfg: null), nicht hier:
    // ein Backend soll nicht zweimal dieselbe Zusage durchsetzen.
    const result = await this.deps.bridge.run({
      shortcut: this.shortcutName,
      input: req.prompt,
      timeoutMs: this.timeoutMs,
      expectFile: { vaultPathPrefix: this.vaultPathPrefix },
    });
    if (!result.ok) throw new Error(`Image Playground: ${result.reason} — ${result.message}`);
    if (result.file === undefined) throw new Error("Image Playground: kein Bild gefunden");
    const bytes = await this.deps.readBinary(result.file);
    const base64 = this.deps.arrayBufferToBase64(bytes);
    await this.deps.deleteFile(result.file);
    return base64;
  }
}
