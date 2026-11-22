// Workflow-Bibliothek: die Workflows eines Vault-Ordners samt Rolle. Pure — der Wirt (main.ts) liest den Ordner und
// übergibt Pfad und Inhalt; hier wird nur geurteilt, damit Ordnerzustände ohne Vault testbar bleiben.
//
// Die Auswahl je Rolle ist ein Dateiname. Fehlt die gewählte Datei oder ist sie ungültig, gilt die erste gültige der
// Rolle (Sortierung nach Dateiname): ein gelöschter Workflow lässt die Stellung bedienbar, statt sie still zu sperren.
import { baseName } from "../../vendor/kit/rel-path";
import { classifyWorkflow, type Classified, type RoleError, type WorkflowRole } from "./workflow";

type Valid = Exclude<Classified, { role: null }>;

/** Warum eine Datei im Ordner nicht benutzbar ist — ein Grund je Ausgang, fuer Einstellungen und Statuszeile. */
export type WorkflowProblem = RoleError | { kind: "json" };

export interface LibraryEntry {
  path: string;
  /** Dateiname im Ordner — die Kennung der Auswahl. */
  file: string;
  /** Anzeigename: Dateiname ohne `.api.json` bzw. `.json`. Zwei Dateien können denselben Namen tragen. */
  name: string;
  /** Rohes JSON, wie es im Vault steht: der Client parst selbst und arbeitet auf dem unveränderten Graphen. */
  json: string;
  classified: Valid | { role: null; error: WorkflowProblem };
}

export type LibraryState =
  | { kind: "unconfigured" }
  | { kind: "missing"; folder: string }
  | { kind: "ok"; folder: string; entries: LibraryEntry[] };

/** Ein gültiger Workflow der gewählten Rolle, fertig für den Client. */
export type ActiveWorkflow = { file: string; name: string; json: string } & Valid;

function displayName(file: string): string {
  if (file.endsWith(".api.json")) return file.slice(0, -".api.json".length);
  return file.endsWith(".json") ? file.slice(0, -".json".length) : file;
}

/** `files` ist der Ordnerinhalt (beliebige Tiefe, beliebige Endungen; gezählt werden nur direkte `.json`-Kinder) oder
 *  null, wenn der Ordner fehlt. */
export function libraryFrom(folder: string, files: { path: string; raw: string }[] | null): LibraryState {
  const dir = folder.trim().replace(/\/+$/, "");
  if (dir === "") return { kind: "unconfigured" };
  if (files === null) return { kind: "missing", folder: dir };
  const entries: LibraryEntry[] = [];
  for (const f of files) {
    if (f.path !== `${dir}/${baseName(f.path)}` || !f.path.endsWith(".json")) continue;
    const file = baseName(f.path);
    let classified: LibraryEntry["classified"];
    try {
      classified = classifyWorkflow(JSON.parse(f.raw));
    } catch {
      classified = { role: null, error: { kind: "json" } };
    }
    entries.push({ path: f.path, file, name: displayName(file), json: f.raw, classified });
  }
  entries.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { kind: "ok", folder: dir, entries };
}

function toActive(e: LibraryEntry): ActiveWorkflow | null {
  const c = e.classified;
  return c.role === null ? null : { file: e.file, name: e.name, json: e.json, ...c };
}

/** Die gültigen Workflows einer Rolle, in Ordnerreihenfolge. */
export function entriesOf(s: LibraryState, role: WorkflowRole): ActiveWorkflow[] {
  if (s.kind !== "ok") return [];
  return s.entries.map(toActive).filter((a): a is ActiveWorkflow => a !== null && a.role === role);
}

/** Der Workflow, mit dem eine Rolle rechnet: die gewählte Datei, sonst die erste gültige der Rolle, sonst null. */
export function activeEntry(s: LibraryState, role: WorkflowRole, selected: string): ActiveWorkflow | null {
  const all = entriesOf(s, role);
  return all.find((a) => a.file === selected) ?? all[0] ?? null;
}
