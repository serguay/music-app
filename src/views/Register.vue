<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'

const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

const router = useRouter()

const register = async () => {
  error.value = ''
  loading.value = true

  const { error: err } = await supabase.auth.signUp({
    email: email.value,
    password: password.value
  })

  loading.value = false

  if (err) {
    error.value = err.message
  } else {
    router.push('/login')
  }
}
</script>

<template>
  <div class="auth-wrapper">
    <div class="auth-card">
      <h1>Crear cuenta</h1>
      <p class="subtitle">Empieza a subir tu música 🎶</p>

      <input type="email" placeholder="Email" v-model="email" />
      <input type="password" placeholder="Contraseña" v-model="password" />

      <button @click="register" :disabled="loading">
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
</style>
