import { Outlet } from 'react-router-dom'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppContextMenu } from './app-context-menu'
import { AppHeader } from './app-header'
import { AppSidebar } from './app-sidebar'

export function AppLayout() {
  return (
    <AppContextMenu>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <AppHeader />
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </AppContextMenu>
  )
}
