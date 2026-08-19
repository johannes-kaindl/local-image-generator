// Aufräumer für den 0.x-In-Process-Cache (Spec §4): die SD-Turbo-Gewichte (~2,5 GB) liegen
// bei Bestandsinstallationen noch in der Cache API. Name übernommen aus model-store.ts (0.4)
// — als Literal kopiert statt importiert, weil model-store.ts in Task 8 komplett entfällt und
// dieser Aufräumer gerade NICHT mehr davon abhängen soll.
const LEGACY_CACHE = "local-image-generator-models";

/** Liegen noch 0.4-Gewichte da? Zählt Einträge, nicht den Namen: ein leerer Cache (Name
 *  existiert, kein Byte drin — gemessen 2026-08-19 nach einem abgebrochenen Löschen) erzeugte
 *  sonst bei jedem Plugin-Start denselben „2,5 GB"-Hinweis. Der leere Name wird still entfernt. */
export async function hasLegacyCache(): Promise<boolean> {
  try {
    if (!(await caches.has(LEGACY_CACHE))) return false;
    const cache = await caches.open(LEGACY_CACHE);
    if ((await cache.keys()).length > 0) return true;
    await caches.delete(LEGACY_CACHE);
    return false;
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
