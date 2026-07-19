// @vitest-environment happy-dom
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MFLUX_STALL_MS, MfluxEngine } from "../src/obsidian/mflux-engine";
import { getModel } from "../src/core/models";

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill(_sig?: string): boolean { this.killed = true; return true; }
}

const REQ = { prompt: "a", seed: 1, steps: 4, width: 512, height: 512 };
const SPEC = getModel("flux2-klein-4b");
const PNG = new Uint8Array([137, 80, 78, 71]);

function makeEngine(child: FakeChild) {
  const removed: string[] = [];
  const engine = new MfluxEngine({
    spawnFn: (() => child) as never,
    mkdtemp: () => "/tmp/lig-test",
    readFile: () => PNG,
    rmrf: (p) => removed.push(p),
  });
  return { engine, removed };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("MfluxEngine", () => {
  it("Erfolgsfall: Steps gemeldet, PNG gelesen, Temp entfernt", async () => {
    const child = new FakeChild();
    const { engine, removed } = makeEngine(child);
    const steps: number[] = [];
    const p = engine.run("/bin/mflux", SPEC, REQ, "", { onDownload: () => {}, onStep: (s) => steps.push(s) });
    child.stderr.emit("data", Buffer.from(" 50%|███| 2/4 [00:05<00:05]\r"));
    child.emit("close", 0);
    await expect(p).resolves.toEqual(PNG);
    expect(steps).toEqual([2]);
    expect(removed).toEqual(["/tmp/lig-test"]);
    expect(engine.busy).toBe(false);
  });

  it("Watchdog: 5 min ohne Output → SIGKILL + reject; späterer close settelt NICHT erneut", async () => {
    const child = new FakeChild();
    const { engine, removed } = makeEngine(child);
    const p = engine.run("/bin/mflux", SPEC, REQ, "", { onDownload: () => {}, onStep: () => {} });
    const guard = p.catch((e: Error) => e); // Rejection sofort beobachten (kein unhandled)
    vi.advanceTimersByTime(MFLUX_STALL_MS + 1);
    expect(child.killed).toBe(true);
    child.emit("close", 137); // der Kill schlägt als close durch — darf nicht doppelt settlen
    expect((await guard as Error).message).toMatch(/stalled/);
    expect(removed).toEqual(["/tmp/lig-test"]);
    expect(engine.busy).toBe(false);
  });

  it("Watchdog re-armt nach Settlement nicht mehr (gepufferte Pipe-Daten nach Kill)", async () => {
    const child = new FakeChild();
    const { engine } = makeEngine(child);
    const p = engine.run("/bin/mflux", SPEC, REQ, "", { onDownload: () => {}, onStep: () => {} });
    const guard = p.catch((e: Error) => e); // Rejection sofort beobachten (kein unhandled)
    vi.advanceTimersByTime(MFLUX_STALL_MS + 1);
    expect(child.killed).toBe(true);
    await guard; // Watchdog hat bereits gerejected (settled === true) — VOR dem close-Event
    // OS liefert nach SIGKILL noch gepufferte stdout/stderr-Daten aus, bevor close kommt:
    child.stderr.emit("data", Buffer.from("late output after kill\n"));
    expect(vi.getTimerCount()).toBe(0); // kein Re-Arm nach Settlement — sonst kickt der Leak-Timer später einen FREMDEN run
    // Auch eine weitere volle Stall-Zeit darf jetzt nichts mehr auslösen (kein Fremd-Kill):
    expect(() => vi.advanceTimersByTime(MFLUX_STALL_MS + 1)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
    child.emit("close", 137); // finales close darf weiterhin nicht erneut settlen
  });

  it("Output resettet den Watchdog", async () => {
    const child = new FakeChild();
    const { engine } = makeEngine(child);
    const p = engine.run("/bin/mflux", SPEC, REQ, "", { onDownload: () => {}, onStep: () => {} });
    vi.advanceTimersByTime(MFLUX_STALL_MS - 1000);
    child.stderr.emit("data", Buffer.from("still alive\n"));
    vi.advanceTimersByTime(MFLUX_STALL_MS - 1000);
    expect(child.killed).toBe(false);
    child.emit("close", 0);
    await p;
  });

  it("Exit ≠ 0 → reject mit letzter stderr-Zeile", async () => {
    const child = new FakeChild();
    const { engine } = makeEngine(child);
    const p = engine.run("/bin/mflux", SPEC, REQ, "", { onDownload: () => {}, onStep: () => {} });
    child.stderr.emit("data", Buffer.from("Traceback…\nValueError: bad prompt\n"));
    child.emit("close", 1);
    await expect(p).rejects.toThrow(/ValueError: bad prompt/);
  });

  it("kill(): reject 'cancelled', danach ist ein neuer run möglich (busy hängt nicht)", async () => {
    const children = [new FakeChild(), new FakeChild()];
    let i = 0;
    const engine = new MfluxEngine({
      spawnFn: (() => children[i++]) as never,
      mkdtemp: () => "/tmp/lig-test",
      readFile: () => PNG,
      rmrf: () => {},
    });
    const p = engine.run("/bin/mflux", SPEC, REQ, "", { onDownload: () => {}, onStep: () => {} });
    const guard = p.catch((e: Error) => e);
    engine.kill();
    children[0]!.emit("close", 137);
    expect((await guard as Error).message).toMatch(/cancelled/);
    expect(engine.busy).toBe(false);
    // Regressionsschutz gegen hängenden busy-Zustand: ein ZWEITER run startet normal…
    const p2 = engine.run("/bin/mflux", SPEC, REQ, "", { onDownload: () => {}, onStep: () => {} });
    children[1]!.emit("close", 0);
    await expect(p2).resolves.toEqual(PNG); // …und das cancelled-Flag von run 1 klebt nicht an run 2.
  });

  it("paralleler run wirft 'engine is busy'", async () => {
    const child = new FakeChild();
    const { engine } = makeEngine(child);
    const p = engine.run("/bin/mflux", SPEC, REQ, "", { onDownload: () => {}, onStep: () => {} });
    await expect(
      engine.run("/bin/mflux", SPEC, REQ, "", { onDownload: () => {}, onStep: () => {} }),
    ).rejects.toThrow(/busy/);
    child.emit("close", 0);
    await p;
  });

  it("Download-Events erreichen onDownload", async () => {
    const child = new FakeChild();
    const { engine } = makeEngine(child);
    const dl: number[] = [];
    const p = engine.run("/bin/mflux", SPEC, REQ, "", { onDownload: (_f, pct) => dl.push(pct), onStep: () => {} });
    child.stderr.emit("data", Buffer.from("model.safetensors:  45%|██| 2.25G/5.00G [01:00]\r"));
    child.emit("close", 0);
    await p;
    expect(dl).toEqual([45]);
  });
});
