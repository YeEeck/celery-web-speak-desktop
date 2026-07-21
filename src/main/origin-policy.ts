export function isTrustedOrigin(candidate: string | undefined, serverUrl: string): boolean {
  if (!candidate) return false
  try {
    return new URL(candidate).origin === new URL(serverUrl).origin
  } catch {
    return false
  }
}

export function canGrantPermission(
  requestingUrl: string | undefined,
  embeddingOrigin: string | undefined,
  serverUrl: string,
): boolean {
  return isTrustedOrigin(requestingUrl, serverUrl) && isTrustedOrigin(embeddingOrigin, serverUrl)
}
