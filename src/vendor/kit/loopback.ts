// vendored from code-kit@0.80.0, src/ts/pure/loopback.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// New in code-kit (2026-11-03), lifted out of protocol-droid (`acceptedAssetBase`), after the same check had been built three times with different
// coverage: protocol-droid (a regex, no `[::1]`), audio-interface `isLocalServiceUrl` (URL-parsed, `[::1]`, tested against `127.0.0.1.evil.test`) and
// mailstone `isLoopback` (host only). This is the strictest of the three.

/** The host names that mean "this machine": `127.0.0.1`, `localhost` and `::1`, the last one with the brackets `URL.hostname` gives it
 *  (`[::1]`) and without them (`::1`, how an account field or a config file holds it). Exact match, case-insensitive; nothing else.
 *  The argument is a HOST NAME without a port: `127.0.0.1:80` and `[::1]:80` are not hosts and fail. No other spelling of a loopback address
 *  counts (`::ffff:127.0.0.1`, `0:0:0:0:0:0:0:1`, `127.1`, `localhost.`; in a URL, `URL.hostname` has already written `127.1` as `127.0.0.1` when this is asked,
 *  see {@link isHttpsOrLoopbackUrl}): each would be one more thing a setting could say to get a key sent in
 *  clear over http, and no caller needs them (measured against the old `isLoopback` of mailstone, which knew `127.0.0.1`, `::1` and `localhost`).
 *  Since the bare `::1` counts, a caller that held the address unbracketed no longer has to bracket it first (mailstone did). */
export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "[::1]" || h === "::1";
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

/** True for an `https:` URL with a host, or for an `http:` URL that {@link isLoopbackHttpUrl} accepts. For a setting that decides where a key or a
 *  request may go (a mirror, an asset base, a service address): encrypted to any host, or in clear only to this machine. Welle 34, package 5:
 *  audio-interface (`main.ts`, the asset base from local storage) and local-image-generator (`settings.ts`, the mirror URL) each wrote
 *  `isLoopbackHttpUrl(v) || isHttpsUrl(v)` with their own `isHttpsUrl`.
 *
 *  The loopback arm IS `isLoopbackHttpUrl`, there is no second host rule, so the two cannot drift. Anything that is not a string, does not
 *  parse with `new URL`, or has another scheme (`http:` to a foreign host, `ftp:`, `ws:`, `file:`, `javascript:`, `data:`) fails.
 *
 *  **What `URL` does before the rule sees the value** (measured 2026-11-14, Node): it strips leading and trailing blanks and removes tabs and line
 *  breaks inside (`" https://x"` and `"ht\ttps://x"` are `https://x`), so both are true. A caller that stores the value trims it first (both
 *  consumers do). It lowers scheme and host (`HTTPS://EXAMPLE.COM`), and it writes `127.1`, `2130706433`, `0x7f.1` and `127.0.0.1.` as `127.0.0.1`,
 *  so `http://127.1` is true although {@link isLoopbackHost} says `127.1` is no loopback host: that sentence is about the host string, a URL is
 *  normalised before the host is asked. Credentials in an https URL (`https://user:pass@example.com`) stay true: the host is `example.com`, and what to
 *  do about a password in a setting is the caller's. In an http URL they decide nothing, the host after the `@` counts (`http://127.0.0.1@evil.test` fails).
 *  The empty-host check of the https arm cannot fire with WHATWG `URL` (`https://` and `https://:443` do not parse); it is the guard for a URL
 *  implementation that would let one through. */
export function isHttpsOrLoopbackUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.trim() === "") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return url.hostname !== "";
  return isLoopbackHttpUrl(value);
}
