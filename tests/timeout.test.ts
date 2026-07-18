import { describe, expect, it, vi } from "vitest";
import { raceTimeout } from "../src/core/timeout";

describe("raceTimeout", () => {
  it("löst normal auf, wenn die Promise vor dem Timeout resolved", async () => {
    const result = await raceTimeout(Promise.resolve("done"), 1000, "too slow");
    expect(result).toBe("done");
  });

  it("wirft mit der übergebenen Message, wenn das Timeout zuerst feuert", async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => {});
    const raced = raceTimeout(never, 1000, "too slow");
    const assertion = expect(raced).rejects.toThrow("too slow");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    vi.useRealTimers();
  });

  it("räumt den Timer auf, wenn die Promise VOR dem Timeout ablehnt", async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(global, "clearTimeout");
    await expect(raceTimeout(Promise.reject(new Error("boom")), 1000, "too slow")).rejects.toThrow("boom");
    expect(clearSpy).toHaveBeenCalled();
    vi.useRealTimers();
    clearSpy.mockRestore();
  });
});
