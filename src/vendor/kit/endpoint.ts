// vendored from obsidian-kit@0.1.0, src/pure/endpoint.ts — do not hand-edit
export function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "").replace(/\/v1$/, "").replace(/\/+$/, "");
}
