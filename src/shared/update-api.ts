export interface UpdateInfo {
  version: string
  releaseUrl: string
  changelog?: string
}

export interface UpdateCheckResult {
  ok: boolean
  error?: string
}

export interface UpdateStateSnapshot {
  available: boolean
  version: string
}

export const UPDATE_CHANNELS = {
  showDialog: 'update:show-dialog',
} as const
