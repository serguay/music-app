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
  player.onEnded(() => {
    if (typeof player.nextSong === 'function') return player.nextSong()
    return playNext()
  })

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
})

watch(() => player.currentSong, song => (currentSong.value = song))

/* ✅ cuando abres drawer móvil, bloquea scroll */
watch(showMobileSidebar, (v) => {
  document.body.style.overflow = v ? 'hidden' : ''
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
const onUploaded = () => playlistKey.value++
const playSong = (song) => player.playSong(song)

// ✅ Recibimos la lista real que pinta el Home y se la pasamos al player
const onSongsLoaded = (list) => {
  songs.value = Array.isArray(list) ? list : []
  // guardamos la cola en el store para que el "ended" y el ⏭ usen la misma fuente
  if (typeof player.setQueue === 'function') {
    player.setQueue(songs.value)
  }
}

const playNext = () => {
  // ✅ Si el store tiene nextSong (con shuffle/cola), úsalo
  if (typeof player.nextSong === 'function') return player.nextSong()

  // fallback legacy (orden normal)
  if (!player.currentSong || !songs.value.length) return
  const index = songs.value.findIndex((s) => s.id === player.currentSong.id)
  if (index === -1) return
  player.playSong(songs.value[(index + 1) % songs.value.length])
}
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
      <img class="app-logo" :src="logoImg" alt="Connected Music" />
      <span class="version">v{{ appVersion }}</span>

      <div class="actions modern-actions">
        <button class="modern-icon-btn" @click="goToNotifications">
          🔔
        </button>

        <UploadButton class="modern-main-btn" @uploaded="onUploaded" />

        <button class="modern-secondary-btn" @click="goToProfile">
          👤 Mi perfil
        </button>
      </div>
    </header>

    <div class="container-categorias narrow">
      <div class="slider-wrapper">
        <div class="slider-track">
          <span class="cat-tag-mini">Techno</span>
          <span class="cat-tag-mini">Hip Hop</span>
          <span class="cat-tag-mini">Indie</span>
          <span class="cat-tag-mini">Jazz</span>
          <span class="cat-tag-mini">Rock</span>
          <span class="cat-tag-mini">Pop</span>
          <span class="cat-tag-mini">Techno</span>
          <span class="cat-tag-mini">Hip Hop</span>
          <span class="cat-tag-mini">Indie</span>
          <span class="cat-tag-mini">Jazz</span>
          <span class="cat-tag-mini">Rock</span>
          <span class="cat-tag-mini">Pop</span>
        </div>
      </div>
    </div>

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
    <Playlist
      :key="playlistKey"
      :search="search"
      @play="playSong"
      @songs-loaded="onSongsLoaded"
    />

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

/* =========================================
   1. LAYOUT PRINCIPAL (CENTRADO IPHONE)
   ========================================= */
.home {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: 0.4rem 0 7.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow-x: hidden;
}

/* ✅ DESKTOP: mantener centrado real (NO empujar con padding-left) */
@media (min-width: 1024px) {
  .home {
    /* antes: padding-left: 96px; -> esto te descuadraba todo */
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
    background: #e5e7eb;
    border-radius: 16px;
    gap: 12px;
    z-index: 100;
  }
}

.side-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: none;
  background: white;
  font-size: 18px;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: transform 0.2s;
}

.side-icon:hover { transform: scale(1.05); }

/* =========================================
   3. HEADER Y TÍTULO
   ========================================= */
.header {
  text-align: center;
  margin-bottom: .8rem;
  width: 100%;
  padding: 0 16px;
  padding-top: 6px;
}

/* =========================================
   3. HEADER Y TÍTULO
   ========================================= */
.app-logo{
  width: 260px;
  max-width: 78vw;
  height: auto;
  display: block;
  margin: 6px auto 2px;
  filter: drop-shadow(0 16px 30px rgba(0,0,0,0.18));
  transition: transform .2s ease;
}

.app-logo:hover{
  transform: scale(1.02);
}

@media (max-width: 1023px){
  .app-logo{
    width: 210px;
  }
}

/* =========================================
   4. BUSCADOR ULTRA BONITO (GLASS + BORDER GLOW)
   ========================================= */

/* Panel transparente */
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

/* ✅ DESKTOP: fijo al lado del sidebar */
@media (min-width: 1024px) {
  .search-panel {
    position: fixed;
    left: 112px;
    top: 190px;
    transform: translateY(-40px);
    z-index: 1000;
  }
}

/* ✅ MÓVIL: Debajo de los tags y encima de las cards con espacio */
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

.search-field {
  position: relative;
  width: 100%;
  border-radius: 999px;
  background: rgba(255,255,255,0.14);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow:
    0 18px 45px rgba(0,0,0,0.18),
    inset 0 1px 0 rgba(255,255,255,0.25);
  padding: 7px;
  transition: transform .2s ease, box-shadow .2s ease;
}

.search-field::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 999px;
  padding: 2px;
  background: linear-gradient(135deg,
    rgba(99,102,241,0.85),
    rgba(34,197,94,0.65),
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

.search-field::after {
  content: "🔎";
  position: absolute;
  left: 18px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 16px;
  opacity: 0.55;
  pointer-events: none;
}

.search-left-input {
  width: 100%;
  height: 46px;
  padding: 0 52px 0 46px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.18);
  background: rgba(10,10,10,0.06);
  color: rgba(0,0,0,0.75);
  font-size: 0.95rem;
  font-weight: 650;
  outline: none;
  transition: all .2s ease;
}

.search-left-input::placeholder {
  color: rgba(0,0,0,0.38);
  font-weight: 600;
}

.search-field:focus-within {
  transform: translateY(-1px);
  box-shadow:
    0 24px 60px rgba(0,0,0,0.22),
    0 0 0 8px rgba(99,102,241,0.12),
    inset 0 1px 0 rgba(255,255,255,0.28);
}

.search-field:focus-within::before { opacity: 0.95; }

.search-left-input:focus {
  border-color: rgba(99,102,241,0.45);
  background: rgba(255,255,255,0.10);
  color: rgba(0,0,0,0.86);
}

.search-close-inside {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 36px;
  height: 36px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.18);
  background: rgba(0,0,0,0.55);
  color: rgba(255,255,255,0.95);
  display: grid;
  place-items: center;
  cursor: pointer;
  box-shadow:
    0 14px 28px rgba(0,0,0,0.20),
    inset 0 1px 0 rgba(255,255,255,0.18);
  transition: transform .15s ease, background .15s ease, box-shadow .15s ease;
}

.search-close-inside:hover {
  transform: translateY(-50%) scale(1.06);
  background: rgba(0,0,0,0.72);
}

.search-close-inside:active { transform: translateY(-50%) scale(0.96); }

.user-name{
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  font-weight: 700;
}

.user-status{
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  font-weight: 800;
  opacity: .75;
}

.user-status .status-dot{
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: #9ca3af; /* gris */
  box-shadow: 0 0 0 3px rgba(156,163,175,.18);
}

.user-status.online{
  opacity: 1;
}

.user-status.online .status-dot{
  background: #22c55e; /* verde */
  box-shadow: 0 0 0 3px rgba(34,197,94,.18);
}

/* =========================================
   8. MODALES (USUARIOS / STATS)
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
  animation: pop .2s ease-out;
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
  border-radius: 12px;
  background: #f3f4f6;
  cursor: pointer;
  transition: all .2s ease;
  
}

.user-item:hover {
  background: #e5e7eb;
  transform: translateX(4px);
}

.stats-close, .users-close {
  width: 100%;
  padding: 12px;
  border-radius: 999px;
  border: none;
  background: #6366f1;
  color: white;
  font-weight: 600;
  cursor: pointer;
}

/* =========================================
   9. BOTONES MODERNOS CON ANIMACIÓN 🔥
   ========================================= */
.modern-actions {
  display: flex;
  gap: 14px;
  justify-content: center;
  margin-top: 18px;
  perspective: 1000px;
}

.modern-icon-btn, .modern-main-btn, .modern-secondary-btn {
  border: none;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  display: grid;
  place-items: center;
  transition: all 0.3s cubic-bezier(0.23, 1, 0.32, 1);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
}

.modern-icon-btn {
  width: 48px;
  height: 48px;
  border-radius: 16px;
  background: #1a1a1a;
  color: white;
  font-size: 20px;
}

.modern-icon-btn:hover {
  background: #252525;
  transform: translateY(-3px) rotate(-5deg);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
}

.modern-main-btn {
  border-radius: 999px;
  padding: 12px 24px;
  font-weight: 700;
  font-size: 0.95rem;
  background: linear-gradient(135deg, #111 0%, #333 100%);
  color: white;
  letter-spacing: 0.5px;
}

.modern-main-btn:hover {
  transform: translateY(-3px);
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
  filter: brightness(1.2);
}

.modern-secondary-btn {
  background: #111;
  color: white;
  border-radius: 999px;
  padding: 12px 20px;
  font-weight: 600;
  font-size: 0.9rem;
}

.modern-secondary-btn:hover {
  background: #000;
  transform: translateY(-3px);
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
}

.modern-main-btn::after, .modern-secondary-btn::after, .modern-icon-btn::after {
  content: "";
  position: absolute;
  top: -50%;
  left: -110%;
  width: 100%;
  height: 200%;
  background: linear-gradient(
    to right,
    transparent,
    rgba(255, 255, 255, 0.1),
    transparent
  );
  transform: rotate(30deg);
  transition: all 0.6s;
}

.modern-main-btn:hover::after, .modern-secondary-btn:hover::after, .modern-icon-btn:hover::after {
  left: 110%;
}

.modern-icon-btn:active, .modern-main-btn:active, .modern-secondary-btn:active {
  transform: translateY(1px) scale(0.96);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
  transition: all 0.1s;
}

/* =========================================
   10. LOGOUT FAB (✅ SIEMPRE VISIBLE)
   ========================================= */
.logout-fab {
  /* ✅ fuerza visible aunque algún layout cree containing block raro */
  position: fixed !important;
  display: grid !important;
  place-items: center;

  /* ✅ safe area iOS (no molesta desktop) */
  top: calc(50px + env(safe-area-inset-top)) !important;
  right: calc(16px + env(safe-area-inset-right)) !important;

  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: #ef4444;
  color: white;

  box-shadow: 0 8px 20px rgba(239,68,68,.45);

  /* ✅ por encima de TODO */
  z-index: 2147483647 !important;

  opacity: 1 !important;
  visibility: visible !important;
  pointer-events: auto !important;
}

@media (min-width: 1024px) {
  .logout-fab {
    top: calc(20px + env(safe-area-inset-top)) !important;
  }
}

/* =========================================
   CATEGORÍAS
   ========================================= */
.container-categorias.narrow {
  width: 100%;
  max-width: 380px;
  margin: 15px auto;
  overflow: hidden;
}

.slider-track {
  display: flex;
  gap: 15px;
  width: max-content;
  animation: scroll-loop 12s linear infinite;
}

@keyframes scroll-loop {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}

.cat-tag-mini {
  color: #777;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  cursor: pointer;
}

/* =========================================
   DARK MODE
   ========================================= */
:global(.p-dark) .search-field { background: rgba(20,20,22,0.35); }
:global(.p-dark) .search-left-input {
  color: rgba(255,255,255,0.86);
  background: rgba(255,255,255,0.06);
}
:global(.p-dark) .search-left-input::placeholder { color: rgba(255,255,255,0.35); }

.version{
  display: block;
  margin-top: 2px;
  font-size: 0.80rem;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
  opacity: .55;
  color: rgba(0,0,0,.65);
}

/* ============================
   BUSCADOR MÓVIL ULTRA PRO
   (NO TOCO tu media iphone)
   ============================ */
.m-search{
  display: none;
}

@media (max-width: 1023px){
  .m-search{
    display: flex;
    align-items: center;
    gap: 10px;

    width: 100%;
    max-width: 520px;
    height: 54px;

    margin: 0 auto 18px !important;
    padding: 0 12px;

    border-radius: 999px;
    position: relative;

    background: rgba(255,255,255,0.55);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);

    box-shadow:
      0 22px 60px rgba(0,0,0,0.14),
      inset 0 1px 0 rgba(255,255,255,0.70);
  }

  .m-search::before{
    content:"";
    position:absolute;
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

  .m-search__icon{
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

  .m-search__input{
    flex: 1;
    height: 100%;
    border: none;
    outline: none;
    background: transparent;

    font-size: 16px;
    font-weight: 700;
    color: rgba(0,0,0,0.80);
  }

  .m-search__input::placeholder{
    color: rgba(0,0,0,0.42);
    font-weight: 650;
  }

  .m-search__clear{
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

  .m-search__clear:active{
    transform: scale(0.96);
  }

  .m-search:focus-within{
    transform: translateY(-1px);
    box-shadow:
      0 28px 80px rgba(0,0,0,0.18),
      0 0 0 8px rgba(99,102,241,0.10),
      inset 0 1px 0 rgba(255,255,255,0.78);
  }
  .m-search:focus-within::before{ opacity: 0.95; }

  .container-categorias.narrow{
    margin: 14px auto 12px !important;
    padding-bottom: 6px;
  }
}

/* Dark mode perfecto */
:global(.p-dark) .m-search{
  background: rgba(20,20,22,0.55);
  box-shadow:
    0 22px 60px rgba(0,0,0,0.38),
    inset 0 1px 0 rgba(255,255,255,0.08);
}

:global(.p-dark) .m-search__icon{
  background: rgba(255,255,255,0.06);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
  opacity: .85;
}

:global(.p-dark) .m-search__input{
  color: rgba(255,255,255,0.88);
}

:global(.p-dark) .m-search__input::placeholder{
  color: rgba(255,255,255,0.40);
}
/* =====================================
   ✅ MOBILE SIDEBAR (DRAWER PRO)
   ===================================== */

/* Botón flotante ☰ */
.mobile-sidebar-btn{
  display: none;
}

@media (max-width: 1023px){
  .mobile-sidebar-btn{
    display: grid !important;
    place-items: center;

    position: fixed;
    z-index: 999999;

    /* ✅ MÁS ARRIBA + safe area iOS */
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

  .mobile-sidebar-btn:hover{
    transform: translateY(-1px);
    background: rgba(255,255,255,0.28);
  }

  .mobile-sidebar-btn:active{
    transform: scale(.96);
  }
}

/* Overlay fondo */
.mobile-sidebar-overlay{
  position: fixed;
  inset: 0;
  z-index: 999998;

  background: rgba(0,0,0,0.35);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

/* Drawer */
.mobile-sidebar-drawer{
  position: fixed;
  z-index: 999999;

  /* ✅ TODO SUPER CUADRADO Y ALINEADO */
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

/* Contenedor botones vertical PRO */
.mobile-sidebar-actions{
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

/* Botones del menú */
.m-side-item{
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

/* ✅ quitamos el texto */
.m-side-item span{
  display: none;
}

.m-side-item:hover{
  transform: translateY(-1px) scale(1.02);
  background: rgba(255,255,255,0.28);
}

.m-side-item:active{
  transform: scale(.96);
}

/* ✅ Iconos perfectos centrados */
.m-side-item{
  line-height: 1;
}

/* DARK MODE */
:global(.p-dark) .mobile-sidebar-btn{
  color: rgba(255,255,255,0.92);
  background: rgba(30,30,34,0.40);
  border-color: rgba(255,255,255,0.14);
}

:global(.p-dark) .mobile-sidebar-drawer{
  background: rgba(30,30,34,0.55);
  border-color: rgba(255,255,255,0.14);
}

:global(.p-dark) .m-side-item{
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.10);
  color: rgba(255,255,255,0.92);
}

</style>
