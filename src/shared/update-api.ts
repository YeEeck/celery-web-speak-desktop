export interface UpdateInfo {
  version: string
  releaseUrl: string
}

export interface UpdateCheckResult {
  available: boolean
  info: UpdateInfo | null
}

export const UPDATE_CHANNELS = {
  check: 'update:check',
  dismiss: 'update:dismiss',
  skipVersion: 'update:skip-version',
  openRelease: 'update:open-release',
  stateChanged: 'update:state-changed',
} as const
