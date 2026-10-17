import { useEffect } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/toast'
import { I18nProvider } from '@/i18n/I18nProvider'
import { AppShell } from '@/features/shell/AppShell'
import { startPersistence } from '@/state/persistence'
import { PwaPrompt } from '@/platform/PwaPrompt'
import { ErrorBoundary } from './ErrorBoundary'
import { AreaError } from './AreaError'

export function App() {
  useEffect(() => {
    void startPersistence()
  }, [])
  return (
    <I18nProvider>
      <TooltipProvider delay={500}>
        <Toaster limit={3}>
          <ErrorBoundary fallback={(reset, err) => <AreaError reset={reset} error={err} />}>
            <AppShell />
          </ErrorBoundary>
          {import.meta.env.PROD ? <PwaPrompt /> : null}
        </Toaster>
      </TooltipProvider>
    </I18nProvider>
  )
}
