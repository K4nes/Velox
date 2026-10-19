import { Outlet } from 'react-router-dom'
import { SidebarInset, SidebarProvider } from '@/components/animate-ui/sidebar'
import { AppHeader } from './app-header'
import { AppSidebar } from './app-sidebar'

export function AppLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}
