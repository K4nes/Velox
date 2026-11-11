import { useStore } from '@/hooks/data/use-store'
import { listSnapshots } from '@/lib/mint/snapshots'
import type { EligibilitySnapshot } from '@/lib/mint/snapshots'

export function useSnapshots(): {
  snapshots: EligibilitySnapshot[]
  loading: boolean
  error: string | null
  reload: () => void
} {
  const { value, loading, error, reload } = useStore(listSnapshots)

  return { snapshots: value, loading, error, reload }
}
