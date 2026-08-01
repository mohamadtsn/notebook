import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import './index.css'
import App from './App.tsx'
import { ToastProvider } from './components/ui/Toast.tsx'
import { TooltipProvider } from './components/ui/Tooltip.tsx'

// JS-driven motion isn't covered by the CSS reduced-motion rule; this is what
// makes every motion component honour the OS setting — DESIGN.md §5.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </TooltipProvider>
    </MotionConfig>
  </StrictMode>,
)
