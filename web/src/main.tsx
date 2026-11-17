import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { ThemeProvider } from './hooks/useTheme'
import { BrandingProvider } from './hooks/useBranding'
import { installUiLogCapture } from './lib/uiLog'

installUiLogCapture()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <BrandingProvider>
        <App />
      </BrandingProvider>
    </ThemeProvider>
  </StrictMode>,
)
