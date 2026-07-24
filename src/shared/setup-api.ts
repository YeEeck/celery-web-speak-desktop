export interface SetupState {
  serverUrl: string
  canCancel: boolean
  startupError: string
  version: string
}

export type SetupResult =
  | { ok: true; serverUrl: string }
  | { ok: false; code: string; message: string }

export interface SetupSaveRequest {
  serverUrl: string
  force: boolean
}

export interface SetupApi {
  getState(): Promise<SetupState>
  validate(serverUrl: string): Promise<SetupResult>
  save(request: SetupSaveRequest): Promise<SetupResult>
  cancel(): Promise<void>
  getRecentServers(): Promise<string[]>
  removeRecentServer(serverUrl: string): Promise<string[]>
}

export const SETUP_CHANNELS = {
  getState: 'setup:get-state',
  validate: 'setup:validate',
  save: 'setup:save',
  cancel: 'setup:cancel',
  getRecentServers: 'setup:get-recent-servers',
  removeRecentServer: 'setup:remove-recent-server',
} as const
