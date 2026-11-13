import { usePageStore, usePageStoreScope } from '@/hooks/use-page-store'
import type { PageStore } from '@/lib/core/page-store'

export type SelectionFields = { selectedKeys: readonly string[] }

export function useSelection<T>(
  items: readonly T[],
  {
    keyOf,
    isSelectable,
  }: {
    keyOf: (item: T) => string
    isSelectable: (item: T) => boolean
  },
  store?: PageStore<SelectionFields>
) {
  const scoped = usePageStoreScope(store, { selectedKeys: [] })
  const { selectedKeys } = usePageStore(scoped)

  function setKeys(next: readonly string[]) {
    scoped.set({ selectedKeys: next })
  }

  function toggle(key: string) {
    const current = scoped.get().selectedKeys
    setKeys(
      current.includes(key)
        ? current.filter((value) => value !== key)
        : [...current, key]
    )
  }

  function toggleAll() {
    const keys = items.filter(isSelectable).map(keyOf)
    const current = scoped.get().selectedKeys
    setKeys(
      keys.every((key) => current.includes(key))
        ? current.filter((key) => !keys.includes(key))
        : [...new Set([...current, ...keys])]
    )
  }

  function deselect(keys: readonly string[]) {
    setKeys(scoped.get().selectedKeys.filter((key) => !keys.includes(key)))
  }

  return {
    selectedKeys,
    setKeys,
    toggle,
    toggleAll,
    deselect,
  }
}
