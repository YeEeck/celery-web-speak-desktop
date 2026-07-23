export type ApplicationMenuAction = 'switch-server' | 'reload' | 'check-update' | 'toggle-auto-check' | 'about' | 'quit'

export const MENU_CHANNELS = {
  execute: 'menu:execute',
  dismiss: 'menu:dismiss',
  getState: 'menu:get-state',
} as const

export interface MenuState {
  autoCheckUpdate: boolean
}
