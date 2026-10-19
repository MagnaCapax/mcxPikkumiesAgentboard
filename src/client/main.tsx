import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/index.css'
import '@xterm/xterm/css/xterm.css'
import { isIOSDevice, isIOSPWA } from './utils/device'
import { bootstrap } from './pikkumies/bootstrap'

// Add class for iOS safe area handling
if (isIOSDevice()) {
  document.documentElement.classList.add('ios')
}
if (isIOSPWA()) {
  document.documentElement.classList.add('ios-pwa')
}

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root element not found')
}

void bootstrap().then((ok) => {
  if (!ok) {
    container.textContent = 'Open Pikkumies from your control panel.'
    return
  }
  createRoot(container).render(<React.StrictMode><App /></React.StrictMode>)
}).catch(() => { container.textContent = 'Pikkumies is not running right now. Open it again from your control panel.' })
