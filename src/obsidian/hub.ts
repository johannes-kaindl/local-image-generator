// Plugin-eigene Tab-Ids für den Kit-Hub. Der Rumpf (Aufbau, Navigation, ARIA) liegt seit
// Kit 0.27.0 in ../vendor/kit-obsidian/hub.ts (buildHubInto); das zugehörige HUB_CSS ist in
// styles.css übernommen — das Kit injiziert bewusst kein CSS.
//
// Diese Datei bleibt als schmale Schicht stehen, weil `TabId` plugin-eigen ist: das Kit kennt
// nur den Generic (`HubPanel<Id extends string>`). Der Re-Export hält die Importzeilen von
// view.ts, generate-panel.ts und history-panel.ts unverändert.
export type TabId = "generate" | "history";

export { buildHubInto } from "../vendor/kit-obsidian/hub";
export type { HubController, HubPanel } from "../vendor/kit-obsidian/hub";
