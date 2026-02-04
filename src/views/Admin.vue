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

      <!-- Password gate (extra seguridad) -->
      <div v-if="isAdmin && !gateUnlocked" class="gate-overlay">
        <div class="gate-modal">
          <h2>🔒 Acceso al Panel</h2>
          <p>Introduce la contraseña para entrar.</p>

          <input
            v-model="gatePassword"
            type="password"
            class="gate-input"
            placeholder="Contraseña"
            @keyup.enter="unlockGate"
          />

          <div v-if="gateError" class="gate-error">{{ gateError }}</div>

          <div class="gate-actions">
            <button class="gate-btn" @click="unlockGate">Entrar</button>
            <button class="gate-btn secondary" @click="go('/app')">Salir</button>
          </div>

          <small class="gate-hint">Se guarda solo en esta pestaña (session).</small>
        </div>
      </div>

      <div v-if="isAdmin && gateUnlocked" class="grid">
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

// Gate de contraseña (solo UI extra, la seguridad real sigue siendo RLS)
const gateUnlocked = ref(false)
const gatePassword = ref("")
const gateError = ref("")

const ADMIN_GATE_KEY = "cm_admin_gate_ok"
const ADMIN_PANEL_PASSWORD = import.meta.env.VITE_ADMIN_PANEL_PASSWORD || "cambia-esto"

const router = useRouter()

const go = (path) => {
  router.push(path)
}

const unlockGate = () => {
  gateError.value = ""

  if (!gatePassword.value) {
    gateError.value = "Pon una contraseña"
    return
  }

  if (gatePassword.value !== ADMIN_PANEL_PASSWORD) {
    gateError.value = "Contraseña incorrecta"
    return
  }

  gateUnlocked.value = true
  gatePassword.value = ""
  try {
    sessionStorage.setItem(ADMIN_GATE_KEY, "1")
  } catch (e) {
    // ignore
  }
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

      // si ya lo desbloqueaste en esta pestaña, no vuelvas a pedir contraseña
      try {
        gateUnlocked.value = sessionStorage.getItem(ADMIN_GATE_KEY) === "1"
      } catch (e) {
        gateUnlocked.value = false
      }
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
.gate-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 16px;
}

.gate-modal {
  width: 100%;
  max-width: 420px;
  background: white;
  border-radius: 16px;
  padding: 18px;
  box-shadow: 0 18px 40px rgba(0,0,0,0.25);
}

.gate-modal h2 {
  margin: 0 0 6px;
}

.gate-modal p {
  margin: 0 0 12px;
  opacity: 0.85;
}

.gate-input {
  width: 100%;
  padding: 12px 12px;
  border-radius: 12px;
  border: 1px solid #ddd;
  outline: none;
}

.gate-input:focus {
  border-color: #bbb;
}

.gate-error {
  margin-top: 10px;
  color: #9b0000;
  background: #ffe1e1;
  padding: 10px;
  border-radius: 12px;
}

.gate-actions {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}

.gate-btn {
  flex: 1;
  border: none;
  border-radius: 12px;
  padding: 10px 12px;
  cursor: pointer;
  background: #111;
  color: #fff;
}

.gate-btn.secondary {
  background: #f2f2f2;
  color: #111;
}

.gate-hint {
  display: block;
  margin-top: 10px;
  opacity: 0.7;
}
</style>

