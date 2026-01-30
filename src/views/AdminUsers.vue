<script setup>
import { ref, onMounted } from "vue"
import { supabase } from "../lib/supabase"
import { useRouter } from "vue-router"

const router = useRouter()
const loading = ref(true)
const users = ref([])
const error = ref("")

const loadUsers = async () => {
  loading.value = true
  error.value = ""

  const { data, error: err } = await supabase
    .from("profiles")
    .select("id, username, email, created_at, is_admin")
    .order("created_at", { ascending: false })

  if (err) {
    error.value = err.message
    users.value = []
  } else {
    users.value = data || []
  }

  loading.value = false
}

const deleteUser = async (id) => {
  const ok = confirm("⚠️ ¿Seguro que quieres borrar este usuario?")
  if (!ok) return

  const { error: err } = await supabase.from("profiles").delete().eq("id", id)

  if (err) {
    alert("Error borrando: " + err.message)
    return
  }

  users.value = users.value.filter((u) => u.id !== id)
}

onMounted(loadUsers)
</script>

<template>
  <section class="wrap">
    <div class="top">
      <button class="back" @click="router.push('/admin')">← Volver</button>
      <h2>👥 Usuarios</h2>
    </div>

    <p v-if="loading">Cargando...</p>
    <p v-if="error" class="err">❌ {{ error }}</p>

    <div v-if="!loading && users.length" class="list">
      <div v-for="u in users" :key="u.id" class="card">
        <div class="info">
          <p class="name">
            {{ u.username || "Sin username" }}
            <span v-if="u.is_admin" class="badge">ADMIN</span>
          </p>
          <p class="meta">{{ u.email || "Sin email" }}</p>
          <p class="meta">🕒 {{ new Date(u.created_at).toLocaleString() }}</p>
        </div>

        <button class="danger" @click="deleteUser(u.id)">Borrar</button>
      </div>
    </div>

    <p v-if="!loading && !users.length">No hay usuarios</p>
  </section>
</template>

<style scoped>
.wrap{max-width:720px;margin:0 auto;padding:30px;}
.top{display:flex;align-items:center;gap:12px;margin-bottom:18px;}
.back{border:none;padding:10px 14px;border-radius:12px;background:#eee;cursor:pointer;font-weight:700;}
.list{display:flex;flex-direction:column;gap:12px;}
.card{display:flex;justify-content:space-between;align-items:center;background:white;border-radius:18px;padding:16px;box-shadow:0 10px 25px rgba(0,0,0,.08);}
.name{font-weight:900;margin:0;}
.meta{margin:2px 0;opacity:.7;font-size:.9rem;}
.badge{margin-left:10px;background:#111;color:white;padding:4px 10px;border-radius:999px;font-size:.75rem;}
.danger{border:none;background:#ef4444;color:white;font-weight:800;padding:10px 14px;border-radius:12px;cursor:pointer;}
.err{color:#ef4444;font-weight:700;}
</style>