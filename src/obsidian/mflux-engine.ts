// Kindprozess-Adapter für mflux (Spec §4.3/§4.4). Kein obsidian-Import — nur node.
// Ein spawn pro Generierung (mflux hat keinen Server-Modus); Abbruch ist deshalb ein
// simples SIGKILL, deterministischer als der WebGPU-Fall. IO ist injizierbar (Tests).
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMfluxArgs, buildMfluxEnv, type MfluxRequest } from "../core/mflux-args";
import { parseMfluxLine, splitChunks } from "../core/mflux-output";
import type { ModelSpec } from "../core/models";

export const MFLUX_STALL_MS = 5 * 60_000;

export interface MfluxDeps {
  spawnFn: typeof spawn;
  mkdtemp(prefix: string): string;
  readFile(p: string): Uint8Array;
  rmrf(p: string): void;
}

export interface MfluxCallbacks {
  onDownload(file: string, pct: number): void;
  onStep(step: number, total: number): void;
}

const DEFAULT_DEPS: MfluxDeps = {
  spawnFn: spawn,
  mkdtemp: (prefix) => mkdtempSync(join(tmpdir(), prefix)),
  readFile: (p) => readFileSync(p),
  rmrf: (p) => rmSync(p, { recursive: true, force: true }),
};

export class MfluxEngine {
  private readonly deps: MfluxDeps;
  private child: ReturnType<typeof spawn> | null = null;
  private cancelled = false;
  private _busy = false;

  constructor(deps?: Partial<MfluxDeps>) {
    this.deps = { ...DEFAULT_DEPS, ...deps };
  }

  get busy(): boolean {
    return this._busy;
  }

  /** Laufenden Prozess abbrechen (View-Close/Unload). Idempotent, no-op ohne Prozess. */
  kill(): void {
    if (this.child) {
      this.cancelled = true;
      this.child.kill("SIGKILL");
    }
  }

  async run(binary: string, spec: ModelSpec, req: MfluxRequest, modelsDir: string, cb: MfluxCallbacks): Promise<Uint8Array> {
    if (this._busy) throw new Error("engine is busy");
    this._busy = true;
    this.cancelled = false;
    const tmp = this.deps.mkdtemp("lig-mflux-");
    const outPath = join(tmp, "out.png");
    try {
      return await new Promise<Uint8Array>((resolve, reject) => {
        // Nur die ERSTE Auflösung zählt: Watchdog-Kill und kill() führen beide später zu
        // einem close-Event — settled verhindert, dass der den Fehler überschreibt.
        let settled = false;
        const settle = (fn: () => void): void => {
          if (settled) return;
          settled = true;
          window.clearTimeout(watchdog);
          fn();
        };
        let watchdog: number;
        const armWatchdog = (): void => {
          if (settled) return; // kein Re-Arm nach Settlement (leaked Timer würde spätere run()-Aufrufe treffen)
          window.clearTimeout(watchdog);
          watchdog = window.setTimeout(() => {
            this.child?.kill("SIGKILL");
            settle(() => reject(new Error("mflux stalled (no output for 5 minutes)")));
          }, MFLUX_STALL_MS);
        };

        const child = this.deps.spawnFn(binary, buildMfluxArgs(spec, req, outPath), {
          env: { ...process.env, ...buildMfluxEnv(modelsDir) },
        });
        this.child = child;
        armWatchdog();

        let lastErrLine = "";
        const buffers = { out: "", err: "" };
        const onData = (which: "out" | "err") => (chunk: Buffer) => {
          if (settled) return; // gepufferte Pipe-Daten nach SIGKILL dürfen weder Watchdog re-armen noch Callbacks feuern
          armWatchdog(); // JEDER Output ist ein Lebenszeichen, auch ungeparster
          const r = splitChunks(buffers[which], chunk.toString());
          buffers[which] = r.rest;
          for (const line of r.lines) {
            if (which === "err") lastErrLine = line;
            const ev = parseMfluxLine(line);
            if (ev?.kind === "download") cb.onDownload(ev.file, ev.pct);
            else if (ev?.kind === "step") cb.onStep(ev.step, ev.total);
          }
        };
        child.stdout?.on("data", onData("out"));
        child.stderr?.on("data", onData("err"));

        child.on("error", (e) => settle(() => reject(e))); // ENOENT etc.
        child.on("close", (code) =>
          settle(() => {
            if (this.cancelled) return reject(new Error("cancelled"));
            if (code !== 0) return reject(new Error(`mflux exited with code ${code}${lastErrLine ? `: ${lastErrLine}` : ""}`));
            try {
              resolve(this.deps.readFile(outPath));
            } catch (e) {
              reject(e instanceof Error ? e : new Error(String(e)));
            }
          }),
        );
      });
    } finally {
      this.child = null;
      this._busy = false;
      try {
        this.deps.rmrf(tmp);
      } catch {
        // Temp-Cleanup ist Best-Effort — ein voller /tmp darf kein Ergebnis entwerten.
      }
    }
  }
}
