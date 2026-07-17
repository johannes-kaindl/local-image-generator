/** Einklappbare Settings-Sektion.
 *  VENDORED aus `obsidian-kit/src/obsidian/collapsible.ts` (Stand 2026-07-16).
 *  Abweichung: der `COLLAPSIBLE_CSS`-Export des Originals entfällt — das Snippet steht
 *  wörtlich in unserer styles.css (das Kit injiziert bewusst kein CSS selbst).
 *  Liegt in src/obsidian/ und NICHT in src/vendor/kit/, weil es `obsidian` importiert
 *  und check:pure dort hart fehlschlägt. */
import { setIcon } from "obsidian";

/** Optionaler Persistenz-Callback für den Auf-/Zu-Zustand. Der Consumer verdrahtet ihn
 *  an seinen eigenen Speicher (z. B. data.json); das Kit bleibt storage-agnostisch. */
export interface CollapsibleStorage {
  /** Persistierter Zustand, oder `undefined` wenn für den Key noch nichts gespeichert ist
   *  (dann greift `defaultCollapsed`). */
  getCollapsed(key: string): boolean | undefined;
  setCollapsed(key: string, collapsed: boolean): void;
}

export interface CollapsibleOptions {
  /** Sichtbarer Sektions-Titel (im setHeading-Look). */
  title: string;
  /** Startzustand ohne persistierten Wert. Default: true (eingeklappt). */
  defaultCollapsed?: boolean;
  /** Stabiler Schlüssel für die Persistenz (nur mit storage wirksam). */
  key?: string;
  storage?: CollapsibleStorage;
}

/** Löst den initialen Collapsed-Zustand auf: persistierter Wert falls gesetzt, sonst
 *  defaultCollapsed. Pure — kein DOM. */
export function resolveCollapsed(
  key: string | undefined,
  defaultCollapsed: boolean,
  storage?: CollapsibleStorage,
): boolean {
  const stored = key && storage ? storage.getCollapsed(key) : undefined;
  return stored ?? defaultCollapsed;
}

/** Rendert eine einklappbare Sektion (klickbarer Header + Body) in containerEl und gibt den
 *  Body-Container zurück — der Consumer baut seine Inhalte dort hinein. */
export function collapsibleSection(containerEl: HTMLElement, opts: CollapsibleOptions): HTMLElement {
  const defaultCollapsed = opts.defaultCollapsed ?? true;
  let collapsed = resolveCollapsed(opts.key, defaultCollapsed, opts.storage);

  const section = containerEl.createDiv({ cls: "okit-collapsible" });
  const header = section.createDiv({ cls: "okit-collapsible-header" });
  // a11y: der Header ist funktional ein Aufklapp-Schalter — fokussierbar + rollen-/
  // zustands-annotiert, damit er per Tastatur und von Screenreadern bedienbar ist.
  header.setAttribute("role", "button");
  header.setAttribute("tabindex", "0");
  const chevron = header.createSpan({ cls: "okit-collapsible-chevron" });
  header.createSpan({ cls: "okit-collapsible-title", text: opts.title });
  const body = section.createDiv({ cls: "okit-collapsible-body" });

  const apply = (): void => {
    setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");
    header.setAttribute("aria-expanded", String(!collapsed));
    body.toggleClass("is-collapsed", collapsed);
    section.toggleClass("is-collapsed", collapsed);
  };
  apply();

  const toggle = (): void => {
    collapsed = !collapsed;
    if (opts.key && opts.storage) opts.storage.setCollapsed(opts.key, collapsed);
    apply();
  };

  header.addEventListener("click", () => {
    toggle();
  });
  header.addEventListener("keydown", (evt: KeyboardEvent) => {
    // Enter/Leertaste sind die Standard-Aktivierung eines role="button"; bei der Leertaste
    // sonst scrollt die Seite, daher preventDefault (bei Enter unschädlich).
    if (evt.key === "Enter" || evt.key === " ") {
      evt.preventDefault();
      toggle();
    }
  });

  return body;
}
