import { useState } from 'react'

export function useSelection<T>(
  items: readonly T[],
  {
    keyOf,
    isSelectable,
  }: {
    keyOf: (item: T) => string
    isSelectable: (item: T) => boolean
  }
) {
  const [selectedKeys, setSelectedKeys] = useState<readonly string[]>([])

  function toggle(key: string) {
    setSelectedKeys((current) =>
      current.includes(key)
        ? current.filter((value) => value !== key)
        : [...current, key]
    )
  }

  function toggleAll() {
    const keys = items.filter(isSelectable).map(keyOf)
    setSelectedKeys((current) =>
      keys.every((key) => current.includes(key))
        ? current.filter((key) => !keys.includes(key))
        : [...new Set([...current, ...keys])]
    )
  }

  function deselect(keys: readonly string[]) {
    setSelectedKeys((current) => current.filter((key) => !keys.includes(key)))
  }

  return {
    selectedKeys,
    setKeys: setSelectedKeys,
    toggle,
    toggleAll,
    deselect,
  }
}
