/** Shared helpers for organizer preselect candidates. */

export function normalizeProxyName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function lineCandidateKey(lineUserId: string): string {
  return `line:${lineUserId.trim()}`;
}

export function proxyCandidateKey(proxyName: string): string {
  return `proxy:${normalizeProxyName(proxyName)}`;
}
