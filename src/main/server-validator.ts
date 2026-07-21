export type ServerValidationResult =
  | { ok: true; serverUrl: string }
  | { ok: false; code: 'invalid_url' | 'timeout' | 'network_error' | 'unexpected_status' | 'invalid_response'; message: string }

export interface FetchLike {
  (input: string, init?: RequestInit): Promise<Pick<Response, 'ok' | 'status' | 'json'>>
}

export async function validateServer(
  serverUrl: string,
  fetcher: FetchLike,
  timeoutMs = 8_000,
): Promise<ServerValidationResult> {
  let origin: string
  try {
    origin = new URL(serverUrl).origin
  } catch {
    return { ok: false, code: 'invalid_url', message: '服务器地址格式无效' }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(`${origin}/api/health`, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok) {
      return {
        ok: false,
        code: 'unexpected_status',
        message: `健康检查返回 HTTP ${response.status}`,
      }
    }
    const payload: unknown = await response.json().catch(() => null)
    if (!isHealthPayload(payload)) {
      return { ok: false, code: 'invalid_response', message: '健康检查响应格式不正确' }
    }
    return { ok: true, serverUrl: origin }
  } catch (error) {
    if (isAbortError(error)) return { ok: false, code: 'timeout', message: '连接服务器超时' }
    return { ok: false, code: 'network_error', message: '无法连接服务器' }
  } finally {
    clearTimeout(timeout)
  }
}

function isHealthPayload(value: unknown): value is { status: 'ok' } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    (value as Record<string, unknown>).status === 'ok'
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
