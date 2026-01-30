<script setup>
import { ref, onMounted } from "vue"
import { supabase } from "../lib/supabase"
import { useRouter } from "vue-router"

const router = useRouter()
const loading = ref(true)
const promos = ref([])
const error = ref("")

const loadPromotions = async () => {
  loading.value = true
  error.value = ""

  const { data, error: err } = await supabase
    .from("promotions")
    .select("id, user_id, audio_id, plan, status, created_at, expires_at")
    .order("created_at", { ascending: false })

  if (err) {
    error.value = err.message
    promos.value = []
  } else {
    promos.value = data || []
  }

  loading.value = false
}

const deletePromotion = async (id) => {
  const ok = confirm("⚠️ ¿Seguro que quieres borrar esta promoción?")
  if (!ok) return

  const { error: err } = await supabase.from("promotions").delete().eq("id", id)

  if (err) {
    alert("Error borrando: " + err.message)
    return
  }

  promos.value = promos.value.filter((p) => p.id !== id)
}

onMounted(loadPromotions)
</script>

<template>
  <section class="wrap">
    <div class="top">
      <button class="back" @click="router.push('/admin')">← Volver</button>
      <h2>💸 Promociones</h2>
    </div>

    <p v-if="loading">Cargando...</p>
    <p v-if="error" class="err">❌ {{ error }}</p>

    <div v-if="!loading && promos.length" class="list">
      <div v-for="p in promos" :key="p.id" class="card">
        <div class="info">
          <p class="name">Plan: {{ p.plan }} ({{ p.status }})</p>
          <p class="meta">🎵 audio_id: {{ p.audio_id }}</p>
          <p class="meta">👤 user_id: {{ p.user_id }}</p>
          <p class="meta">🕒 {{ new Date(p.created_at).toLocaleString() }}</p>
          <p v-if="p.expires_at" class="meta">
            ⏳ Expira: {{ new Date(p.expires_at).toLocaleString() }}
          </p>
        </div>

        <button class="danger" @click="deletePromotion(p.id)">Borrar</button>
      </div>
    </div>

    <p v-if="!loading && !promos.length">No hay promociones</p>
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
.danger{border:none;background:#ef4444;color:white;font-weight:800;padding:10px 14px;border-radius:12px;cursor:pointer;}
.err{color:#ef4444;font-weight:700;}
</style>