<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'

const router = useRouter()
const loading = ref(false)

const logout = async () => {
  if (loading.value) return

  loading.value = true
  await supabase.auth.signOut()
  router.push('/login')
}
</script>

<template>
  <button class="logout-btn" @click="logout" :disabled="loading">
    {{ loading ? 'Saliendo…' : 'Cerrar sesión' }}
  </button>
</template>
