import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/I18nProvider'
import { useConfirmStore } from './confirmStore'

export function ConfirmHost() {
  const t = useT()
  const req = useConfirmStore((s) => s.req)
  // Keep the last request on screen while the dialog animates out (req is already null by then).
  const [shown, setShown] = useState(req)
  if (req && req !== shown) setShown(req)
  const close = (ok: boolean) => {
    req?.resolve(ok)
    useConfirmStore.setState({ req: null })
  }
  // Initial focus goes to the least destructive action, so Enter never deletes by accident.
  const destructive = !!shown?.destructive
  return (
    <Dialog open={!!req} onOpenChange={(open) => !open && close(false)}>
      <DialogContent className="sm:max-w-md" showCloseButton={false} role="alertdialog">
        <DialogHeader>
          <DialogTitle>{shown?.title}</DialogTitle>
          <DialogDescription>{shown?.body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => close(false)} autoFocus={destructive}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            size="sm"
            onClick={() => close(true)}
            autoFocus={!destructive}
          >
            {shown?.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
