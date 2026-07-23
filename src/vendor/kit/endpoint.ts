// vendored from obsidian-kit, src/pure/endpoint.ts
export function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "").replace(/\/v1$/, "").replace(/\/+$/, "");
}
