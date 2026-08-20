// vendored from obsidian-kit@0.27.0, src/pure/num.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Parsed einen Integer aus String oder Zahl und clamped ihn nach [min, max].
 *  Nicht-finite/ungültige Eingaben → `fallback`. Floats werden via Math.trunc zu Int (kein Round).
 *  Konsolidiert 5 divergente Inlinings (parseInt/Number/parseFloat) auf EINE Semantik;
 *  kanonische Quelle: kuro-gamification SettingsTab.clampInt (12 Call-Sites).
 *
 *  @example clampInt("42", 0, 100, 7) // → 42
 *  @example clampInt("abc", 0, 100, 7) // → 7 (fallback) */
export function clampInt(value: string | number, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}
