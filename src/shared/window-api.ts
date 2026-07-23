export interface WindowChromeState {
  maximized: boolean
  serverUrl: string
}

export interface WindowMenuPosition {
  x: number
  y: number
}

export interface WindowApi {
  getState(): Promise<WindowChromeState>
  minimize(): Promise<void>
  toggleMaximize(): Promise<WindowChromeState>
  close(): Promise<void>
  showMenu(position: WindowMenuPosition): Promise<void>
  onMaximizedChange(listener: (maximized: boolean) => void): () => void
}

export const WINDOW_CHANNELS = {
  getState: 'window:get-state',
  minimize: 'window:minimize',
  toggleMaximize: 'window:toggle-maximize',
  close: 'window:close',
  showMenu: 'window:show-menu',
  maximizedChanged: 'window:maximized-changed',
} as const
