import { useStore } from '@/hooks/use-store'
import { listSnapshots } from '@/lib/snapshots'
import type { EligibilitySnapshot } from '@/lib/snapshots'

export function useSnapshots(): {
  snapshots: EligibilitySnapshot[]
  loading: boolean
  error: string | null
  reload: () => void
} {
  const { value, loading, error, reload } = useStore(listSnapshots)

  return { snapshots: value, loading, error, reload }
}
