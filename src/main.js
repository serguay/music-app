import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import './style.css'

// ✅ PrimeIcons (nuevo)
import 'primeicons/primeicons.css'

// ✅ PWA
import { registerSW } from 'virtual:pwa-register'
registerSW({ immediate: true })

// PrimeVue
import PrimeVue from 'primevue/config'
import Aura from '@primevue/themes/aura'

// ✅ OCULTAR LOGS EN PRODUCCIÓN
if (import.meta.env.PROD) {
  console.log = () => {}
  console.warn = () => {}
  console.error = () => {}
}

const app = createApp(App)

const pinia = createPinia()

app.use(pinia)
app.use(router)

app.use(PrimeVue, {
  theme: {
    preset: Aura
  }
})

/* =========================================
   🔥 BLOQUEO GESTO TRACKPAD MAC (REAL FIX)
   Evita swipe back / forward del navegador
========================================= */
window.addEventListener(
  'wheel',
  (e) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault()
      e.stopPropagation()
      return false
    }
  },
  { passive: false }
)

app.mount('#app')