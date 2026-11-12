import { RouterProvider } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppUpdate } from '@/hooks/update/use-app-update'
import { router } from '@/router'

function App() {
  useAppUpdate()

  return (
    <TooltipProvider>
      <RouterProvider router={router} />
      <Toaster position="top-center" />
    </TooltipProvider>
  )
}

export default App
