<script setup>
import GroupsChat from '../components/GroupsChat.vue'
</script>

<template>
  <main class="groups-page">
    <section class="groups-shell" aria-label="Chat de grupos">
      <GroupsChat />
    </section>
  </main>
</template>

<style scoped>
.groups-page {
  width: 100%;
  min-height: 100vh;
  min-height: 100dvh;
  padding: 28px 18px 48px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

/* Contenedor principal (tipo mock: panel grande redondeado) */
.groups-shell {
  width: min(1100px, 100%);
  min-height: min(78vh, 820px);
  border-radius: 26px;
  padding: 18px;

  /* Cristal / card */
  background: rgba(255, 255, 255, 0.62);
  box-shadow:
    0 24px 60px rgba(0, 0, 0, 0.12),
    0 1px 0 rgba(255, 255, 255, 0.6) inset;
  border: 1px solid rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);

  /* Evita “saltos” raros por sombras */
  transform: translateZ(0);
}

@media (max-width: 720px) {
  .groups-page {
    padding: 18px 12px 36px;
  }

  .groups-shell {
    border-radius: 20px;
    padding: 14px;
    min-height: 78vh;
  }
}
</style>
