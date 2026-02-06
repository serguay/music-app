<template>
  <section class="groups" aria-label="Chat de grupos">
    <!-- LEFT: groups list -->
    <aside class="groups__sidebar" aria-label="Lista de grupos">
      <div class="groups__sidebarTop">
        <div class="groups__dot" aria-hidden="true"></div>
      </div>

      <div class="groups__list" role="list">
        <button class="groups__item is-active" type="button">
          <span class="groups__pill"></span>
        </button>
        <button class="groups__item" type="button"><span class="groups__pill"></span></button>
        <button class="groups__item" type="button"><span class="groups__pill"></span></button>
        <button class="groups__item" type="button"><span class="groups__pill"></span></button>
        <button class="groups__item" type="button"><span class="groups__pill"></span></button>
        <button class="groups__item" type="button"><span class="groups__pill"></span></button>
        <button class="groups__item" type="button"><span class="groups__pill"></span></button>
        <button class="groups__item" type="button"><span class="groups__pill"></span></button>
        <button class="groups__item" type="button"><span class="groups__pill"></span></button>
        <button class="groups__item" type="button"><span class="groups__pill"></span></button>
        <button class="groups__item" type="button"><span class="groups__pill"></span></button>
      </div>
    </aside>

    <!-- RIGHT: chat panel -->
    <main class="groups__panel" aria-label="Panel del chat">
      <header class="groups__panelTop">
        <div class="groups__titleWrap">
          <h2 class="groups__title">👥 Grupos</h2>
          <p class="groups__subtitle">Chat de grupos (UI)</p>
        </div>
        <div class="groups__topBar" aria-hidden="true"></div>
      </header>

      <section class="groups__messages" aria-label="Mensajes">
        <!-- Placeholder bubbles (UI) -->
        <div class="bubble is-left" aria-hidden="true"></div>
        <div class="bubble is-right" aria-hidden="true"></div>
        <div class="bubble is-left" aria-hidden="true"></div>
        <div class="bubble is-right" aria-hidden="true"></div>
        <div class="bubble is-left" aria-hidden="true"></div>

        <div class="groups__empty" v-if="!enabled">
          <p class="groups__emptyTitle">Aún no está listo</p>
          <p class="groups__emptyText">Esto es solo el diseño. Cuando lo conectes, aquí irán los mensajes reales.</p>
        </div>
      </section>

      <footer class="groups__composer">
        <input
          class="groups__input"
          type="text"
          placeholder="Escribe un mensaje…"
          :disabled="!enabled"
          v-model="draft"
          @keydown.enter.prevent="send()"
        />
        <button class="groups__send" :disabled="!enabled || !draft.trim()" @click="send()">Enviar</button>
      </footer>
    </main>
  </section>
</template>

<script setup>
import { ref } from 'vue'

// Ponlo en true cuando conectes el chat de grupos.
const enabled = false

const draft = ref('')

function send() {
  if (!enabled) return
  const text = draft.value.trim()
  if (!text) return

  // TODO: aquí irá el insert a tu tabla de mensajes de grupo
  // eslint-disable-next-line no-console
  console.log('[GroupsChat] send:', text)

  draft.value = ''
}
</script>

<style scoped>
.groups {
  width: min(980px, 94vw);
  margin: 0 auto;
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 18px;
  padding: 16px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.40);
  border: 1px solid rgba(255, 255, 255, 0.45);
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.12);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

/* LEFT */
.groups__sidebar {
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: 18px;
  overflow: hidden;
  display: grid;
  grid-template-rows: auto 1fr;
  box-shadow: 0 18px 45px rgba(0, 0, 0, 0.10);
}

.groups__sidebarTop {
  padding: 14px 14px 10px;
}

.groups__dot {
  width: 26px;
  height: 26px;
  border-radius: 9px;
  background: rgba(0, 0, 0, 0.92);
}

.groups__list {
  padding: 12px 14px 14px;
  display: grid;
  gap: 10px;
  overflow: auto;
}

.groups__item {
  appearance: none;
  border: none;
  cursor: pointer;
  width: 100%;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.85);
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.08);
  transition: transform 160ms ease, box-shadow 160ms ease;
}

.groups__item:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 28px rgba(0, 0, 0, 0.10);
}

.groups__item.is-active {
  outline: 2px solid rgba(88, 101, 242, 0.35);
}

.groups__pill {
  display: block;
  height: 18px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.90);
}

/* RIGHT */
.groups__panel {
  background: rgba(255, 255, 255, 0.62);
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: 18px;
  overflow: hidden;
  display: grid;
  grid-template-rows: auto 1fr auto;
  box-shadow: 0 18px 45px rgba(0, 0, 0, 0.10);
}

.groups__panelTop {
  padding: 14px 16px 10px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  position: relative;
}

.groups__topBar {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  width: min(420px, 64%);
  height: 16px;
  border-radius: 9px;
  background: rgba(0, 0, 0, 0.92);
}

.groups__titleWrap {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.groups__title {
  margin: 0;
  font-size: 16px;
  font-weight: 900;
}

.groups__subtitle {
  margin: 0;
  font-size: 12px;
  opacity: 0.7;
}

.groups__messages {
  position: relative;
  padding: 18px;
  min-height: 420px;
}

.bubble {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.94);
  position: absolute;
  filter: drop-shadow(0 10px 18px rgba(0, 0, 0, 0.14));
}

.bubble.is-left {
  left: 22px;
}

.bubble.is-right {
  right: 26px;
}

.bubble:nth-of-type(1) { top: 78px; }
.bubble:nth-of-type(2) { top: 150px; }
.bubble:nth-of-type(3) { top: 228px; }
.bubble:nth-of-type(4) { top: 118px; width: 64px; height: 64px; }
.bubble:nth-of-type(5) { top: 318px; }

.groups__empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  text-align: center;
  padding: 24px;
}

.groups__emptyTitle {
  margin: 0;
  font-weight: 900;
}

.groups__emptyText {
  margin: 6px 0 0;
  max-width: 48ch;
  opacity: 0.75;
}

.groups__composer {
  padding: 14px 14px 16px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  background: rgba(255, 255, 255, 0.55);
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
}

.groups__input {
  height: 46px;
  border-radius: 14px;
  padding: 0 14px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: rgba(255, 255, 255, 0.92);
  outline: none;
}

.groups__input:focus {
  border-color: rgba(88, 101, 242, 0.45);
  box-shadow: 0 0 0 4px rgba(88, 101, 242, 0.12);
}

.groups__send {
  height: 46px;
  padding: 0 18px;
  border-radius: 14px;
  border: none;
  cursor: pointer;
  font-weight: 900;
  color: #0b0b0b;
  background: rgba(255, 255, 255, 0.90);
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.12);
}

.groups__send:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}

@media (max-width: 860px) {
  .groups {
    grid-template-columns: 1fr;
  }

  .groups__sidebar {
    display: none;
  }
}
</style>