<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'

const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

const router = useRouter()

const login = async () => {
  error.value = ''
  loading.value = true

  const { error: err } = await supabase.auth.signInWithPassword({
    email: email.value,
    password: password.value
  })

  loading.value = false

  if (err) {
    error.value = err.message
  } else {
    router.push('/app')
  }
}
</script>

<template>
  <div class="auth-wrapper">
    <div class="auth-card">

      <!-- 🔥 LOGO -->
      <img
  src="/src/assets/foto.png"
  alt="Logo"
  class="login-logo"
/>


      <h1>Iniciar sesión</h1>
      <p class="subtitle">Bienvenido de nuevo 🎧</p>

      <input
        type="email"
        placeholder="Email"
        v-model="email"
      />

      <input
        type="password"
        placeholder="Contraseña"
        v-model="password"
      />

      <button @click="login" :disabled="loading">
        {{ loading ? 'Entrando...' : 'Entrar' }}
      </button>

      <p v-if="error" class="error">
        {{ error }}
      </p>

      <p class="switch">
        ¿No tienes cuenta?
        <RouterLink to="/register">Regístrate</RouterLink>
      </p>
    </div>
  </div>
</template>

<style scoped>
@import '../assets/auth.css';

/* 🔥 LOGO */
.login-logo {
  width: 120px;
  display: block;
  margin: 0 auto 1.5rem;
}
</style>
