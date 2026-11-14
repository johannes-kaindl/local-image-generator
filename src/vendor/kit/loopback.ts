// vendored from code-kit@0.68.0, src/ts/pure/loopback.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// New in code-kit (2026-11-03), lifted out of protocol-droid (`acceptedAssetBase`), after the same check had been built three times with different
// coverage: protocol-droid (a regex, no `[::1]`), audio-interface `isLocalServiceUrl` (URL-parsed, `[::1]`, tested against `127.0.0.1.evil.test`) and
// mailstone `isLoopback` (host only). This is the strictest of the three.

/** The host names that mean "this machine": `127.0.0.1`, `localhost` and `[::1]` (as `URL.hostname` spells it, with brackets). Exact match only. */
export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "[::1]";
}

/** True only for an `http:` URL whose host IS a loopback host. For a setting that is read from a synced file and decides where something is
 *  fetched from or sent to: a value somebody else wrote there must not point at a foreign host.
 *  `http://127.0.0.1.evil.test` fails (the hostname is the whole name, not its prefix), `https:` fails (a loopback service has no certificate),
 *  credentials in front of the host (`http://127.0.0.1@evil.test`) end up with the real host `evil.test` and fail. Anything that is not a string fails. */
export function isLoopbackHttpUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.trim() === "") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "http:" && isLoopbackHost(url.hostname);
}
