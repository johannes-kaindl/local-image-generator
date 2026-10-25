// vendored from code-kit@0.36.0, src/ts/pure/format-bytes.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: audio-interface `src/core/engine-manifest.ts:150` (`formatBytes`, base 1024, comma as a parameter),
// local-image-generator `src/core/viewmodel.ts:198` (`formatBytes`, base 1e9/1e6, MB and GB only) and mailstone
// `src/core/render/frontmatter.ts:32` (`humanSize`, base 1024, B/KB/MB). Welle 22, 2026-10-14.
//
// Three bases-and-unit-rows, one form. What differed, and the reason found (or not):
// - **Base 1000, not 1024.** Two of three counted in 1024 while printing "KB/MB/GB" — the SI names for thousands (1024 is
//   KiB). The evidence that decimal is what users compare with: audio-interface's own `AGENTS.md:74` states the voice as
//   "63,2 MB" for 63 201 294 bytes (its code printed "60,3 MB" for it, its test pins that); the SD-Turbo manifest of
//   local-image-generator sums to 2 607 894 306 bytes and its README says "≈ 2.6 GB". The Hugging Face repo pages the
//   models come from, the Finder and mail clients are decimal as well. The 1024 versions have no stated reason.
//   **Consequences the callers must settle** (they are not hidden by this module):
//   - *mailstone* writes `humanSize` into the note frontmatter (`attachments`, `frontmatter.ts:57`) and compares it on
//     every update (`mirror/plan.ts:89`, `rerender.ts:65`). The string is a persisted format (always one decimal, B/KB/MB,
//     base 1024) — switching rewrites every note with an attachment. mailstone keeps `humanSize`; it is a boundary, not drift.
//   - *audio-interface* prints download progress with its own `mb()` (`/ 1048576`, `settings-tab.ts:208`,
//     `status-bar.ts:9`). Next to `formatBytes` it would show "60.3 MB" for a file the row above calls "63,2 MB": switch
//     `mb()` to `/ 1e6` in the same change; `tests/core/engine-manifest.test.ts:66` changes.
//   - Other 1024 places not covered: llm-lab `settings_tab.ts:11` (`BYTES_PER_MB`, an input field, not a label),
//     koda-agent `vault-tools.ts:294` and `panel-vm.ts:299` (counts characters, not bytes).
// - **One decimal below 100, none from 100 on** (audio-interface; mailstone always had one, local-image-generator
//   none at MB). No reason for the other two — "137 MB" and "63.2 MB" read the same at a glance.
// - **KB, MB, GB, TB, and B below 1000.** local-image-generator started at MB (model files only); a size row that
//   can show 120 KB should not show "0 MB". TB is added so that 5 TB does not print "5000 GB".
// - **Decimal separator is a parameter** (audio-interface: the UI language decides; koda-agent's `formatKb` replaces
//   `.` by `,` by hand). It is the only option, because it is the only difference with a reason.
// - **A value that is no size gives "0 B"** (NaN, Infinity, negative). koda-agent's view comment: "render defensively
//   instead of a NaN marker in the chat".
// Not covered on purpose: audio-interface's `mb()` in `settings-tab.ts:208` and `status-bar.ts:9` print a progress
// *pair* ("12.3 / 60.3 MB") in one fixed unit so that both numbers share it — formatBytes picks a unit per value.

/** Options for {@link formatBytes}. */
export interface FormatBytesOptions {
  /** The character between the integer and the decimal part. Default `"."`. */
  decimalSeparator?: string;
}

const UNITS: readonly string[] = ["B", "KB", "MB", "GB", "TB"];

/** The figure `formatBytes` prints for `v` in unit `u`: whole bytes, one decimal below 100, whole numbers from 100. */
function rounded(v: number, u: number): number {
  return u > 0 && v < 100 ? Math.round(v * 10) / 10 : Math.round(v);
}

/** A byte count as a short label: `"512 B"`, `"1.5 KB"`, `"63.2 MB"`, `"137 MB"`, `"2.6 GB"`. Base 1000.
 *  A figure that rounds up to 1000 moves to the next unit (`999 500` → `"1.0 MB"`, never `"1000 KB"`), one that
 *  rounds up to 100 loses its decimal (`99 950` → `"100 KB"`, never `"100.0 KB"`). `NaN`, `±Infinity` and negative
 *  values give `"0 B"`.
 *
 *  @example formatBytes(63_201_294)                          // → "63.2 MB"
 *  @example formatBytes(63_201_294, { decimalSeparator: "," }) // → "63,2 MB" */
export function formatBytes(n: number, opts: FormatBytesOptions = {}): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  let v = n;
  let u = 0;
  while (u < UNITS.length - 1 && rounded(v, u) >= 1000) {
    v /= 1000;
    u++;
  }
  const r = rounded(v, u);
  const text = u > 0 && r < 100 ? r.toFixed(1) : String(r);
  const sep = opts.decimalSeparator ?? ".";
  return `${sep === "." ? text : text.replace(".", sep)} ${UNITS[u]}`;
}
