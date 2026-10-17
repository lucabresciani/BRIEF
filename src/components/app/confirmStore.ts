import { create } from 'zustand'

export interface ConfirmRequest {
  title: string
  body: string
  confirm: string
  destructive?: boolean
  resolve: (ok: boolean) => void
}

export const useConfirmStore = create<{ req: ConfirmRequest | null }>(() => ({ req: null }))

/** In-app confirmation (never window.confirm): resolves true when the user confirms. */
export function confirmAction(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useConfirmStore.setState({ req: { ...opts, resolve } }))
}
