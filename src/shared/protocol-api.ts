export interface ProtocolRange {
  minProtocol: number
  maxProtocol: number
}

export interface ProtocolHello {
  protocol: number
  capabilities: string[]
}

export function normalizeProtocolRange(input: unknown): ProtocolRange | null {
  if (!input || typeof input !== 'object') return null
  const candidate = input as Partial<ProtocolRange>
  if (!Number.isSafeInteger(candidate.minProtocol) || !Number.isSafeInteger(candidate.maxProtocol)) {
    return null
  }
  const minProtocol = candidate.minProtocol as number
  const maxProtocol = candidate.maxProtocol as number
  if (minProtocol < 1 || maxProtocol < minProtocol) return null
  return { minProtocol, maxProtocol }
}
