import { isTauri } from '@tauri-apps/api/core'

export type PendingUpdate = {
  version: string
  // Hands the installer off and relaunches. The process normally exits before this
  // resolves, so no caller may continue after it.
  install: (onProgress: (ratio: number | null) => void) => Promise<void>
}

export type UpdateCheck = { kind: 'none' } | { kind: 'available'; update: PendingUpdate }

export async function checkForUpdate(): Promise<UpdateCheck> {
  if (!isTauri()) {
    return { kind: 'none' }
  }

  const [{ check }, { relaunch }] = await Promise.all([
    import('@tauri-apps/plugin-updater'),
    import('@tauri-apps/plugin-process'),
  ])
  const update = await check()
  if (!update) {
    return { kind: 'none' }
  }

  return {
    kind: 'available',
    update: {
      version: update.version,
      install: async (onProgress) => {
        let total: number | null = null
        let received = 0

        await update.downloadAndInstall((event) => {
          if (event.event === 'Started') {
            total = event.data.contentLength ?? null
            received = 0
            onProgress(total === null ? null : 0)
          } else if (event.event === 'Progress') {
            received += event.data.chunkLength
            onProgress(total === null ? null : Math.min(received / total, 1))
          }
        })
        await relaunch()
      },
    },
  }
}
