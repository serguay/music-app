

<template>
  <div class="admin-gate">
    <div v-if="unlocked">
      <slot />
    </div>

    <div v-else class="gate-card">
      <h2>🔒 Panel Admin</h2>
      <p>Introduce la contraseña para entrar.</p>

      <form @submit.prevent="check">
        <input
          v-model="input"
          type="password"
          placeholder="Contraseña"
          autocomplete="current-password"
        />
        <button type="submit">Entrar</button>
      </form>

      <p v-if="error" class="error">❌ Contraseña incorrecta</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue"

const props = defineProps({
  password: { type: String, required: true },
  storageKey: { type: String, default: "admin_gate_ok" },
})

const input = ref("")
const error = ref(false)
const unlocked = ref(false)

onMounted(() => {
  unlocked.value = sessionStorage.getItem(props.storageKey) === "1"
})

function check() {
  error.value = false
  if (input.value === props.password) {
    sessionStorage.setItem(props.storageKey, "1")
    unlocked.value = true
    input.value = ""
  } else {
    error.value = true
  }
}
</script>

<style scoped>
.admin-gate {
  min-height: 70vh;
  display: grid;
  place-items: center;
  padding: 24px;
}

.gate-card {
  width: min(420px, 92vw);
  background: white;
  border-radius: 16px;
  padding: 18px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
}

.gate-card h2 {
  margin: 0 0 8px;
}

.gate-card p {
  margin: 0 0 12px;
  opacity: 0.8;
}

form {
  display: flex;
  gap: 10px;
}

input {
  flex: 1;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.15);
  outline: none;
}

button {
  padding: 10px 14px;
  border-radius: 10px;
  border: 0;
  cursor: pointer;
}

.error {
  margin-top: 10px;
  color: #c0392b;
  font-weight: 600;
}
</style>