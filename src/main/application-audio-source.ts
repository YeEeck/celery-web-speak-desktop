export interface SourceCandidate {
  id: string
  title: string
  thumbnailEmpty: boolean
}

export function parseWindowSourceId(sourceId: string): string | null {
  const match = /^window:([1-9][0-9]*):(.+)$/.exec(sourceId)
  return match?.[1] ?? null
}

export function isSelectableWindowSource(
  source: SourceCandidate,
  localWindowSourceIds: ReadonlySet<string>,
): boolean {
  if (localWindowSourceIds.has(source.id)) return false
  if (parseWindowSourceId(source.id) === null) return false
  return source.title.trim().length > 0 || !source.thumbnailEmpty
}

