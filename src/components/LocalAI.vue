<script setup>
import { ref, onMounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'

const emit = defineEmits(['close', 'musicControl'])
const router = useRouter()

const input = ref('')
const chatContainer = ref(null)
const messages = ref([])

const key = 'local-ai-chat-v2'

// ─────────────────────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────────────────────
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const getHour = () => new Date().getHours()

const getGreeting = () => {
  const h = getHour()
  if (h >= 5 && h < 12) return pick(['Buenos días', 'Buen día', 'Qué tal esta mañana'])
  if (h >= 12 && h < 20) return pick(['Buenas tardes', 'Qué tal la tarde'])
  return pick(['Buenas noches', 'Qué tal la noche'])
}

const scrollToBottom = () => {
  nextTick(() => {
    if (chatContainer.value) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight
    }
  })
}

// ─────────────────────────────────────────────────────────────
// MENSAJES
// ─────────────────────────────────────────────────────────────
const pushMsg = (role, text) => {
  messages.value.push({ role, text, id: Date.now() + Math.random() })
  scrollToBottom()
}

const deleteMsg = (id) => {
  messages.value = messages.value.filter(m => m.id !== id)
}

const clearChat = () => {
  messages.value = []
  pushMsg('ai', 'Chat limpio ✨ ¿En qué te ayudo?')
}

// ─────────────────────────────────────────────────────────────
// NAVEGACIÓN
// ─────────────────────────────────────────────────────────────
const go = (path, msg) => {
  pushMsg('ai', msg)
  setTimeout(() => {
    emit('close')
    router.push(path)
  }, 400)
}

const routes = {
  home: { path: '/app', responses: ['¡Vamos al Home! 🏠', 'Te llevo al inicio 🚀', 'Home, dulce home 🏠'] },
  promociones: { path: '/promotions', responses: ['¡A las promos! 💸', 'Vamos a ver qué ofertas hay 🔥', 'Promociones incoming 💰'] },
  perfil: { path: '/profile', responses: ['Tu perfil, ¡vamos! 👤', 'Te llevo a tu perfil ✨', 'Perfil cargando... 👤'] },
  buscar: { path: '/search', responses: ['Abriendo búsqueda 🔍', '¡A buscar! 🎵'] },
  biblioteca: { path: '/library', responses: ['Tu biblioteca 📚', 'Vamos a tu colección 🎶'] },
  favoritos: { path: '/favorites', responses: ['Tus favoritos ❤️', '¡A los likes! 💜'] },
  config: { path: '/settings', responses: ['Configuración ⚙️', 'Ajustes, ¡allá vamos! 🔧'] }
}

// ─────────────────────────────────────────────────────────────
// CONTROL DE MÚSICA
// ─────────────────────────────────────────────────────────────
const musicControl = (action) => {
  emit('musicControl', action)
  const responses = {
    play: ['▶️ Reproduciendo...', '¡Dale play! 🎵', 'Música ON 🔊'],
    pause: ['⏸️ Pausado', 'Música en pausa ✋', 'Stop! ⏸️'],
    next: ['⏭️ Siguiente canción', 'Ahí va la siguiente 🎶', 'Skip! ⏭️'],
    prev: ['⏮️ Canción anterior', 'Volviendo atrás 🔙', 'La de antes ⏮️'],
    shuffle: ['🔀 Modo aleatorio', 'Shuffle activado 🎲'],
    repeat: ['🔁 Repetir activado', 'En bucle 🔄'],
    volumeUp: ['🔊 Subiendo volumen', '+Volumen 🔊'],
    volumeDown: ['🔉 Bajando volumen', '-Volumen 🔉'],
    mute: ['🔇 Silenciado', 'Mute 🤫']
  }
  return pick(responses[action] || ['Hecho ✅'])
}

// ─────────────────────────────────────────────────────────────
// RESPUESTAS CONVERSACIONALES
// ─────────────────────────────────────────────────────────────
const conversational = {
  greetings: {
    patterns: ['hola', 'hey', 'buenas', 'ey', 'hi', 'hello', 'que tal', 'como estas', 'que onda', 'wenas'],
    responses: () => [
      `${getGreeting()}! 😊 ¿Qué necesitas?`,
      `¡${getGreeting()}! 🎵 ¿En qué te ayudo?`,
      `${getGreeting()}! Aquí estoy para lo que necesites 💪`
    ]
  },
  thanks: {
    patterns: ['gracias', 'thanks', 'thx', 'grax', 'te quiero', 'eres genial', 'crack'],
    responses: () => [
      '¡De nada! 😊',
      '¡Para eso estoy! 💪',
      '¡Un placer ayudarte! ✨',
      'Siempre a tu servicio 🫡'
    ]
  },
  bye: {
    patterns: ['adios', 'bye', 'chao', 'hasta luego', 'nos vemos', 'me voy'],
    responses: () => [
      '¡Hasta pronto! 👋',
      '¡Nos vemos! 🎵',
      '¡Chao! Que disfrutes la música 🎶'
    ]
  },
  mood: {
    patterns: ['estoy triste', 'estoy feliz', 'estoy aburrido', 'me siento', 'tengo sueño'],
    responses: (t) => {
      if (t.includes('triste') || t.includes('mal')) return ['Anímate, pon música alegre 🎵💪', '¿Quieres que busque algo para animarte? 🌟']
      if (t.includes('feliz') || t.includes('bien')) return ['¡Me alegro! 🥳 ¿Ponemos música para celebrar?', '¡Genial! 🎉']
      if (t.includes('aburrido')) return ['¡Pon música! 🎵 ¿Te busco algo nuevo?', 'Explora las promociones, hay cosas nuevas 🔥']
      if (t.includes('sueño')) return ['Puedo ponerte música relajante 😴', 'Hora de algo chill 🌙']
      return ['Cuéntame más 😊']
    }
  },
  jokes: {
    patterns: ['chiste', 'hazme reir', 'cuentame algo', 'dime algo gracioso'],
    responses: () => [
      '¿Qué le dice un 0 a un 8? Bonito cinturón 😂',
      '¿Por qué los pájaros no usan Facebook? Porque ya tienen Twitter 🐦',
      '¿Qué hace una abeja en el gym? ¡Zum-ba! 🐝',
      'Mi perro se llama Megabyte... porque es muy mordedor 🐕'
    ]
  },
  identity: {
    patterns: ['quien eres', 'que eres', 'como te llamas', 'eres real', 'eres una ia'],
    responses: () => [
      'Soy tu asistente musical local 🤖🎵 Sin internet, sin APIs, solo tú y yo',
      'Soy una IA que vive en tu app 🏠 ¡Trabajo offline!',
      'Me llamo... mmm, ponme un nombre tú 😄'
    ]
  },
  capabilities: {
    patterns: ['que sabes hacer', 'que puedes hacer', 'ayuda', 'help', 'comandos'],
    responses: () => [[
      '🎯 Esto es lo que puedo hacer:\n',
      '🎵 MÚSICA:',
      '   • "play" / "reproduce" - reproducir',
      '   • "pause" / "para" / "stop" - pausar',
      '   • "siguiente" / "skip" / "next" - siguiente canción',
      '   • "anterior" / "prev" - canción anterior',
      '   • "sube volumen" / "baja volumen"',
      '   • "silencio" / "mute"\n',
      '📍 NAVEGACIÓN:',
      '   • "ir a home" / "ir a promociones"',
      '   • "ir a perfil" / "ir a favoritos"',
      '   • "ir a buscar" / "ir a biblioteca"\n',
      '🔍 BÚSQUEDA:',
      '   • "buscar: [artista/canción]"\n',
      '💬 CHAT:',
      '   • "limpiar chat" - borrar historial',
      '   • También puedo charlar contigo 😊'
    ].join('\n')]
  }
}

// ─────────────────────────────────────────────────────────────
// MOTOR DE IA
// ─────────────────────────────────────────────────────────────
const processInput = (raw) => {
  const t = norm(raw)
  if (!t) return pick(['Dime algo 😅', '¿Qué necesitas?', 'Te escucho...'])

  // Limpiar chat
  if (t === 'limpiar chat' || t === 'clear' || t === 'borrar chat') {
    setTimeout(clearChat, 100)
    return null
  }

  // Control de música
  if (t.match(/^(play|reproduce|pon|ponla|dale)$/)) return musicControl('play')
  if (t.match(/(para la|pause|pausa|stop|para$|detener|para la (musica|cancion))/)) return musicControl('pause')
  if (t.match(/(siguiente|skip|next|pasa|pasala|otra|cambia)/)) return musicControl('next')
  if (t.match(/(anterior|prev|atras|vuelve|la de antes)/)) return musicControl('prev')
  if (t.match(/(shuffle|aleatorio|mezcla|random)/)) return musicControl('shuffle')
  if (t.match(/(repetir|repeat|bucle|loop)/)) return musicControl('repeat')
  if (t.match(/(sube|mas) (el )?volumen|volume up|\+volumen/)) return musicControl('volumeUp')
  if (t.match(/(baja|menos) (el )?volumen|volume down|-volumen/)) return musicControl('volumeDown')
  if (t.match(/(silencio|mute|calla|silencia)/)) return musicControl('mute')

  // Navegación
  for (const [key, route] of Object.entries(routes)) {
    const patterns = [
      `ir a ${key}`, `lleva a ${key}`, `ve a ${key}`, `abre ${key}`,
      `vamos a ${key}`, `muestrame ${key}`, key
    ]
    if (patterns.some(p => t.includes(norm(p)) || t === norm(key))) {
      go(route.path, pick(route.responses))
      return null
    }
  }

  // Búsqueda
  if (t.startsWith('buscar:') || t.startsWith('busca:') || t.startsWith('search:')) {
    const q = raw.replace(/^(buscar|busca|search):/i, '').trim()
    if (!q) return pick(['¿Qué busco? 🔍', 'Dime qué quieres buscar 🎵'])
    return `🔍 Para buscar "${q}", ve al buscador y escríbelo ahí. ¿Te llevo? Di "ir a buscar"`
  }
  if (t.startsWith('buscar ') || t.startsWith('busca ')) {
    const q = raw.replace(/^(buscar|busca)\s+/i, '').trim()
    if (q) return `🔍 Para buscar "${q}", di "ir a buscar" y te llevo al buscador`
  }

  // Respuestas conversacionales
  for (const [, data] of Object.entries(conversational)) {
    if (data.patterns.some(p => t.includes(p) || t === p)) {
      const responses = data.responses(t)
      return pick(responses)
    }
  }

  // Preguntas sobre música
  if (t.match(/(que (esta )?sonando|que cancion es|que suena|que escucho)/)) {
    return pick([
      'Mira el reproductor abajo 👇🎵',
      'La info de la canción está en el player de abajo 🎶'
    ])
  }

  // Recomendaciones
  if (t.match(/(recomienda|sugiere|que (me )?(escucho|pongo)|pon algo)/)) {
    return pick([
      '¡Ve a Promociones! Hay cosas nuevas 🔥',
      'Explora tu biblioteca, seguro tienes joyas escondidas 💎',
      '¿Has probado el shuffle? A veces sorprende 🎲'
    ])
  }

  // Hora/fecha
  if (t.match(/(que hora|hora es|que dia|fecha)/)) {
    const now = new Date()
    return `🕐 Son las ${now.toLocaleTimeString('es-ES', {hour: '2-digit', minute:'2-digit'})} del ${now.toLocaleDateString('es-ES', {weekday:'long', day:'numeric', month:'long'})}`
  }

  // Fallback inteligente
  const fallbacks = [
    `No pillé "${raw}" 🤔 Di "ayuda" para ver comandos`,
    `Mmm no entendí... ¿Probamos con "ayuda"?`,
    `Eso no lo tengo aún 😅 Pero aprendo rápido, dime "ayuda"`,
    `🤖 *procesando*... nope, no sé hacer eso. ¡Pero sé otras cosas! Di "ayuda"`
  ]
  return pick(fallbacks)
}

// ─────────────────────────────────────────────────────────────
// ENVIAR MENSAJE
// ─────────────────────────────────────────────────────────────
const send = () => {
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  pushMsg('user', text)

  setTimeout(() => {
    const response = processInput(text)
    if (response) pushMsg('ai', response)
  }, 300 + Math.random() * 400) // Delay realista
}

// ─────────────────────────────────────────────────────────────
// PERSISTENCIA
// ─────────────────────────────────────────────────────────────
onMounted(() => {
  try {
    const saved = localStorage.getItem(key)
    if (saved) {
      messages.value = JSON.parse(saved)
    } else {
      pushMsg('ai', `${getGreeting()}! 😊 Soy tu IA local. Dime "ayuda" para ver todo lo que puedo hacer 🎵`)
    }
  } catch {
    pushMsg('ai', `${getGreeting()}! 😊 Soy tu IA local. Dime "ayuda" para ver lo que puedo hacer 🎵`)
  }
  scrollToBottom()
})

watch(messages, (v) => {
  try { localStorage.setItem(key, JSON.stringify(v)) } catch {}
}, { deep: true })
</script>

<template>
  <div class="ai-overlay" @click.self="emit('close')">
    <div class="ai-modal">
      <!-- Header -->
      <div class="ai-top">
        <div class="ai-title">
          <span class="ai-icon">🤖</span>
          <span>IA Local</span>
          <span class="ai-badge">Offline</span>
        </div>
        <button class="ai-x" @click="emit('close')">✕</button>
      </div>

      <!-- Chat -->
      <div class="ai-chat" ref="chatContainer">
        <div v-for="m in messages" :key="m.id" class="ai-msg" :class="m.role">
          <pre class="ai-text">{{ m.text }}</pre>
          <button
            class="delete-btn"
            @click="deleteMsg(m.id)"
            :title="m.role === 'user' ? 'Eliminar mensaje' : 'Eliminar respuesta'"
          >
            🗑️
          </button>
        </div>

        <div v-if="messages.length === 0" class="ai-empty">
          <span>💬</span>
          <p>Empieza a chatear...</p>
        </div>
      </div>

      <!-- Quick actions -->
      <div class="ai-quick">
        <button @click="input = 'ayuda'; send()">❓ Ayuda</button>
        <button @click="input = 'play'; send()">▶️ Play</button>
        <button @click="input = 'pause'; send()">⏸️ Pause</button>
        <button @click="input = 'siguiente'; send()">⏭️ Next</button>
        <button @click="input = 'ir a promociones'; send()">🔥 Promos</button>
      </div>

      <!-- Input -->
      <div class="ai-input">
        <input
          v-model="input"
          placeholder="Escribe algo... (ej: para la canción, siguiente, ayuda)"
          @keydown.enter="send"
          autofocus
        />
        <button class="send-btn" @click="send">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ai-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999999;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.ai-modal {
  width: min(540px, 94vw);
  height: min(700px, 85vh);
  background: linear-gradient(145deg, rgba(30, 30, 45, 0.98), rgba(20, 20, 35, 0.98));
  border-radius: 24px;
  box-shadow:
    0 25px 80px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(255, 255, 255, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  animation: slideUp 0.3s ease;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.ai-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.ai-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  font-size: 16px;
  color: #fff;
}

.ai-icon {
  font-size: 24px;
}

.ai-badge {
  font-size: 10px;
  padding: 3px 8px;
  background: linear-gradient(135deg, #10b981, #059669);
  border-radius: 20px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.ai-x {
  border: none;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  cursor: pointer;
  font-size: 16px;
  font-weight: 700;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  transition: all 0.2s;
}

.ai-x:hover {
  background: rgba(239, 68, 68, 0.8);
  transform: scale(1.05);
}

.ai-chat {
  flex: 1;
  padding: 16px 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  scroll-behavior: smooth;
}

.ai-chat::-webkit-scrollbar {
  width: 6px;
}

.ai-chat::-webkit-scrollbar-track {
  background: transparent;
}

.ai-chat::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}

.ai-msg {
  max-width: 85%;
  border-radius: 18px;
  padding: 12px 16px;
  position: relative;
  animation: msgIn 0.3s ease;
}

@keyframes msgIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.ai-msg.user {
  align-self: flex-end;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  border-bottom-right-radius: 6px;
}

.ai-msg.ai {
  align-self: flex-start;
  background: rgba(255, 255, 255, 0.08);
  color: #e5e5e5;
  border-bottom-left-radius: 6px;
}

.ai-msg:hover .delete-btn {
  opacity: 1;
}

.delete-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  opacity: 0;
  background: rgba(239, 68, 68, 0.9);
  border: none;
  border-radius: 8px;
  width: 28px;
  height: 28px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ai-msg.user .delete-btn {
  left: -36px;
}

.ai-msg.ai .delete-btn {
  right: -36px;
}

.delete-btn:hover {
  background: #ef4444;
  transform: translateY(-50%) scale(1.1);
}

.ai-text {
  margin: 0;
  white-space: pre-wrap;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  word-break: break-word;
}

.ai-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.3);
  gap: 8px;
}

.ai-empty span {
  font-size: 48px;
}

.ai-empty p {
  margin: 0;
  font-size: 14px;
}

.ai-quick {
  display: flex;
  gap: 8px;
  padding: 12px 20px;
  overflow-x: auto;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.ai-quick::-webkit-scrollbar {
  height: 0;
}

.ai-quick button {
  flex-shrink: 0;
  border: none;
  background: rgba(255, 255, 255, 0.08);
  color: #e5e5e5;
  padding: 8px 14px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.ai-quick button:hover {
  background: rgba(99, 102, 241, 0.5);
  transform: translateY(-2px);
}

.ai-input {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  background: rgba(0, 0, 0, 0.2);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.ai-input input {
  flex: 1;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.08);
  padding: 14px 18px;
  outline: none;
  font-size: 14px;
  color: #fff;
  transition: all 0.2s;
}

.ai-input input::placeholder {
  color: rgba(255, 255, 255, 0.4);
}

.ai-input input:focus {
  border-color: #6366f1;
  background: rgba(99, 102, 241, 0.1);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
}

.send-btn {
  border: none;
  border-radius: 14px;
  padding: 14px 18px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.send-btn svg {
  width: 20px;
  height: 20px;
}

.send-btn:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.4);
}

.send-btn:active {
  transform: scale(0.98);
}

/* Mobile adjustments */
@media (max-width: 480px) {
  .ai-modal {
    border-radius: 20px 20px 0 0;
    height: 90vh;
    margin-top: auto;
  }

  .ai-msg {
    max-width: 90%;
  }

  .delete-btn {
    opacity: 0.7;
  }
}
</style>