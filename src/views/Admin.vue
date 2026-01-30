<template>
  <div class="admin-page">
    <h1>👑 Panel Admin</h1>
    <p>Solo admins pueden ver esto.</p>

    <div v-if="loading" class="box">Cargando...</div>

    <div v-else>
      <div v-if="!isAdmin" class="box error">
        ❌ No tienes permisos de admin.
      </div>

      <div v-else class="box ok">
        ✅ Bienvenido Admin ({{ userEmail }})
      </div>

      <div v-if="isAdmin" class="grid">
        <div class="card" @click="go('/admin/users')">
          <h3>Usuarios</h3>
          <p>Gestionar perfiles</p>
        </div>

        <div class="card" @click="go('/admin/audios')">
          <h3>Audios</h3>
          <p>Ver / eliminar audios</p>
        </div>

        <div class="card" @click="go('/admin/promotions')">
          <h3>Promociones</h3>
          <p>Ver todas las promociones</p>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, onMounted } from "vue"
import { useRouter } from "vue-router"
import { supabase } from "../lib/supabase"

const loading = ref(true)
const isAdmin = ref(false)
const userEmail = ref("")

const router = useRouter()

const go = (path) => {
  router.push(path)
}

onMounted(async () => {
  try {
    const { data } = await supabase.auth.getUser()
    const user = data?.user

    if (!user) {
      window.location.href = "/#/login"
      return
    }

    userEmail.value = user.email || ""

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single()

    if (profile?.is_admin === true) {
      isAdmin.value = true
    } else {
      isAdmin.value = false
      // si no es admin, lo mandamos fuera
      setTimeout(() => {
        window.location.href = "/#/app"
      }, 1200)
    }
  } catch (e) {
    console.error(e)
    window.location.href = "/#/app"
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.admin-page {
  padding: 30px;
  max-width: 900px;
  margin: auto;
  font-family: Arial, sans-serif;
}
.box {
  margin-top: 20px;
  padding: 18px;
  border-radius: 12px;
  background: #f2f2f2;
}
.error {
  background: #ffe1e1;
  color: #9b0000;
}
.ok {
  background: #e5ffe1;
  color: #146b00;
}
.grid {
  margin-top: 25px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
}
.card {
  background: white;
  border-radius: 14px;
  padding: 18px;
  box-shadow: 0 6px 14px rgba(0,0,0,0.08);
  cursor: pointer;
  transition: transform 0.15s ease;
}
.card h3 {
  margin: 0;
}
.card:hover {
  transform: translateY(-2px);
}
</style>