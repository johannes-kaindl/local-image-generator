// vendored from code-kit@0.87.0, src/ts/pure/multipart-body.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: first use local-image-generator (upload of an init image to ComfyUI's `/upload/image`, 2026-11-22). Obsidian's
// `requestUrl` has no FormData; a caller builds the body itself and sends it as an ArrayBuffer with the returned
// content type. No other multipart builder existed in code-kit, obsidian-kit or the plugins (searched 2026-11-22).

/** One field of a `multipart/form-data` body (RFC 7578): a text value, or a file with name, type and bytes. */
export type MultipartPart =
  | { name: string; value: string }
  | { name: string; filename: string; contentType: string; data: Uint8Array };

// Boundary characters from RFC 2046 §5.1.1 without the space (a trailing space is legal there and a trap here).
const BOUNDARY = /^[0-9A-Za-z'()+_,\-./:=?]{1,70}$/;

function checkHeaderValue(label: string, v: string): void {
  // Rejected, not escaped: RFC 7578 leaves the escaping of `"` open and servers disagree on it (percent-encoding vs.
  // backslash), and a CR or LF would let the value write its own header line.
  if (/["\r\n]/.test(v)) throw new RangeError(`multipart: ${label} must not contain '"', CR or LF`);
}

function contains(hay: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** The body and content type for a `multipart/form-data` request. Text values go as UTF-8; file bytes are copied
 *  exactly (a `subarray` view as the view). Throws `RangeError` for a malformed boundary, for a name, filename or
 *  content type with `"`, CR or LF, and for a part that contains `--<boundary>` — the receiver would cut it there. */
export function buildMultipartBody(parts: MultipartPart[], boundary: string): { body: Uint8Array; contentType: string } {
  if (!BOUNDARY.test(boundary)) throw new RangeError("multipart: boundary must be 1–70 characters of RFC 2046 bchars without space");
  const enc = new TextEncoder();
  const delimiter = enc.encode(`--${boundary}`);
  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    checkHeaderValue("name", part.name);
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`;
    let data: Uint8Array;
    if ("value" in part) {
      data = enc.encode(part.value);
      head += "\r\n\r\n";
    } else {
      checkHeaderValue("filename", part.filename);
      checkHeaderValue("content type", part.contentType);
      data = part.data;
      head += `; filename="${part.filename}"\r\nContent-Type: ${part.contentType}\r\n\r\n`;
    }
    if (contains(data, delimiter)) throw new RangeError(`multipart: part "${part.name}" contains the boundary`);
    chunks.push(enc.encode(head), data, enc.encode("\r\n"));
  }
  chunks.push(enc.encode(`--${boundary}--\r\n`));
  const body = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    body.set(c, at);
    at += c.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
