// Hilfe-Zeile der Settings (UI-STANDARD §8): Doku-Index und Issues dieses Repos, Texte aus i18n.
import { t } from "../vendor/kit/i18n";
import { githubHelpUrls, helpSettingDefinition, type HelpSettingOptions } from "../vendor/kit-obsidian/help-setting";

/** GitHub-Repo-Name, nicht die Plugin-ID (beide heissen hier gleich). */
export const HELP_REPO = "local-image-generator";

export function helpOptions(open?: (url: string) => void): HelpSettingOptions {
  return {
    ...githubHelpUrls(HELP_REPO),
    texts: {
      name: t("settings.help.name"),
      desc: t("settings.help.desc"),
      openDocs: t("settings.help.openDocs"),
      reportIssue: t("settings.help.reportIssue"),
    },
    open,
  };
}

/** Als ERSTES Element von `getSettingDefinitions()`; der Walker-Fallback zeichnet sie auch vor 1.13. */
export function helpDefinition() {
  return helpSettingDefinition(helpOptions());
}
