// Generations-Grenzen (Spec §4) — ersetzen den Modell-Katalog (models.ts stirbt in Task 8):
// der Server hält die Modelle, das Plugin bietet generische, ehrliche Regler.
export interface SizeOption { width: number; height: number; }

export const SIZES: readonly SizeOption[] = [
  { width: 512, height: 512 },
  { width: 768, height: 768 },
  { width: 1024, height: 1024 },
  { width: 768, height: 512 },
  { width: 512, height: 768 },
  { width: 1024, height: 576 },
  { width: 576, height: 1024 },
];
export const DEFAULT_SIZE: SizeOption = SIZES[0]!;

export const STEPS = { min: 1, max: 50, default: 20 } as const;
export const CFG = { min: 1, max: 15, step: 0.5, default: 7 } as const;
