<script setup>
import PlayerBar from '../components/PlayerBar.vue'
import { ref, onMounted, watch, computed, onUnmounted } from 'vue'
import { supabase } from '../lib/supabase'
import { useRouter } from 'vue-router'
import { usePlayer } from '../stores/player'

import UploadButton from '../components/UploadButton.vue'
import Playlist from '../components/Playlist.vue'
import CompleteProfileModal from '../components/CompleteProfileModal.vue'

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
const showListened = ref(false) // 🎧 NUEVO
const userId = ref(null)

const currentSong = ref(null)
const songs = ref([])
const playlistKey = ref(0)
const search = ref('')

/* ======================
   STATS
====================== */
const playCounts = ref({})
const globalPlayCounts = ref({})
let statsChannel = null

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

// 🎧 canciones distintas escuchadas
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
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    router.push('/')
    return
  }

  userId.value = session.user.id
  await player.initUser()
  player.onEnded(() => playNext())

  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', userId.value)
    .single()

  showProfileModal.value = !profile?.username

  await loadStats()
  await loadGlobalStats()

  statsChannel = supabase
    .channel('stats-realtime')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'listening_history' },
      payload => {
        const songId = payload.new.song_id
        playCounts.value[songId] = (playCounts.value[songId] || 0) + 1
        globalPlayCounts.value[songId] = (globalPlayCounts.value[songId] || 0) + 1
      }
    )
    .subscribe()
})

onUnmounted(() => {
  if (statsChannel) supabase.removeChannel(statsChannel)
})

watch(() => player.currentSong, song => currentSong.value = song)

/* ======================
   NAV
====================== */
const goToNotifications = () => router.push('/notifications')
const goToProfile = () => router.push('/profile/' + userId.value)

const logout = async () => {
  player.stopSong()
  await supabase.auth.signOut()
  router.push('/')
}

/* ======================
   PLAYER
====================== */
const onUploaded = () => playlistKey.value++
const playSong = song => player.playSong(song)

const playNext = () => {
  if (!player.currentSong || !songs.value.length) return
  const index = songs.value.findIndex(s => s.id === player.currentSong.id)
  if (index === -1) return
  player.playSong(songs.value[(index + 1) % songs.value.length])
}
</script>

<template>
  <section class="home">
    <!-- SIDEBAR -->
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
        :class="{ 'trending-active': topGlobalSong }"
        style="margin-top:10px"
        @click="showTrending = true"
        title="Tendencias"
      >
        🔥
      </button>
    </div>

    <!-- SEARCH -->
    <div v-if="showSearch" class="search-panel">
      <input
        v-model="search"
        class="search-left-input"
        placeholder="Buscar canción..."
        autofocus
      />
      <button class="search-close" @click="showSearch = false">✕</button>
    </div>

    <!-- STATS MODAL -->
    <div v-if="showStats" class="stats-modal" @click.self="showStats = false">
      <div class="stats-box">
        <h3 class="stats-title">📊 Estadísticas</h3>

        <div class="stats-row">
          🎵 Canciones <strong>{{ mySongs.length }}</strong>
        </div>

        <div class="stats-row">
          ▶ Reproducciones <strong>{{ totalPlays }}</strong>
        </div>

        <div v-if="topSong" class="stats-top">
          🏆 {{ topSong.title }} ({{ topSong.plays }})
        </div>

        <button class="stats-close" @click="showStats = false">
          Cerrar
        </button>
      </div>
    </div>

    <!-- 🎧 LISTENED MODAL -->
    <div v-if="showListened" class="stats-modal" @click.self="showListened = false">
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
    <div v-if="showTrending" class="stats-modal" @click.self="showTrending = false">
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

    <!-- LOGOUT -->
    <button class="logout-fab" @click="logout">⏻</button>

    <!-- HEADER -->
    <header class="header">
      <h1 class="title">🎵 Music App</h1>
      <span class="version">v{{ appVersion }}</span>

      <div class="actions">
        <button class="icon-btn" @click="goToNotifications">🔔</button>
        <UploadButton @uploaded="onUploaded" />
        <button class="profile-btn" @click="goToProfile">👤 Mi perfil</button>
      </div>
    </header>

    <!-- PLAYLIST -->
    <Playlist
      :key="playlistKey"
      :search="search"
      @play="playSong"
      @songs-loaded="songs = $event"
    />

    <CompleteProfileModal
      v-if="showProfileModal"
      :userId="userId"
      @close="showProfileModal = false"
    />

    <PlayerBar v-if="player.currentSong" @next="playNext" />
  </section>
</template>



<style scoped>
/* ======================
   LAYOUT PRINCIPAL
====================== */
.home {
  max-width: 720px;
  margin: 0 auto;
  padding: 1.5rem 1rem 7.5rem;
}

/* ======================
   SIDEBAR
====================== */
.side-card {
  display: none;
}

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
  }

  .home {
    padding-left: 96px;
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
}

/* ======================
   HEADER
====================== */
.header {
  text-align: center;
  margin-bottom: 1.5rem;
}

.title {
  font-size: 1.6rem;
  font-weight: 700;
}

.version {
  display: block;
  font-size: 0.75rem;
  opacity: 0.6;
  margin-top: 4px;
}

/* ======================
   ACTIONS (BOTONES)
====================== */
.actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-top: 12px;
}

/* 🔔 BOTÓN NOTIFICACIONES (SIN PUNTO ROJO) */
.icon-btn {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: none;
  background: #111;
  color: white;
  font-size: 18px;
  cursor: pointer;

  display: grid;
  place-items: center;

  box-shadow: 0 6px 16px rgba(0,0,0,.25);
  transition: transform .15s ease, box-shadow .15s ease;
}

.icon-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 24px rgba(0,0,0,.35);
}

/* ❌ IMPORTANTE: NO HAY ::after NI BADGE */
/* (el punto rojo queda ELIMINADO al 100%) */

/* ======================
   BOTÓN PERFIL
====================== */
.profile-btn {
  background: #ede9fe;
  border-radius: 12px;
  padding: 10px 14px;
  border: none;
  font-weight: 500;
  cursor: pointer;
}

/* ======================
   SEARCH PANEL
====================== */
.search-panel {
  position: fixed;
  left: 96px;
  top: 100px;
  display: flex;
  gap: 8px;
  z-index: 9999;
}

.search-left-input {
  width: 260px;
  padding: 10px 14px;
  border-radius: 999px;
  border: none;
  background: white;
  box-shadow: 0 4px 12px rgba(0,0,0,.15);
}

.search-close {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: white;
}

/* ======================
   MODAL ESTADÍSTICAS
====================== */
.stats-modal {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.55);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.stats-box {
  background: white;
  border-radius: 22px;
  padding: 26px;
  width: 320px;
  text-align: center;
  color: #111;
}

.stats-title,
.stats-box p {
  color: #111;
}

.stats-close {
  margin-top: 18px;
  width: 100%;
  padding: 12px;
  border-radius: 999px;
  border: none;
  background: #6366f1;
  color: white;
  font-weight: 600;
  cursor: pointer;
}

/* ======================
   LOGOUT
====================== */
.logout-fab {
  position: fixed;
  top: 16px;
  right: 16px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: #ef4444;
  color: white;
  font-size: 18px;
  cursor: pointer;

  display: grid;
  place-items: center;

  box-shadow: 0 8px 20px rgba(239,68,68,.45);
}

</style>