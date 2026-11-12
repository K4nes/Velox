import { useEffect } from 'react'
import { toast } from 'sonner'
import { toMessage } from '@/lib/core/message'
import { checkForUpdate } from '@/lib/update/update-check'
import type { PendingUpdate, UpdateCheck } from '@/lib/update/update-check'

const TOAST_ID = 'app-update'

let pendingCheck: Promise<UpdateCheck> | undefined

function checkOnce(): Promise<UpdateCheck> {
  if (!pendingCheck) {
    pendingCheck = checkForUpdate()
  }
  return pendingCheck
}

function showProgress(version: string, ratio: number | null): void {
  toast(`Updating Velox ${version}`, {
    id: TOAST_ID,
    description: ratio === null ? 'Downloading the update' : `${Math.round(ratio * 100)}%`,
    duration: Infinity,
  })
}

async function installUpdate(update: PendingUpdate): Promise<void> {
  try {
    await update.install((ratio) => showProgress(update.version, ratio))
  } catch (error) {
    toast.error(toMessage(error), { id: TOAST_ID })
  }
}

export function useAppUpdate(): void {
  useEffect(() => {
    let live = true

    checkOnce()
      .then((result) => {
        if (!live || result.kind !== 'available') {
          return
        }

        const update = result.update
        toast(`Velox ${update.version} is available`, {
          id: TOAST_ID,
          description:
            'Installs in place. Your wallets, folders and PnL records stay as they are.',
          action: {
            label: 'Install',
            onClick: (event) => {
              // Sonner dismisses a toast after an action unless the click is default-prevented,
              // and this same toast is where the progress and the failure appear.
              event.preventDefault()
              showProgress(update.version, null)
              void installUpdate(update)
            },
          },
          closeButton: true,
          duration: Infinity,
        })
      })
      .catch(() => {
        // A check that fails is not worth a toast; the next launch tries again.
      })

    return () => {
      live = false
    }
  }, [])
}
