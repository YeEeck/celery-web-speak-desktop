export type ApplicationMenuAction = 'switch-server' | 'reload' | 'check-update' | 'toggle-auto-check' | 'toggle-autostart' | 'about' | 'quit'

export const MENU_CHANNELS = {
  execute: 'menu:execute',
  dismiss: 'menu:dismiss',
  getState: 'menu:get-state',
} as const

export interface MenuState {
  checks: Partial<Record<ApplicationMenuAction, boolean>>
}
