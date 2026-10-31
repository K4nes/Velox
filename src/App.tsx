import { RouterProvider } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { router } from '@/router'

function App() {
  return (
    <TooltipProvider>
      <RouterProvider router={router} />
      <Toaster position="top-center" />
    </TooltipProvider>
  )
}

export default App
