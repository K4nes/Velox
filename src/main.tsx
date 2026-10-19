import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AnimateUIProvider } from '@animate-ui/react/provider'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from '@/components/theme/theme-provider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AnimateUIProvider>
        <App />
      </AnimateUIProvider>
    </ThemeProvider>
  </StrictMode>,
)
