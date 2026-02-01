<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import confetti from 'canvas-confetti'
import { ensureKeypair } from '../lib/crypto/keys'
// ✅ Añadido import del nuevo logo
import logo from '../assets/music.png'

const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

const router = useRouter()

/* ======================
   ✅ Login SIEMPRE sin RGB
====================== */
onMounted(() => {
  document.documentElement.classList.remove('rgb-mode')
})

/* ======================
   ✅ Función confeti premium
====================== */
const triggerSuccessConfetti = () => {
  const duration = 3 * 1000
  const animationEnd = Date.now() + duration
  const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 }

  const randomInRange = (min, max) => Math.random() * (max - min) + min

  const interval = setInterval(function () {
    const timeLeft = animationEnd - Date.now()

    if (timeLeft <= 0) {
      return clearInterval(interval)
    }

    const particleCount = 50 * (timeLeft / duration)
    confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } })
    confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } })
  }, 250)
}

/* ======================
   ✅ LOGIN
====================== */
const login = async () => {
  error.value = ''
  loading.value = true

  const { data, error: err } = await supabase.auth.signInWithPassword({
    email: email.value,
    password: password.value
  })

  if (err) {
    error.value = err.message
    loading.value = false
  } else {
    try {
      const userId = data?.user?.id
      if (userId) {
        const pk = await ensureKeypair(supabase, userId)
        console.log('✅ LOGIN OK user:', userId)
        console.log('🔐 PUBLIC KEY saved:', pk)
      } else {
        console.warn('⚠️ LOGIN OK pero sin userId')
      }
    } catch (e) {
      console.warn('⚠️ No pude asegurar/guardar la public key:', e)
    }

    triggerSuccessConfetti()
    setTimeout(() => {
      loading.value = false
      router.push('/app')
    }, 1200)
  }
}
</script>

<template>
  <div class="auth-wrapper">
    <div class="auth-card">
      <div class="logo-wrap">
        <img :src="logo" alt="Logo" class="login-logo" />
      </div>

      <h1>Iniciar sesión</h1>
      <p class="subtitle">Bienvenido de nuevo 🎧</p>

      <input type="email" placeholder="Email" v-model="email" />
      <input type="password" placeholder="Contraseña" v-model="password" />

      <button @click="login" :disabled="loading">
        {{ loading ? 'Entrando...' : 'Entrar' }}
      </button>

      <p v-if="error" class="error">{{ error }}</p>

      <p class="switch">
        ¿No tienes cuenta?
        <RouterLink to="/register">Regístrate</RouterLink>
      </p>
    </div>

    <!-- ✅ Footer legal fuera del contenedor/card -->
    <footer class="legal-footer">
      <div class="legal-icons">
        <!-- Seguridad -->
        <RouterLink to="/security" class="legal-item link-pill">
          <svg viewBox="0 0 24 24" class="legal-icon" aria-hidden="true">
            <path
              d="M12 2l7 4v6c0 5-3.5 9.4-7 10-3.5-.6-7-5-7-10V6l7-4z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linejoin="round"
            />
            <path
              d="M9.5 12l1.8 1.8L15 10"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span>Seguridad</span>
        </RouterLink>

        <!-- Privacidad -->
        <RouterLink to="/privacy" class="legal-item link-pill">
          <svg viewBox="0 0 24 24" class="legal-icon" aria-hidden="true">
            <path
              d="M17 10V8a5 5 0 10-10 0v2"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
            <path
              d="M7 10h10a2 2 0 012 2v7a2 2 0 01-2 2H7a2 2 0 01-2-2v-7a2 2 0 012-2z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linejoin="round"
            />
          </svg>
          <span>Privacidad</span>
        </RouterLink>

        <!-- Términos -->
        <RouterLink to="/terms" class="legal-item link-pill">
          <svg viewBox="0 0 24 24" class="legal-icon" aria-hidden="true">
            <path
              d="M7 3h8l3 3v15a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linejoin="round"
            />
            <path
              d="M9 13h6M9 17h6M9 9h3"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
          </svg>
          <span>Términos</span>
        </RouterLink>
      </div>

      <div class="legal-links">
        <span class="mini">Tu información está segura • Transparencia • Control</span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
@import '../assets/auth.css';

html, body, #app{
  height: 100%;
  margin: 0;
  padding: 0;
}

.auth-wrapper{
  position: fixed;
  inset: 0;
  width: 100%;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 26px 16px;
  box-sizing: border-box;
  overflow: hidden;

  background:
    radial-gradient(900px 500px at 50% 10%, rgba(99,102,241,.18), transparent 60%),
    radial-gradient(700px 520px at 20% 85%, rgba(59,130,246,.14), transparent 60%),
    radial-gradient(820px 520px at 85% 78%, rgba(168,85,247,.10), transparent 58%),
    linear-gradient(180deg, #f7f8ff 0%, #f4f6ff 55%, #f7f8ff 100%);
}

.auth-wrapper::before{
  content:"";
  position:absolute;
  inset:0;
  pointer-events:none;
  opacity:.06;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='.55'/%3E%3C/svg%3E");
}

.auth-wrapper::after{
  content:"";
  position:absolute;
  width: 520px;
  height: 520px;
  left: 50%;
  top: 12%;
  transform: translateX(-50%);
  background: radial-gradient(circle at 30% 30%, rgba(99,102,241,.28), transparent 58%),
              radial-gradient(circle at 70% 65%, rgba(59,130,246,.18), transparent 55%);
  filter: blur(18px);
  opacity: .55;
  animation: authFloat 7s ease-in-out infinite;
  pointer-events:none;
}

@keyframes authFloat{
  0%,100%{ transform: translateX(-50%) translateY(0) scale(1); }
  50%{ transform: translateX(-50%) translateY(14px) scale(1.03); }
}

.auth-card{
  position: relative;
  width: min(420px, 100%);
  border-radius: 26px;
  padding: 28px 24px 22px;
  box-sizing: border-box;

  background: rgba(255,255,255,.78);
  border: 1px solid rgba(15,23,42,.08);
  box-shadow: 0 30px 90px rgba(0,0,0,.16);
  backdrop-filter: blur(16px) saturate(1.15);
  -webkit-backdrop-filter: blur(16px) saturate(1.15);

  animation: cardEnter .55s cubic-bezier(.2,1.1,.2,1) both;
  transform-origin: 50% 70%;
}

@keyframes cardEnter{
  0%{ opacity: 0; transform: translateY(18px) scale(.98); filter: blur(3px); }
  100%{ opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
}

.auth-card::before{
  content:"";
  position:absolute;
  inset:0;
  border-radius: inherit;
  pointer-events:none;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.75);
  opacity: .9;
}

/* New logo wrap and logo styles */
.logo-wrap{
  position: relative;
  display: flex;
  justify-content: center;
  margin: 0 auto 14px;
}

/* halo redondo detrás (no cuadrado) */
.logo-wrap::before{
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 210px;
  height: 210px;
  border-radius: 999px;

  /* ✅ Glow más “blanco/cyan” (menos gris) */
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

  /* sombra suave para separarlo del fondo */
  filter:
    drop-shadow(0 10px 18px rgba(0,0,0,.12))
    drop-shadow(0 0 16px rgba(0,255,255,.45))
    drop-shadow(0 0 34px rgba(0,255,255,.22));

  animation: logoPop .65s cubic-bezier(.2,1.2,.2,1) both;
  transition: transform .25s ease, filter .25s ease;
}

.login-logo:hover{
  transform: translateY(-2px) scale(1.03);
  filter: drop-shadow(0 16px 28px rgba(0,0,0,.16));
}

@keyframes logoPop{
  0%{ opacity: 0; transform: translateY(-10px) scale(.9); }
  100%{ opacity: 1; transform: translateY(0) scale(1); }
}

.auth-card h1{
  margin: 8px 0 4px;
  font-size: 1.55rem;
  font-weight: 900;
  letter-spacing: -0.02em;
  color: rgba(15,23,42,.92);
  text-align: center;
}

.auth-card .subtitle{
  margin: 0 0 18px;
  text-align: center;
  font-size: .92rem;
  font-weight: 700;
  color: rgba(15,23,42,.55);
}

.auth-card input{
  width: 100%;
  height: 46px;
  border-radius: 14px;
  border: 1px solid rgba(15,23,42,.10);
  background: rgba(255,255,255,.78);
  padding: 0 14px;
  box-sizing: border-box;

  font-size: .95rem;
  font-weight: 650;
  color: rgba(15,23,42,.92);

  outline: none;
  transition: box-shadow .18s ease, border-color .18s ease, transform .18s ease, background .18s ease;
  box-shadow: 0 10px 26px rgba(0,0,0,.06);
}

.auth-card input + input{ margin-top: 12px; }

.auth-card input::placeholder{
  color: rgba(15,23,42,.35);
  font-weight: 650;
}

.auth-card input:focus{
  border-color: rgba(99,102,241,.55);
  box-shadow: 0 0 0 4px rgba(99,102,241,.16), 0 14px 30px rgba(0,0,0,.10);
  background: rgba(255,255,255,.92);
  transform: translateY(-1px);
}

.auth-card button{
  width: 100%;
  height: 46px;
  margin-top: 14px;
  border: none;
  border-radius: 14px;

  background: linear-gradient(135deg, #111827, #0b0f1a);
  color: #fff;
  font-weight: 900;
  letter-spacing: .01em;
  font-size: .95rem;

  cursor: pointer;
  box-shadow: 0 18px 40px rgba(0,0,0,.18);
  transition: transform .15s ease, box-shadow .15s ease, filter .15s ease;
  position: relative;
  overflow: hidden;
}

.auth-card button:hover{
  transform: translateY(-1px);
  filter: brightness(1.08);
  box-shadow: 0 22px 52px rgba(0,0,0,.22);
}

.auth-card button:active{
  transform: translateY(0) scale(.99);
}

.auth-card button:disabled{
  opacity: .75;
  cursor: not-allowed;
  filter: none;
  transform: none;
}

.auth-card button::after{
  content:"";
  position:absolute;
  top: -40%;
  left: -60%;
  width: 60%;
  height: 180%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent);
  transform: rotate(18deg);
  opacity: 0;
  transition: opacity .15s ease;
}

.auth-card button:hover::after{
  opacity: 1;
  animation: btnShine 1.05s ease both;
}

@keyframes btnShine{
  0%{ left: -70%; }
  100%{ left: 125%; }
}

.auth-card .error{
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 14px;
  font-weight: 850;
  font-size: .88rem;
  color: rgba(185,28,28,.95);
  background: rgba(239,68,68,.10);
  border: 1px solid rgba(239,68,68,.18);
  text-align: center;

  animation: errPop .22s cubic-bezier(.2,1.2,.2,1) both;
}

@keyframes errPop{
  from{ opacity: 0; transform: translateY(6px) scale(.98); filter: blur(1px); }
  to{ opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
}

.auth-card .switch{
  margin-top: 14px;
  text-align: center;
  font-size: .9rem;
  font-weight: 750;
  color: rgba(15,23,42,.60);
}

.auth-card .switch a{
  font-weight: 950;
  color: rgba(99,102,241,.95);
  text-decoration: none;
  position: relative;
}

.auth-card .switch a::after{
  content:"";
  position:absolute;
  left: 0;
  bottom: -3px;
  width: 100%;
  height: 2px;
  border-radius: 2px;
  background: rgba(99,102,241,.55);
  transform: scaleX(.0);
  transform-origin: left;
  transition: transform .18s ease;
}

.auth-card .switch a:hover::after{
  transform: scaleX(1);
}

@media (max-width: 520px){
  .auth-card{
    border-radius: 22px;
    padding: 24px 18px 18px;
  }
  .login-logo{ width: 120px; }
  .logo-wrap{ margin-bottom: 12px; }
  .logo-wrap::before{ width: 190px; height: 190px; }
  .auth-card h1{ font-size: 1.45rem; }
  .auth-card input, .auth-card button{ height: 44px; border-radius: 13px; }
  .auth-wrapper{ padding-bottom: 140px; }
}

@media (prefers-reduced-motion: reduce){
  .auth-wrapper::after,
  .auth-card,
  .login-logo,
  .auth-card .error{
    animation: none !important;
  }
}

/* ✅ Footer legal fuera del contenedor/card */
.legal-footer{
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 12px 14px calc(12px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  z-index: 9999;
  background: transparent;
}

.legal-icons{
  width: min(560px, 94vw);
  display: flex;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}

.legal-item{
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 999px;
  background: rgba(0,0,0,0.08);
  backdrop-filter: blur(10px);
  font-size: 12px;
  opacity: 0.95;
  user-select: none;
}

.link-pill{
  text-decoration: none;
  color: inherit;
  cursor: pointer;
  border: 1px solid rgba(0,0,0,0.10);
  transition: transform 0.08s ease, opacity 0.08s ease;
}

.link-pill:active{
  transform: scale(0.98);
}

.legal-icon{
  width: 18px;
  height: 18px;
}

.legal-links .mini{
  font-size: 12px;
  opacity: 0.75;
  text-align: center;
}
</style>
