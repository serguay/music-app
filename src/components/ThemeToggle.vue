<script setup>
import { useThemeStore } from '../stores/theme'

const theme = useThemeStore()
</script>

<template>
  <button class="theme-btn" @click="theme.toggle()">
    {{ theme.dark ? '🌙 Modo oscuro' : '☀️ Modo claro' }}
  </button>
</template>

<style scoped>
.theme-btn {
  margin-top: 12px;
  padding: 8px 16px;
  border-radius: 999px;
  border: none;
  cursor: pointer;
  font-weight: 600;
  font-size: .85rem;
  background: #111;
  color: white;
}

:global(.p-dark) .theme-btn {
  background: #f4f4f5;
  color: #111;
}
</style>
