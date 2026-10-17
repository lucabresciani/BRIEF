import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { toast } from '@/components/ui/toast'
import { useT } from '@/i18n/I18nProvider'

/**
 * Registers the service worker (production builds only) and asks before applying an update, so an
 * analysis in progress is never reloaded by surprise.
 */
export function PwaPrompt() {
  const t = useT()
  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(err: unknown) {
      if (import.meta.env.DEV) console.debug('[pwa] registration failed', err)
    },
  })

  useEffect(() => {
    if (!offlineReady) return
    toast.add({ title: t('pwa.offlineReady'), type: 'success' })
    setOfflineReady(false)
  }, [offlineReady, setOfflineReady, t])

  useEffect(() => {
    if (!needRefresh) return
    toast.add({
      title: t('pwa.updateAvailable'),
      type: 'info',
      timeout: 0,
      actionProps: { children: t('pwa.reload'), onClick: () => void updateServiceWorker(true) },
    })
  }, [needRefresh, t, updateServiceWorker])

  return null
}
