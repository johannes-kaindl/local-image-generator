// Aufräumer für den 0.x-In-Process-Cache (Spec §4): die SD-Turbo-Gewichte (~2,5 GB) liegen
// bei Bestandsinstallationen noch in der Cache API. Name übernommen aus model-store.ts (0.4)
// — als Literal kopiert statt importiert, weil model-store.ts in Task 8 komplett entfällt und
// dieser Aufräumer gerade NICHT mehr davon abhängen soll.
const LEGACY_CACHE = "local-image-generator-models";

export async function hasLegacyCache(): Promise<boolean> {
  try {
    return await caches.has(LEGACY_CACHE);
  } catch {
    return false;
  }
}

export async function deleteLegacyCache(): Promise<void> {
  try {
    await caches.delete(LEGACY_CACHE);
  } catch {
    /* Best-Effort — Cache API kann in Testumgebungen fehlen */
  }
}
