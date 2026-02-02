<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'

// ✅ Logo (mismo que en Login)
import logo from '../assets/music.png'

const email = ref('')
const password = ref('')
const birthYear = ref('')
const phone = ref('')

const error = ref('')
const loading = ref(false)

// ✅ Captcha (Cloudflare Turnstile) para evitar bots
const turnstileEl = ref(null)
const captchaToken = ref('')
const captchaLoading = ref(true)
const captchaWidgetId = ref(null)
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY
const TURNSTILE_ACTION = 'register'

const loadTurnstileScript = () =>
  new Promise((resolve, reject) => {
    // si ya está cargado
    if (window.turnstile) return resolve(true)

    const existing = document.querySelector('script[data-turnstile="true"]')
    if (existing) {
      existing.addEventListener('load', () => resolve(true))
      existing.addEventListener('error', reject)
      return
    }

    const s = document.createElement('script')
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    s.async = true
    s.defer = true
    s.setAttribute('data-turnstile', 'true')
    s.addEventListener('load', () => resolve(true))
    s.addEventListener('error', reject)
    document.head.appendChild(s)
  })

const renderTurnstile = async () => {
  captchaLoading.value = true
  captchaToken.value = ''

  // Si no hay site key, no podemos renderizar captcha
  if (!TURNSTILE_SITE_KEY) {
    captchaLoading.value = false
    captchaToken.value = ''
    return
  }

  try {
    await loadTurnstileScript()
    // ✅ si ya había un widget, lo quitamos para evitar estados "pegados"
    if (captchaWidgetId.value !== null && window.turnstile?.remove) {
      try { window.turnstile.remove(captchaWidgetId.value) } catch (_) {}
      captchaWidgetId.value = null
    }
    if (!turnstileEl.value || !window.turnstile) {
      captchaLoading.value = false
      return
    }

    // Limpia el contenedor por si re-render
    turnstileEl.value.innerHTML = ''

    captchaWidgetId.value = window.turnstile.render(turnstileEl.value, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: 'light',
      action: TURNSTILE_ACTION,
      appearance: 'always',
      execution: 'render',
      callback: (token) => {
        captchaToken.value = token
      },
      'expired-callback': () => {
        captchaToken.value = ''
      },
      'error-callback': () => {
        captchaToken.value = ''
      }
    })
  } finally {
    captchaLoading.value = false
  }
}

onMounted(() => {
  renderTurnstile()
})

const resetCaptcha = () => {
  captchaToken.value = ''
  if (window.turnstile && captchaWidgetId.value !== null) {
    try { window.turnstile.reset(captchaWidgetId.value) } catch (_) {}
  }
}

let resetTimer = null
watch([email, password], () => {
  // debounce para no spamear resets mientras escribes
  if (resetTimer) clearTimeout(resetTimer)

  // si el widget aún no está listo, no hacemos nada
  if (!TURNSTILE_SITE_KEY) return
  if (captchaLoading.value) return
  if (captchaWidgetId.value === null) return

  resetTimer = setTimeout(() => {
    resetCaptcha()
  }, 250)
})

onBeforeUnmount(() => {
  if (resetTimer) clearTimeout(resetTimer)
  resetTimer = null
  if (window.turnstile && captchaWidgetId.value !== null && window.turnstile?.remove) {
    try { window.turnstile.remove(captchaWidgetId.value) } catch (_) {}
  }
  captchaWidgetId.value = null
})

const router = useRouter()

const savePendingProfile = () => {
  localStorage.setItem(
    'pending_profile',
    JSON.stringify({
      email: email.value,
      birth_year: birthYear.value ? Number(birthYear.value) : null,
      phone: phone.value || null
    })
  )
}

const upsertProfileIfNeeded = async (userId) => {
  try {
    const raw = localStorage.getItem('pending_profile')
    if (!raw) return

    const pending = JSON.parse(raw)

    await supabase
      .from('profiles')
      .upsert(
        {
          id: userId,
          birth_year: pending.birth_year ?? null,
          phone: pending.phone ?? null
        },
        { onConflict: 'id' }
      )

    localStorage.removeItem('pending_profile')
  } catch (_) {
    // ignore
  }
}

const register = async () => {
  error.value = ''
  loading.value = true

  // ✅ Requerimos captcha siempre (evita líos con emails y bots)
  if (!TURNSTILE_SITE_KEY) {
    error.value =
      'Captcha no configurado. Añade VITE_TURNSTILE_SITE_KEY en tu .env.local (local) o en Vercel → Project → Settings → Environment Variables (Production) y redeploy.'
    loading.value = false
    return
  }

  const cleanEmail = (email.value || '').trim()
  if (!cleanEmail) {
    error.value = 'Pon un email válido.'
    loading.value = false
    return
  }
  if (!password.value || password.value.length < 6) {
    error.value = 'La contraseña debe tener al menos 6 caracteres.'
    loading.value = false
    return
  }

  // ✅ Captcha: obliga a resolverlo si hay site key
  if (TURNSTILE_SITE_KEY) {
    if (!captchaToken.value) {
      error.value = 'Completa el captcha primero.'
      loading.value = false
      return
    }

    // Verificación en servidor (Supabase Edge Function)
    const { data: verifyData, error: verifyErr } = await supabase.functions.invoke(
      'verify-turnstile',
      { body: { token: captchaToken.value, action: TURNSTILE_ACTION } }
    )

    if (verifyErr || !verifyData?.success) {
      const status = verifyErr?.status || verifyErr?.statusCode
      const msg = verifyErr?.message || ''
      const errorCodes = verifyData?.['error-codes']

      // Caso típico: la Edge Function está protegida con JWT (verify_jwt=true) o falta el secret.
      if (status === 401 || /\b401\b/.test(msg) || /unauthorized/i.test(msg)) {
        error.value =
          'Captcha OK pero la verificación en servidor está bloqueada (401). ' +
          'Revisa que `supabase/functions/verify-turnstile/config.toml` tenga `verify_jwt = false`, ' +
          'que la function esté desplegada, y que exista `TURNSTILE_SECRET_KEY` en las env vars de Supabase.'
      } else {
        const details =
          msg ||
          (Array.isArray(errorCodes) && errorCodes.length
            ? ` (${errorCodes.join(', ')})`
            : '')

        error.value = `Captcha inválido. Prueba otra vez.${details}`
      }

      loading.value = false
      // refresca token
      captchaToken.value = ''
      renderTurnstile()
      return
    }
    // Si el server devuelve action, comprobamos que coincide
    if (verifyData?.action && verifyData.action !== TURNSTILE_ACTION) {
      error.value = 'Captcha inválido (acción incorrecta).'
      loading.value = false
      captchaToken.value = ''
      renderTurnstile()
      return
    }
  }

  // Guardamos lo extra para meterlo en `profiles` cuando haya sesión
  savePendingProfile()

  const { data, error: err } = await supabase.auth.signUp({
    email: cleanEmail,
    password: password.value,
    options: {
      // Guardamos datos extra en user_metadata (por si quieres usarlos)
      data: {
        birth_year: birthYear.value ? Number(birthYear.value) : null,
        phone: phone.value || null
      }
    }
  })

  loading.value = false
  // Turnstile token es de un solo uso: limpiamos tras el intento
  captchaToken.value = ''

  if (err) {
    error.value = err.message || 'Error creando cuenta. Inténtalo otra vez.'
    // refresca captcha (token de Turnstile es de un solo uso)
    captchaToken.value = ''
    renderTurnstile()
    return
  }

  // ✅ Si Supabase devuelve sesión, entramos directo a la app
  if (data?.session?.user?.id) {
    await upsertProfileIfNeeded(data.session.user.id)
    router.push('/app')
    return
  }

  // Si no hay sesión (por configuración del proyecto), dejamos la cuenta creada y mandamos a login.
  router.push('/login')
}
</script>

<template>
  <div class="auth-wrapper">
    <div class="auth-card">
      <!-- ✅ mismo logo que login -->
      <div class="logo-wrap">
        <img :src="logo" alt="Logo" class="login-logo" />
      </div>

      <h1>Crear cuenta</h1>
      <p class="subtitle">Empieza a subir tu música 🎶</p>

      <input type="email" placeholder="Email" v-model="email" />
      <input type="password" placeholder="Contraseña" v-model="password" />
      <input
        type="number"
        inputmode="numeric"
        placeholder="Año de nacimiento (ej: 2004)"
        v-model="birthYear"
        min="1900"
        max="2100"
      />
      <input
        type="tel"
        inputmode="tel"
        placeholder="Número de teléfono"
        v-model="phone"
      />

      <div class="captcha-box" v-if="TURNSTILE_SITE_KEY">
        <div ref="turnstileEl" class="turnstile" />
        <p v-if="captchaLoading" class="captcha-loading">Cargando captcha…</p>
      </div>

      <button type="button" @click="register" :disabled="loading">
        {{ loading ? 'Creando...' : 'Crear cuenta' }}
      </button>

      <p v-if="error" class="error">{{ error }}</p>

      <p class="switch">
        ¿Ya tienes cuenta?
        <RouterLink to="/login">Inicia sesión</RouterLink>
      </p>
    </div>
  </div>
</template>

<style scoped>
@import '../assets/auth.css';

/* ✅ Fix franja blanca arriba (Safari/Chrome) */
:global(html),
:global(body),
:global(#app) {
  height: 100%;
  margin: 0;
  padding: 0;
}

/* ✅ asegura que el fondo cubre todo el viewport */
.auth-wrapper{
  position: fixed;
  inset: 0;
  width: 100%;
  min-height: 100vh;
  min-height: 100dvh;
}

/* 🔥 LOGO (igual que en login) */
.logo-wrap{
  position: relative;
  display: flex;
  justify-content: center;
  margin: 0 auto 1.5rem;
}

/* halo redondo detrás */
.logo-wrap::before{
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 210px;
  height: 210px;
  border-radius: 999px;
  background: radial-gradient(circle,
    rgba(255,255,255,.85) 0%,
    rgba(0,255,255,.45) 35%,
    rgba(0,255,255,0) 72%
  );
  filter: blur(14px);
  opacity: 1;
  pointer-events: none;
}

.login-logo{
  position: relative;
  z-index: 1;
  width: 140px;
  height: auto;
  display: block;
  border-radius: 20px;
  filter:
    drop-shadow(0 10px 18px rgba(0,0,0,.12))
    drop-shadow(0 0 16px rgba(0,255,255,.45))
    drop-shadow(0 0 34px rgba(0,255,255,.22));
}

/* ✅ Captcha */
.captcha-box {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.turnstile {
  min-height: 65px; /* espacio para widget */
}

.captcha-loading {
  font-size: 12px;
  opacity: 0.75;
}

</style>
