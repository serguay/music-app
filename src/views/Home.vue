<script setup>
import PlayerBar from '../components/PlayerBar.vue'
import { ref, onMounted, watch, computed, onUnmounted } from 'vue'
import { supabase } from '../lib/supabase'
import { useRouter } from 'vue-router'
import { usePlayer } from '../stores/player'

import UploadButton from '../components/UploadButton.vue'
import Playlist from '../components/Playlist.vue'
import CompleteProfileModal from '../components/CompleteProfileModal.vue'
import logoImg from '../assets/home.png'

/* ======================
   VERSION
====================== */
const appVersion = __APP_VERSION__

/* ======================
   ROUTER & STORE
====================== */
const router = useRouter()
const player = usePlayer()

/* ======================
   STATE
====================== */
const showProfileModal = ref(false)
const showStats = ref(false)
const showSearch = ref(false)
const showTrending = ref(false)
const showPromotions = ref(false)
const showMusicMap = ref(false)
const showListened = ref(false)
const showUsers = ref(false)
const userId = ref(null)
const isAdmin = ref(false)

const currentSong = ref(null)
const songs = ref([])
const playlistKey = ref(0)
const search = ref('')

const users = ref([])

/* ✅ MOBILE SIDEBAR DRAWER */
const showMobileSidebar = ref(false)

/* ======================
   STATS
====================== */
const playCounts = ref({})
const globalPlayCounts = ref({})
let statsChannel = null
let usersChannel = null

let presenceChannel = null

// ✅ ONLINE USERS (Realtime Presence)
const onlineMap = ref({})

// ✅ RGB mode (shared between views)
// Profile activa `html.rgb-mode`. En Home lo respetamos y también lo restauramos
// desde localStorage por si se recarga la página en /app.
const syncRgbMode = () => {
  try {
    const html = document.documentElement

    // Si ya está puesto en el DOM (por Profile), lo dejamos.
    if (html.classList.contains('rgb-mode')) return

    // Fallback: intenta leerlo de localStorage (por si recarga directa a Home)
    const v = localStorage.getItem('rgb-mode') ?? localStorage.getItem('rgbMode')
    const enabled = v === '1' || v === 'true'
    if (enabled) html.classList.add('rgb-mode')
  } catch (e) {
    // no-op
  }
}

let removeRgbListeners = null

const updateOnlineState = () => {
  if (!presenceChannel) return
  const state = presenceChannel.presenceState?.() || {}
  const onlineIds = Object.keys(state)
  onlineMap.value = onlineIds.reduce((acc, id) => {
    acc[id] = true
    return acc
  }, {})
}


const isUserOnline = (id) => !!onlineMap.value?.[id]

// ✅ Nombre a mostrar (evita "Usuario sin nombre" cuando el profile aún no tiene username)
const displayUserName = (u) => {
  const name = (u?.username ?? '').trim()
  if (name) return name

  // fallback: usa parte del id para que siempre sea distinguible
  const shortId = u?.id ? String(u.id).slice(0, 6) : ''
  return shortId ? `Usuario ${shortId}` : 'Usuario'
}

/* ✅ NUEVO: auth listener (si se cierra sesión en otra parte) */
let authListener = null

// ✅ Guards para evitar bugs de reproducción (doble "ended", doble next, etc.)
let disposeEnded = null
let isAdvancing = false

const safePlayNext = async () => {
  if (isAdvancing) return
  isAdvancing = true

  try {
    // ✅ Si el store tiene nextSong (con shuffle/cola), úsalo
    if (typeof player.nextSong === 'function') {
      const r = player.nextSong()
      // por si devuelve Promise
      if (r?.then) await r
      return
    }

    // fallback legacy (orden normal)
    if (!player.currentSong || !songs.value.length) return
    const index = songs.value.findIndex((s) => s.id === player.currentSong.id)
    if (index === -1) return
    player.playSong(songs.value[(index + 1) % songs.value.length])
  } finally {
    // mini delay para evitar dobles disparos del ended
    setTimeout(() => {
      isAdvancing = false
    }, 250)
  }
}

/* ======================
   LOAD USER STATS
====================== */
const loadStats = async () => {
  if (!userId.value) return

  const { data: mySongs } = await supabase
    .from('audios')
    .select('id')
    .eq('user_id', userId.value)

  if (!mySongs || mySongs.length === 0) {
    playCounts.value = {}
    return
  }

  const mySongIds = mySongs.map(s => s.id)

  const { data: history } = await supabase
    .from('listening_history')
    .select('song_id')
    .in('song_id', mySongIds)

  const counts = {}
  history?.forEach(row => {
    counts[row.song_id] = (counts[row.song_id] || 0) + 1
  })

  playCounts.value = counts
}

/* ======================
   LOAD USERS
====================== */
const loadUsers = async () => {
  const { data } = await supabase
    .from('profiles')
    .select('id, username, created_at')
    .order('created_at', { ascending: false })

  users.value = data || []
}

/* ======================
   LOAD GLOBAL STATS
====================== */
const loadGlobalStats = async () => {
  const { data } = await supabase
    .from('listening_history')
    .select('song_id')

  const counts = {}
  data?.forEach(row => {
    counts[row.song_id] = (counts[row.song_id] || 0) + 1
  })

  globalPlayCounts.value = counts
}

/* ======================
   COMPUTED
====================== */
const mySongs = computed(() =>
  songs.value.filter(s => s.user_id === userId.value)
)

const totalPlays = computed(() =>
  Object.values(playCounts.value).reduce((a, b) => a + b, 0)
)

const totalSongsListened = computed(() =>
  Object.keys(playCounts.value).length
)

const topSong = computed(() => {
  if (!mySongs.value.length) return null
  return mySongs.value
    .map(s => ({ ...s, plays: playCounts.value[s.id] || 0 }))
    .sort((a, b) => b.plays - a.plays)[0]
})

const topGlobalSong = computed(() => {
  if (!songs.value.length) return null
  return songs.value
    .map(s => ({
      ...s,
      plays: globalPlayCounts.value[s.id] || 0
    }))
    .sort((a, b) => b.plays - a.plays)[0]
})

/* ======================
   INIT
====================== */
onMounted(async () => {
  // ✅ 1) Comprobamos sesión al entrar
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    router.push('/')
    return
  }

  userId.value = session.user.id
  // ✅ marca esta vista para que los estilos :global del Home SOLO apliquen aquí
  document.body.classList.add('home-page')

  // ✅ aplica RGB si venimos de Profile con el modo activo
  syncRgbMode()

  // ✅ si el usuario vuelve a esta pestaña, re-sincroniza
  const onFocus = () => syncRgbMode()
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onFocus)
  removeRgbListeners = () => {
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onFocus)
  }

  // ✅ Presence: detecta usuarios online/offline en tiempo real
  presenceChannel = supabase
    .channel('online-users', {
      config: {
        presence: {
          key: userId.value
        }
      }
    })
    .on('presence', { event: 'sync' }, () => {
      updateOnlineState()
    })
    .on('presence', { event: 'join' }, () => {
      updateOnlineState()
    })
    .on('presence', { event: 'leave' }, () => {
      updateOnlineState()
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // Trackeamos que este usuario está online
        await presenceChannel.track({
          online_at: new Date().toISOString()
        })
        updateOnlineState()
      }
    })

  // ✅ 2) Listener: si cierras sesión en otra pestaña / pantalla, redirige
  authListener = supabase.auth.onAuthStateChange((event, newSession) => {
    if (!newSession) {
      // se cerró sesión
      userId.value = null
      router.push('/')
      return
    }
    userId.value = newSession.user.id
  })

  await player.initUser()

  // ✅ Evita registrar múltiples handlers si el componente se monta más de una vez
  if (!disposeEnded) {
    const maybeDispose = player.onEnded(() => {
      safePlayNext()
    })

    // algunos stores devuelven un "unsubscribe"
    if (typeof maybeDispose === 'function') {
      disposeEnded = maybeDispose
    }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('username, is_admin')
    .eq('id', userId.value)
    .single()

  showProfileModal.value = !profile?.username
  isAdmin.value = !!profile?.is_admin

  await loadStats()
  await loadGlobalStats()
  await loadUsers()

  statsChannel = supabase
    .channel('stats-realtime')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'listening_history' },
      payload => {
        const songId = payload.new.song_id
        playCounts.value[songId] = (playCounts.value[songId] || 0) + 1
        globalPlayCounts.value[songId] =
          (globalPlayCounts.value[songId] || 0) + 1
      }
    )
    .subscribe()

  usersChannel = supabase
    .channel('users-realtime')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'profiles' },
      payload => {
        users.value.unshift(payload.new)
      }
    )
    .subscribe()
})

onUnmounted(() => {
  if (statsChannel) supabase.removeChannel(statsChannel)
  if (usersChannel) supabase.removeChannel(usersChannel)
  if (presenceChannel) supabase.removeChannel(presenceChannel)

  // ✅ limpia listener auth
  if (authListener?.data?.subscription) {
    authListener.data.subscription.unsubscribe()
  }

  // ✅ limpia handler de ended si el store lo permite
  if (typeof disposeEnded === 'function') {
    disposeEnded()
    disposeEnded = null
  }
  if (typeof removeRgbListeners === 'function') {
    removeRgbListeners()
    removeRgbListeners = null
  }
  document.body.classList.remove('home-page')
  document.body.style.overflow = 'auto'
})

watch(() => player.currentSong, song => (currentSong.value = song))

/* ✅ cuando abres drawer móvil, bloquea scroll; al cerrar, restáuralo */
watch(showMobileSidebar, (v) => {
  // ✅ cuando abres drawer móvil, bloquea scroll; al cerrar, restáuralo
  document.body.style.overflow = v ? 'hidden' : 'auto'
})

/* ======================
   NAV
====================== */
const goToNotifications = () => router.push('/notifications')
const goToProfile = () => {
  if (!userId.value) return
  router.push('/profile/' + userId.value)
}

const goToUserProfile = (id) => {
  if (!id) return
  router.push('/profile/' + id)
}

const goToPromotions = () => {
  // ✅ si luego creas una pantalla /promotions, ya lo tienes listo
  router.push('/promotions')
}

const goToMusicMap = () => {
  // ✅ si luego creas una pantalla /music-map, ya lo tienes listo
  router.push('/music-map')
}

const goToAdmin = () => router.push('/admin')

const logout = async () => {
  player.stopSong()
  await supabase.auth.signOut()
  router.push('/')
}

/* ======================
   PLAYER
====================== */
const onUploaded = () => {
  playlistKey.value++
  songs.value = []

  // ✅ evita que la cola vieja siga sonando tras subir
  if (typeof player.setQueue === 'function') {
    player.setQueue([])
  }
}
const playSong = (song) => player.playSong(song)

// ✅ Recibimos la lista real que pinta el Home y se la pasamos al player
const onSongsLoaded = (list) => {
  songs.value = Array.isArray(list) ? list : []
  // guardamos la cola en el store para que el "ended" y el ⏭ usen la misma fuente
  if (typeof player.setQueue === 'function') {
    player.setQueue(songs.value)
  }
}

const playNext = () => safePlayNext()
</script>

<template>
  <section class="home">
    <!-- ✅ SIDEBAR ESCRITORIO -->
    <div class="side-card">
      <button class="side-icon" @click="showStats = true">📊</button>

      <button
        class="side-icon"
        style="margin-top:10px"
        @click="showSearch = !showSearch"
      >
        🔍
      </button>

      <button
        class="side-icon"
        style="margin-top:10px"
        title="Canciones escuchadas"
        @click="showListened = true"
      >
        🎧
      </button>

      <button
        class="side-icon"
        style="margin-top:10px"
        title="Usuarios"
        @click="showUsers = true"
      >
        👥
      </button>

      <button
        class="side-icon"
        style="margin-top:10px"
        @click="showTrending = true"
        title="Tendencias"
      >
        🔥
      </button>

      <button
        class="side-icon"
        style="margin-top:10px"
        @click="showPromotions = true"
        title="Promociones"
      >
        💸
      </button>
      <button
        class="side-icon"
        style="margin-top:10px"
        @click="showMusicMap = true"
        title="Music Map"
      >
        📍
      </button>
      <button
        v-if="isAdmin"
        class="side-icon"
        style="margin-top:10px"
        @click="goToAdmin"
        title="Admin"
      >
        🛡️
      </button>
    </div>

    <!-- ✅ BOTÓN MENÚ MÓVIL -->
    <button
      class="mobile-sidebar-btn"
      @click="showMobileSidebar = !showMobileSidebar"
      aria-label="Menú"
      title="Menú"
    >
      ☰
    </button>

    <!-- ✅ DRAWER MÓVIL -->
    <div
      v-if="showMobileSidebar"
      class="mobile-sidebar-overlay"
      @click.self="showMobileSidebar = false"
    >
      <aside class="mobile-sidebar-drawer">
        <div class="mobile-sidebar-actions">
          <button
            class="m-side-item"
            @click="showStats = true; showMobileSidebar = false"
            title="Stats"
          >
            📊
          </button>

          <button
            class="m-side-item"
            @click="showListened = true; showMobileSidebar = false"
            title="Escuchadas"
          >
            🎧
          </button>

          <button
            class="m-side-item"
            @click="showUsers = true; showMobileSidebar = false"
            title="Usuarios"
          >
            👥
          </button>

          <button
            class="m-side-item"
            @click="showTrending = true; showMobileSidebar = false"
            title="Tendencias"
          >
            🔥
          </button>

          <button
            class="m-side-item"
            @click="showPromotions = true; showMobileSidebar = false"
            title="Promociones"
          >
            💸
          </button>
          <button
            class="m-side-item"
            @click="showMusicMap = true; showMobileSidebar = false"
            title="Music Map"
          >
            📍
          </button>
          <button
            v-if="isAdmin"
            class="m-side-item"
            @click="goToAdmin; showMobileSidebar = false"
            title="Admin"
          >
            🛡️
          </button>
        </div>
      </aside>
    </div>

    <!-- ✅ SEARCH PANEL (ESCRITORIO) -->
    <div v-if="showSearch" class="search-panel">
      <div class="search-field">
        <input
          v-model="search"
          class="search-left-input"
          placeholder="Buscar canción..."
          autofocus
        />
        <button
          class="search-close-inside"
          @click="search = ''; showSearch = false"
          aria-label="Cerrar búsqueda"
          title="Cerrar"
        >
          ✕
        </button>
      </div>
    </div>

    <!-- 📊 STATS MODAL -->
    <div v-if="showStats" class="stats-modal" @click.self="showStats = false">
      <div class="stats-box">
        <h3 class="stats-title">📊 Estadísticas</h3>

        <div>🎵 Canciones: <strong>{{ mySongs.length }}</strong></div>
        <div>▶ Reproducciones: <strong>{{ totalPlays }}</strong></div>

        <div v-if="topSong" style="margin-top:8px">
          🏆 {{ topSong.title }} ({{ topSong.plays }})
        </div>

        <button class="stats-close" @click="showStats = false">
          Cerrar
        </button>
      </div>
    </div>

    <!-- 🎧 LISTENED MODAL -->
    <div
      v-if="showListened"
      class="stats-modal"
      @click.self="showListened = false"
    >
      <div class="stats-box">
        <h3 class="stats-title">🎧 Escuchadas</h3>

        <p style="font-size:1.6rem; font-weight:700">
          {{ totalSongsListened }}
        </p>

        <p style="font-size:.85rem; opacity:.7">
          canciones distintas escuchadas
        </p>

        <button class="stats-close" @click="showListened = false">
          Cerrar
        </button>
      </div>
    </div>

    <!-- 🔥 TRENDING MODAL -->
    <div
      v-if="showTrending"
      class="stats-modal"
      @click.self="showTrending = false"
    >
      <div class="stats-box">
        <h3 class="stats-title">🔥 Tendencias</h3>

        <div v-if="topGlobalSong">
          <p style="font-weight:600">{{ topGlobalSong.title }}</p>
          <p style="font-size:.85rem">
            ▶ {{ topGlobalSong.plays }} reproducciones
          </p>

          <button
            class="stats-close"
            style="margin-top:12px"
            @click="playSong(topGlobalSong); showTrending = false"
          >
            ▶ Reproducir
          </button>
        </div>

        <p v-else>Aún no hay datos</p>

        <button
          class="stats-close"
          style="margin-top:10px; background:#e5e7eb; color:#111"
          @click="showTrending = false"
        >
          Cerrar
        </button>
      </div>
    </div>

    <!-- 💸 PROMOTIONS MODAL -->
    <div
      v-if="showPromotions"
      class="stats-modal"
      @click.self="showPromotions = false"
    >
      <div class="stats-box">
        <h3 class="stats-title">💸 Promociones</h3>

        <p style="font-size:.95rem; font-weight:650; opacity:.85">
          Aquí podrás pagar para <strong>promocionar un audio</strong> y que salga más arriba en la app 🔥
        </p>

        <button
          class="stats-close"
          style="margin-top:12px"
          @click="goToPromotions"
        >
          Ir a promociones
        </button>

        <button
          class="stats-close"
          style="margin-top:10px; background:#e5e7eb; color:#111"
          @click="showPromotions = false"
        >
          Cerrar
        </button>
      </div>
    </div>

    <!-- 📍 MUSIC MAP MODAL -->
    <div
      v-if="showMusicMap"
      class="stats-modal"
      @click.self="showMusicMap = false"
    >
      <div class="stats-box">
        <h3 class="stats-title">📍 Music Map</h3>

        <p style="font-size:.95rem; font-weight:650; opacity:.85">
          Ver qué escuchan cerca de ti <strong>(por ciudad/barrio)</strong>.
        </p>

        <button
          class="stats-close"
          style="margin-top:12px"
          @click="goToMusicMap"
        >
          Abrir Music Map
        </button>

        <button
          class="stats-close"
          style="margin-top:10px; background:#e5e7eb; color:#111"
          @click="showMusicMap = false"
        >
          Cerrar
        </button>
      </div>
    </div>

    <!-- 👥 USERS MODAL -->
    <div v-if="showUsers" class="stats-modal" @click.self="showUsers = false">
      <div class="users-box">
        <h3 class="users-title">👥 Usuarios registrados</h3>

        <div class="users-list">
          <div
            v-for="u in users"
            :key="u.id"
            class="user-item"
            @click="router.push('/profile/' + u.id)"
          >
            <div class="user-avatar">👤</div>
            <div class="user-name">
              {{ displayUserName(u) }}

              <span
                class="user-status"
                :class="{ online: isUserOnline(u.id) }"
              >
                <span class="status-dot"></span>
                {{ isUserOnline(u.id) ? 'Activo' : 'Desconectado' }}
              </span>
            </div>
          </div>
        </div>

        <button class="users-close" @click="showUsers = false">
          Cerrar
        </button>
      </div>
    </div>

    <!-- LOGOUT (esto cierra sesión GLOBAL) -->
    <button class="logout-fab" @click="logout">⏻</button>

    <!-- HEADER -->
    <header class="header">
      <div class="logo-wrapper">
        <img class="app-logo" :src="logoImg" alt="Connected Music" />
      </div>
      <span class="version">v{{ appVersion }}</span>

      <!-- ✅ BOTONES MEJORADOS -->
      <div class="actions modern-actions">
        <button class="action-btn action-btn--icon" @click="goToNotifications">
          <span class="action-btn__emoji">🔔</span>
        </button>

        <UploadButton class="action-btn action-btn--primary" @uploaded="onUploaded" />

        <button class="action-btn action-btn--secondary" @click="goToProfile">
          <span class="action-btn__emoji">👤</span>
          <span>Mi perfil</span>
        </button>
      </div>
    </header>


    <!-- ✅ Buscador móvil -->
    <div class="m-search">
      <span class="m-search__icon">🔎</span>
      <input
        v-model="search"
        placeholder="Encuentra canciones..."
        class="m-search__input"
      />
      <button
        v-if="search"
        class="m-search__clear"
        type="button"
        @click="search = ''"
      >
        ✕
      </button>
    </div>

    <!-- PLAYLIST -->
    <div class="playlist-wrap">
      <Playlist
        :key="playlistKey"
        :search="search"
        @play="playSong"
        @songs-loaded="onSongsLoaded"
      />
    </div>

    <CompleteProfileModal
      v-if="showProfileModal"
      :userId="userId"
      @close="showProfileModal = false"
    />

    <PlayerBar
      v-if="player.currentSong"
      @next="playNext"
      @go-profile="goToUserProfile"
    />
  </section>
</template>
<style scoped>
/* =========================================
   0. BASE
   ========================================= */
* { box-sizing: border-box; }

/*
  ✅ IMPORTANTE:
  Estos estilos eran globales y se quedaban activos incluso al salir del Home,
  rompiendo otras vistas (Profile quedaba “en blanco”).
  Ahora SOLO aplican cuando el body tiene la clase `home-page`.
*/
/* =========================================
   0. BASE
   ========================================= */
* { box-sizing: border-box; }

:global(body.home-page) {
  height: auto;
  min-height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  margin: 0;
  position: relative;
  z-index: 0;
  background:
    radial-gradient(900px 500px at 20% 10%, rgba(99,102,241,0.35), transparent 60%),
    radial-gradient(900px 500px at 80% 15%, rgba(34,197,94,0.22), transparent 60%),
    radial-gradient(900px 500px at 50% 90%, rgba(239,68,68,0.10), transparent 55%),
    linear-gradient(180deg, #f8fafc 0%, #eef2ff 45%, #f8fafc 100%);
}

/* =========================================
   🌈 RGB MODE (GLOBAL) — ANIMADO DE VERDAD
   ✅ Animación fiable (iOS/Safari)
   ✅ No tapa clicks (pointer-events:none)
   ✅ No “congela” (sin background-attachment:fixed)
   
   Idea: pintamos el RGB en un ::before FIXED por detrás del Home.
========================================= */

/* fallback base cuando RGB está ON */
:global(html.rgb-mode) {
  background: #0b0b0c !important;
}

/* El Home debe dejar ver el fondo */
:global(html.rgb-mode body.home-page) {
  background: transparent !important;
}

/* Capa de fondo animada DETRÁS de todo (sin bloquear botones) */
:global(html.rgb-mode body.home-page::before) {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;

  background: linear-gradient(
    135deg,
    #ff0080,
    #ff4ecd,
    #7928ca,
    #4f46e5,
    #2afadf,
    #00ffcc,
    #ffdd00,
    #ff0080
  );
  background-size: 700% 700%;

  /* ✅ solo background-position (más compatible). Hue-rotate opcional abajo */
  animation: rgbMove 10s ease-in-out infinite;
  will-change: background-position;
}

/* (Opcional) Si quieres también el cambio de tono, descomenta estas 2 líneas.
   OJO: en algunos iPhone viejos puede ir a trompicones.
   filter: hue-rotate(0deg);
   animation: rgbMove 10s ease-in-out infinite, rgbHue 12s linear infinite;
*/

/* Dark normal cuando RGB NO está activo */
:global(html:not(.rgb-mode) body.home-page.p-dark) {
  background:
    radial-gradient(900px 500px at 20% 10%, rgba(99,102,241,0.16), transparent 60%),
    radial-gradient(900px 500px at 80% 15%, rgba(34,197,94,0.10), transparent 60%),
    radial-gradient(900px 500px at 50% 90%, rgba(239,68,68,0.06), transparent 55%),
    linear-gradient(180deg, #0b0b0c 0%, #0f1014 45%, #0b0b0c 100%) !important;
}

@keyframes rgbMove {
  0% { background-position: 0% 50%; }
  25% { background-position: 50% 100%; }
  50% { background-position: 100% 50%; }
  75% { background-position: 50% 0%; }
  100% { background-position: 0% 50%; }
}

@keyframes rgbHue {
  0% { filter: hue-rotate(0deg); }
  100% { filter: hue-rotate(360deg); }
}

/* =========================================
   1. LAYOUT PRINCIPAL
   ========================================= */
.home {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: 0 0 7.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;

  /* ✅ evita scroll dentro del contenedor (que crea la barra en medio) */
  overflow-x: hidden;
  overflow-y: visible !important;

  min-height: 100vh;
  background: transparent;
}

@media (min-width: 1024px) {
  .home {
    padding-left: 0;
    padding-right: 0;
    padding-top: 1.5rem;
    align-items: center;
  }
}

/* =========================================
   2. SIDEBAR (ESCRITORIO)
   ========================================= */
.side-card { display: none; }

@media (min-width: 1024px) {
  .side-card {
    display: flex;
    flex-direction: column;
    position: fixed;
    left: 16px;
    top: 80px;
    width: 64px;
    height: calc(100vh - 140px);
    align-items: center;
    padding-top: 16px;
    background: rgba(255,255,255,0.65);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.3);
    border-radius: 20px;
    gap: 12px;
    z-index: 100;
    box-shadow: 0 20px 50px rgba(0,0,0,0.12);
  }
}

.side-icon {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  border: none;
  background: rgba(255,255,255,0.85);
  font-size: 18px;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: all 0.2s ease;
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}

.side-icon:hover { 
  transform: scale(1.08) translateY(-2px);
  box-shadow: 0 8px 20px rgba(0,0,0,0.15);
}

/* =========================================
   3. HEADER Y LOGO (FIX: no se pisa)
   ========================================= */
.header {
  text-align: center;
  width: 100%;
  /* ⬆️ Menos aire arriba para que todo no quede tan abajo */
  padding: 10px 16px 0;

  /* ✅ stacking para que no lo tape nada */
  position: relative;
  z-index: 10000; /* ✅ FIX */
  overflow: visible; /* ✅ que el logo no se recorte */
}

@media (max-width: 1023px) {
  .header {
    padding-top: 8px;
  }
}

.logo-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  margin: 0 0 8px;      /* ⬆️ un pelín más compacto */
  min-height: 84px;     /* ✅ reserva altura */
  position: relative;
  z-index: 2;
  overflow: visible; /* ✅ que el logo no se recorte */
}

@media (max-width: 1023px) {
  .logo-wrapper {
    /* En móvil, menos altura reservada para subir categorías/playlist */
    min-height: 68px;
    margin-bottom: 6px;
    padding-top: 12px; /* ✅ espacio para que no se corte el logo */
  }
}

.app-logo {
  width: min(300px, 86vw);
  height: auto;
  display: block;
  margin: -90px; /* ✅ NO TOCAR */

  /* ✅ sin filtro ni animación */
  filter: none !important;
  transition: none !important;

  transform: translateY(12px); /* ✅ baja un pelín para que no se corte arriba */
}

/* ✅ versión más pegadita al logo, pero sin invadir */
.version {
  display: block;
  margin-top: 0px;
  margin-bottom: 6px;   /* ⬆️ menos espacio hacia abajo */
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: .12em;
  text-transform: uppercase;
  opacity: .55;
  color: rgba(0,0,0,.65);
}

/* ✅ los botones abajo, no encima */
.modern-actions {
  margin-top: 0 !important;
  padding-top: 0;
  position: relative;
  z-index: 3;
}

/* =========================================
   4. BOTONES DE ACCIÓN ✅ MEJORADOS
   ========================================= */
.modern-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-top: 6px; /* ⬆️ sube un poco todo */
  flex-wrap: wrap;
  width: 100%;
  position: relative;
  z-index: 3;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  cursor: pointer;
  font-weight: 700;
  font-size: 0.92rem;
  position: relative;
  overflow: hidden;
  transition: all 0.25s cubic-bezier(0.23, 1, 0.32, 1);
}

.action-btn__emoji {
  font-size: 1.1rem;
  line-height: 1;
}

/* Botón icono (notificaciones) */
.action-btn--icon {
  width: 52px;
  height: 52px;
  border-radius: 16px;
  background: rgba(255,255,255,0.75);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.5);
  box-shadow: 
    0 8px 24px rgba(0,0,0,0.12),
    inset 0 1px 0 rgba(255,255,255,0.8);
}

.action-btn--icon:hover {
  transform: translateY(-3px) scale(1.05);
  box-shadow: 
    0 14px 35px rgba(0,0,0,0.18),
    inset 0 1px 0 rgba(255,255,255,0.9);
  background: rgba(255,255,255,0.9);
}

/* Botón principal (subir audio) - se estiliza desde UploadButton */
.action-btn--primary {
  padding: 14px 26px;
  border-radius: 999px;
  background: linear-gradient(135deg, #111827 0%, #1f2937 50%, #111827 100%);
  color: white;
  box-shadow: 
    0 10px 30px rgba(0,0,0,0.25),
    inset 0 1px 0 rgba(255,255,255,0.1);
  letter-spacing: 0.02em;
}

.action-btn--primary:hover {
  transform: translateY(-3px);
  box-shadow: 
    0 16px 40px rgba(0,0,0,0.35),
    inset 0 1px 0 rgba(255,255,255,0.15);
  filter: brightness(1.1);
}

/* Botón secundario (mi perfil) */
.action-btn--secondary {
  padding: 14px 22px;
  border-radius: 999px;
  background: rgba(255,255,255,0.75);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.5);
  color: rgba(0,0,0,0.85);
  box-shadow: 
    0 8px 24px rgba(0,0,0,0.10),
    inset 0 1px 0 rgba(255,255,255,0.8);
}

.action-btn--secondary:hover {
  transform: translateY(-3px);
  box-shadow: 
    0 14px 35px rgba(0,0,0,0.15),
    inset 0 1px 0 rgba(255,255,255,0.9);
  background: rgba(255,255,255,0.92);
}

/* Shine effect */
.action-btn::after {
  content: "";
  position: absolute;
  top: -50%;
  left: -110%;
  width: 60%;
  height: 200%;
  background: linear-gradient(
    to right,
    transparent,
    rgba(255,255,255,0.25),
    transparent
  );
  transform: rotate(25deg);
  transition: left 0.5s ease;
}

.action-btn:hover::after {
  left: 120%;
}

.action-btn:active {
  transform: translateY(1px) scale(0.98);
}

/* =========================================
   5. BUSCADOR MÓVIL
   ========================================= */
.m-search {
  display: none;
}

@media (max-width: 1023px) {
  .m-search {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    max-width: 520px;
    height: 54px;
    margin: 20px auto 0px !important;
    padding: 0 12px;
    border-radius: 999px;
    position: relative;
    z-index: 10000; /* ✅ FIX */
    background: rgba(255,255,255,0.55);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    box-shadow:
      0 22px 60px rgba(0,0,0,0.14),
      inset 0 1px 0 rgba(255,255,255,0.70);
  }

  .m-search::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 999px;
    padding: 2px;
    background: linear-gradient(135deg,
      rgba(99,102,241,0.85),
      rgba(34,197,94,0.70),
      rgba(99,102,241,0.85)
    );
    -webkit-mask:
      linear-gradient(#000 0 0) content-box,
      linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    opacity: 0.55;
    pointer-events: none;
    transition: opacity .2s ease;
  }

  .m-search__icon {
    width: 36px;
    height: 36px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    background: rgba(0,0,0,0.06);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.7);
    opacity: .75;
    flex: 0 0 auto;
  }

  .m-search__input {
    flex: 1;
    height: 100%;
    border: none;
    outline: none;
    background: transparent;
    font-size: 16px;
    font-weight: 700;
    color: rgba(0,0,0,0.80);
  }

  .m-search__input::placeholder {
    color: rgba(0,0,0,0.42);
    font-weight: 650;
  }

  .m-search__clear {
    width: 36px;
    height: 36px;
    border-radius: 999px;
    border: 1px solid rgba(0,0,0,0.08);
    background: rgba(0,0,0,0.55);
    color: rgba(255,255,255,0.95);
    display: grid;
    place-items: center;
    cursor: pointer;
    box-shadow:
      0 14px 28px rgba(0,0,0,0.16),
      inset 0 1px 0 rgba(255,255,255,0.18);
    transition: transform .15s ease, background .15s ease;
    flex: 0 0 auto;
  }

  .m-search__clear:active {
    transform: scale(0.96);
  }

  .m-search:focus-within {
    transform: translateY(-1px);
    box-shadow:
      0 28px 80px rgba(0,0,0,0.18),
      0 0 0 8px rgba(99,102,241,0.10),
      inset 0 1px 0 rgba(255,255,255,0.78);
  }

  .m-search:focus-within::before {
    opacity: 0.95;
  }
}

/* =========================================
   7. SEARCH PANEL ESCRITORIO
   ========================================= */
.search-panel {
  width: 440px;
  max-width: calc(100% - 32px);
  display: flex;
  align-items: center;
  margin: 0;
  padding: 0;
  background: transparent;
  box-shadow: none;
}

@media (min-width: 1024px) {
  .search-panel {
    position: fixed;
    left: 112px;
    top: 190px;
    transform: translateY(-40px);
    z-index: 1000;
  }
}

@media (max-width: 1023px) {
  .search-panel {
    display: flex !important;
    position: relative !important;
    left: auto !important;
    top: auto !important;
    transform: none !important;
    width: 100%;
    max-width: 500px;
    margin: 20px auto 25px !important;
    padding: 0 16px;
    z-index: 10;
  }
}

/* =========================================
   8. MODALES
   ========================================= */
.stats-modal {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.55);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999;
}

.stats-box, .users-box {
  background: white;
  border-radius: 26px;
  padding: 26px;
  width: 90%;
  max-width: 360px;
  text-align: center;
  color: #111;
  box-shadow: 0 30px 80px rgba(0,0,0,.35);
  animation: modalPop .25s cubic-bezier(0.2, 1.2, 0.2, 1) both;
}

@keyframes modalPop {
  0% { opacity: 0; transform: scale(0.9) translateY(20px); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}

.stats-title, .users-title {
  font-size: 1.2rem;
  font-weight: 800;
  margin-bottom: 16px;
}

.users-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 50vh;
  overflow-y: auto;
  margin: 15px 0;
}

.user-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 14px;
  background: #f3f4f6;
  cursor: pointer;
  transition: all .2s ease;
}

.user-item:hover {
  background: #e5e7eb;
  transform: translateX(4px);
}

.user-avatar {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: rgba(99,102,241,0.15);
  display: grid;
  place-items: center;
  font-size: 1.2rem;
}

.user-name {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  font-weight: 700;
}

.user-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  font-weight: 800;
  opacity: .75;
}

.user-status .status-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: #9ca3af;
  box-shadow: 0 0 0 3px rgba(156,163,175,.18);
}

.user-status.online {
  opacity: 1;
}

.user-status.online .status-dot {
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34,197,94,.18);
}

.stats-close, .users-close {
  width: 100%;
  padding: 14px;
  border-radius: 999px;
  border: none;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: white;
  font-weight: 700;
  cursor: pointer;
  margin-top: 12px;
  box-shadow: 0 8px 20px rgba(99,102,241,0.3);
  transition: all 0.2s ease;
}

.stats-close:hover, .users-close:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 28px rgba(99,102,241,0.4);
}

/* =========================================
   9. LOGOUT FAB
   ========================================= */
.logout-fab {
  position: fixed !important;
  display: grid !important;
  place-items: center;
  top: calc(50px + env(safe-area-inset-top)) !important;
  right: calc(16px + env(safe-area-inset-right)) !important;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(135deg, #ef4444, #dc2626);
  color: white;
  box-shadow: 0 8px 24px rgba(239,68,68,.4);
  z-index: 2147483647 !important;
  opacity: 1 !important;
  visibility: visible !important;
  pointer-events: auto !important;
  transition: all 0.2s ease;
}

.logout-fab:hover {
  transform: scale(1.08);
  box-shadow: 0 12px 30px rgba(239,68,68,.5);
}

@media (min-width: 1024px) {
  .logout-fab {
    top: calc(20px + env(safe-area-inset-top)) !important;
  }
}

/* =========================================
   10. MOBILE SIDEBAR
   ========================================= */
.mobile-sidebar-btn {
  display: none;
}

@media (max-width: 1023px) {
  .mobile-sidebar-btn {
    display: grid !important;
    place-items: center;
    position: fixed;
    z-index: 999999;
    top: calc(86px + env(safe-area-inset-top));
    left: 14px;
    width: 46px;
    height: 46px;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.22);
    background: rgba(255,255,255,0.20);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    color: rgba(0,0,0,0.85);
    font-size: 18px;
    font-weight: 900;
    box-shadow:
      0 18px 40px rgba(0,0,0,0.18),
      inset 0 1px 0 rgba(255,255,255,0.70);
    cursor: pointer;
    transition: transform .15s ease, background .15s ease;
  }

  .mobile-sidebar-btn:hover {
    transform: translateY(-1px);
    background: rgba(255,255,255,0.28);
  }

  .mobile-sidebar-btn:active {
    transform: scale(.96);
  }
}

.mobile-sidebar-overlay {
  position: fixed;
  inset: 0;
  z-index: 999998;
  background: rgba(0,0,0,0.35);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.mobile-sidebar-drawer {
  position: fixed;
  z-index: 999999;
  left: 12px;
  top: calc(140px + env(safe-area-inset-top));
  width: 74px;
  padding: 12px 10px;
  border-radius: 22px;
  background: rgba(255,255,255,0.22);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border: 1px solid rgba(255,255,255,0.25);
  box-shadow:
    0 26px 70px rgba(0,0,0,0.22),
    inset 0 1px 0 rgba(255,255,255,0.75);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.mobile-sidebar-actions {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.m-side-item {
  width: 52px;
  height: 52px;
  border-radius: 18px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(255,255,255,0.25);
  background: rgba(255,255,255,0.18);
  font-size: 19px;
  cursor: pointer;
  box-shadow:
    0 16px 30px rgba(0,0,0,0.14),
    inset 0 1px 0 rgba(255,255,255,0.70);
  transition: transform .15s ease, background .15s ease;
}

.m-side-item span {
  display: none;
}

.m-side-item:hover {
  transform: translateY(-1px) scale(1.02);
  background: rgba(255,255,255,0.28);
}

.m-side-item:active {
  transform: scale(.96);
}

/* =========================================
   11. PLAYLIST WRAP
   ========================================= */
.playlist-wrap {
  width: 100%;
  margin-top: 6px;
  position: relative;
  z-index: 0; /* ✅ FIX: atrás */
}

@media (max-width: 1023px) {
  .playlist-wrap {
    margin-top: 6px;
  }
}

/* =========================================
   12. DARK MODE
   ========================================= */
:global(.p-dark) .search-field { background: rgba(20,20,22,0.35); }
:global(.p-dark) .search-left-input {
  color: rgba(255,255,255,0.86);
  background: rgba(255,255,255,0.06);
}
:global(.p-dark) .search-left-input::placeholder { color: rgba(255,255,255,0.35); }

:global(.p-dark) .m-search {
  background: rgba(20,20,22,0.55);
  box-shadow:
    0 22px 60px rgba(0,0,0,0.38),
    inset 0 1px 0 rgba(255,255,255,0.08);
}

:global(.p-dark) .m-search__icon {
  background: rgba(255,255,255,0.06);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
  opacity: .85;
}

:global(.p-dark) .m-search__input {
  color: rgba(255,255,255,0.88);
}

:global(.p-dark) .m-search__input::placeholder {
  color: rgba(255,255,255,0.40);
}

:global(.p-dark) .mobile-sidebar-btn {
  color: rgba(255,255,255,0.92);
  background: rgba(30,30,34,0.40);
  border-color: rgba(255,255,255,0.14);
}

:global(.p-dark) .mobile-sidebar-drawer {
  background: rgba(30,30,34,0.55);
  border-color: rgba(255,255,255,0.14);
}

:global(.p-dark) .m-side-item {
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.10);
  color: rgba(255,255,255,0.92);
}

:global(.p-dark) .side-card {
  background: rgba(30,30,34,0.65);
  border-color: rgba(255,255,255,0.1);
}

:global(.p-dark) .side-icon {
  background: rgba(255,255,255,0.08);
  color: white;
}

:global(.p-dark) .action-btn--icon,
:global(.p-dark) .action-btn--secondary {
  background: rgba(30,30,34,0.65);
  border-color: rgba(255,255,255,0.15);
  color: white;
}

:global(.p-dark) .version {
  color: rgba(255,255,255,0.5);
}

:global(.p-dark) .stats-box,
:global(.p-dark) .users-box {
  background: #1a1a2e;
  color: white;
}

:global(.p-dark) .user-item {
  background: rgba(255,255,255,0.06);
}

:global(.p-dark) .user-item:hover {
  background: rgba(255,255,255,0.12);
}
</style>