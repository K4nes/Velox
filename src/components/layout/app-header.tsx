import { useMatches } from 'react-router-dom'
import { SidebarTrigger } from '@/components/ui/sidebar'

type RouteHandle = { title?: string }

export function AppHeader() {
  const title = useMatches()
    .map((match) => (match.handle as RouteHandle | undefined)?.title)
    .filter(Boolean)
    .at(-1)

  return (
    <header className="flex h-12 items-center gap-2 border-b px-3">
      <SidebarTrigger />
      <span className="text-sm font-medium">{title}</span>
    </header>
  )
}
