import { Buffer } from 'buffer'
globalThis.Buffer = Buffer

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// DevPal ships no service worker. A stale coi-serviceworker registered by
// another project on this github.io origin (root scope) can hijack our fetches
// and throw "RangeError: status (0) outside [200, 599]", breaking CDN/git
// requests. Unregister anything controlling this page; reload once to escape an
// active controller.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => {
      const hadController = Boolean(navigator.serviceWorker.controller)
      return Promise.all(regs.map((r) => r.unregister())).then((results) => {
        if (
          results.some(Boolean) &&
          hadController &&
          !sessionStorage.getItem('devpal-sw-cleared')
        ) {
          sessionStorage.setItem('devpal-sw-cleared', '1')
          window.location.reload()
        }
      })
    })
    .catch(() => {})
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
