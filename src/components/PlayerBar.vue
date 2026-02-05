<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { usePlayer } from '../stores/player'
import { useFavorites } from '../stores/favorites'

/* ======================
   EMITS
====================== */
const emit = defineEmits(['close', 'next', 'go-profile'])

/* ======================
   STORES
====================== */
const player = usePlayer()
const favorites = useFavorites()

// ✅ Username mostrado (si el objeto `song` no trae username, lo buscamos en profiles)
const displayUsername = ref('Usuario')
const displayFtUsername = ref('')

// ✅ Si la portada falla al cargar, mostramos fallback
const coverLoadError = ref(false)
const onCoverError = () => {
  coverLoadError.value = true
}

/* ======================
   STATE
====================== */
const userId = ref(null)
const isSaved = ref(false)

const currentTime = ref(0)
const duration = ref(0)

// ✅ listeners para no depender solo de RAF (arregla duration=NaN y barra que no avanza)
let rafId = null
let boundAudio = null
let audioListeners = null

const toFinite = (n, fallback = 0) => (Number.isFinite(n) ? n : fallback)

const readAudioState = (a) => {
  if (!a) {
    currentTime.value = 0
    duration.value = 0
    return
  }
  currentTime.value = toFinite(a.currentTime, 0)
  duration.value = toFinite(a.duration, 0)
}

const unbindAudioEvents = () => {
  if (!boundAudio || !audioListeners) return
  boundAudio.removeEventListener('loadedmetadata', audioListeners.onMeta)
  boundAudio.removeEventListener('durationchange', audioListeners.onMeta)
  boundAudio.removeEventListener('timeupdate', audioListeners.onTime)
  boundAudio.removeEventListener('seeking', audioListeners.onTime)
  boundAudio.removeEventListener('seeked', audioListeners.onTime)
  boundAudio.removeEventListener('ended', audioListeners.onEnded)
  audioListeners = null
  boundAudio = null
}

const bindAudioEvents = (a) => {
  unbindAudioEvents()
  if (!a) return

  const onMeta = () => readAudioState(a)
  const onTime = () => {
    currentTime.value = toFinite(a.currentTime, 0)
    duration.value = toFinite(a.duration, duration.value || 0)
  }
  const onEnded = () => {
    currentTime.value = 0
    duration.value = toFinite(a.duration, duration.value || 0)
  }

  a.addEventListener('loadedmetadata', onMeta)
  a.addEventListener('durationchange', onMeta)
  a.addEventListener('timeupdate', onTime)
  a.addEventListener('seeking', onTime)
  a.addEventListener('seeked', onTime)
  a.addEventListener('ended', onEnded)

  boundAudio = a
  audioListeners = { onMeta, onTime, onEnded }

  // disparo inicial por si ya tiene metadata
  readAudioState(a)
}

// ✅ UI: plegar/expandir (sin parar la música)
const isCollapsed = ref(false)

// ✅ SHUFFLE (RANDOM)
const isShuffle = ref(true) // por defecto ON
const shuffleQueue = ref([])
const shuffleIndex = ref(0)

// ✅ Cache de audios para que el shuffle funcione aunque el store no tenga playlist
const audiosCache = ref([])
const cacheLoaded = ref(false)

const fetchAudiosCache = async () => {
  if (cacheLoaded.value) return

  try {
    const { data, error } = await supabase.from('audios').select('*').limit(500)
    if (error) throw error

    const normalized = (Array.isArray(data) ? data : [])
      .map((a) => {
        const src =
          a?.url ||
          a?.audio_url ||
          a?.file_url ||
          a?.song_url ||
          a?.public_url ||
          a?.storage_url ||
          a?.path ||
          a?.storage_path ||
          null

        return {
          ...a,
          url: a?.url || src,
          audio_url: a?.audio_url || src
        }
      })
      .filter((a) => a?.id && (a?.url || a?.audio_url))

    audiosCache.value = normalized
    cacheLoaded.value = true
  } catch (e) {
    console.warn('⚠️ No se pudo cargar audiosCache para shuffle:', e)
    audiosCache.value = []
    cacheLoaded.value = false
  }
}

// Intentamos sacar la lista de canciones desde el store (según cómo lo tengas)
const playlist = computed(() => {
  return player.playlist || player.songs || player.queue || player.list || []
})

// ✅ Resolver playlist de forma robusta (para que ⏭ funcione siempre)
const resolvePlaylist = () => {
  const list =
    player.playlist ||
    player.songs ||
    player.queue ||
    player.list ||
    player.audios ||
    player.items ||
    player.filteredAudios ||
    player.homeAudios ||
    []

  const arr = Array.isArray(list) ? list : []

  const normalized = arr
    .map((a) => {
      const src =
        a?.url ||
        a?.audio_url ||
        a?.file_url ||
        a?.song_url ||
        a?.public_url ||
        a?.storage_url ||
        a?.path ||
        a?.storage_path ||
        null

      return {
        ...a,
        url: a?.url || src,
        audio_url: a?.audio_url || src
      }
    })
    .filter((a) => a?.id && (a?.url || a?.audio_url))

  const cacheNormalized = (audiosCache.value || [])
    .map((a) => {
      const src =
        a?.url ||
        a?.audio_url ||
        a?.file_url ||
        a?.song_url ||
        a?.public_url ||
        a?.storage_url ||
        a?.path ||
        a?.storage_path ||
        null

      return {
        ...a,
        url: a?.url || src,
        audio_url: a?.audio_url || src
      }
    })
    .filter((a) => a?.id && (a?.url || a?.audio_url))

  return normalized.length ? normalized : cacheNormalized
}

/* ======================
   AUTH
====================== */
onMounted(async () => {
  const { data } = await supabase.auth.getUser()
  userId.value = data?.user?.id || null

  if (userId.value) {
    await favorites.init(userId.value)
  }

  startTracking()
  loadUsernameIfMissing()
  await syncIsSaved()
  await fetchAudiosCache()

  if (typeof player.setEndedOverride === 'function' && isShuffle.value) {
    player.setEndedOverride(() => {
      try {
        playNextShuffled()
      } catch (e) {
        console.warn('⚠️ Error en auto-next shuffle:', e)
      }
    })
  }
})

onUnmounted(() => {
  if (typeof player.clearEndedOverride === 'function') {
    player.clearEndedOverride()
  }
  if (rafId) cancelAnimationFrame(rafId)
  unbindAudioEvents()
})

/* ======================
   TRACK AUDIO TIME
====================== */
const startTracking = () => {
  // ✅ Bindea eventos al audio actual
  bindAudioEvents(player.audio)

  // ✅ fallback visual: RAF (UI suave)
  const update = () => {
    if (player.audio) {
      if (player.audio !== boundAudio) bindAudioEvents(player.audio)
      readAudioState(player.audio)
    } else {
      readAudioState(null)
    }
    rafId = requestAnimationFrame(update)
  }
  update()
}

/* ======================
   COMPUTED
====================== */
const song = computed(() =>
  player.currentSong ||
  player.current ||
  player.song ||
  player.nowPlaying ||
  player.current_track ||
  player.track ||
  null
)

const playing = computed(() =>
  player.isPlaying ?? player.playing ?? player.is_playing ?? false
)

const progress = computed(() => toFinite(currentTime.value, 0))
const total = computed(() => toFinite(duration.value, 0))

// ✅ Soporta distintos nombres de campos para título/cover
const displayTitle = computed(() =>
  song.value?.title ||
  song.value?.track_title ||
  song.value?.name ||
  song.value?.filename ||
  'Sin título'
)

const coverUrl = computed(() => {
  const s = song.value
  if (!s) return null

  const raw =
    s.image_url ||
    s.cover_url ||
    s.cover ||
    s.image ||
    s.artwork_url ||
    s.artwork ||
    s.cover_image ||
    s.coverImage ||
    s.image_path ||
    s.cover_path ||
    s.artwork_path ||
    s.thumbnail_url ||
    s.thumb_url ||
    s.thumbnail ||
    s.picture_url ||
    s.photo_url ||
    s.img_url ||
    s.img ||
    null

  if (!raw) return null

  const v = String(raw).trim()
  if (!v) return null

  // Ya es una URL utilizable
  if (
    v.startsWith('http://') ||
    v.startsWith('https://') ||
    v.startsWith('data:') ||
    v.startsWith('blob:')
  ) {
    return v
  }

  // Helpers
  const base =
    (supabase && supabase.supabaseUrl) ||
    import.meta.env.VITE_SUPABASE_URL ||
    ''

  const buildPublicUrl = (bucket, objectPath) => {
    if (!base || !bucket || !objectPath) return null
    const cleanObj = String(objectPath).replace(/^\//, '')
    return `${base}/storage/v1/object/public/${bucket}/${cleanObj}`
  }

  // owner id por si el path es audio-images/<user>/<file>
  const ownerId =
    s.user_id ||
    s.userId ||
    s.profile_id ||
    s.owner_id ||
    null

  // Si viene en formato "bucket:path" (ej: "audio-images:abc.jpg")
  if (v.includes(':') && !v.startsWith('http')) {
    const [bucket, ...rest] = v.split(':')
    const obj = rest.join(':')
    const u = buildPublicUrl(bucket, obj)
    if (u) return u
  }

  // Si viene con "/" puede ser:
  // - bucket/obj (ej: audio-images/user/file.png)
  // - objPath con carpetas (ej: userId/file.png) => NO confundir el userId con bucket
  if (v.includes('/')) {
    const parts = v.replace(/^\//, '').split('/')
    const first = parts[0]
    const rest = parts.slice(1).join('/')

    const knownBuckets = [
      'audio-images',
      'avatars',
      'videos',
      'music-bucket',
      'covers',
      'images',
      'artwork',
      'thumbnails',
      'audio-covers',
      'audio_covers'
    ]

    // ✅ Caso bucket/obj
    if (knownBuckets.includes(first) && rest) {
      const u = buildPublicUrl(first, rest)
      if (u) return u
    }

    // ✅ Caso objPath (ej: userId/file.png)
    // Preferimos audio-images como bucket por defecto
    const uObj = buildPublicUrl('audio-images', parts.join('/'))
    if (uObj) return uObj
  }

  // ✅ Si solo guardas el filename (ej: "abc.jpg"):
  // 1) probamos audio-images/<user>/<file> (muy típico)
  if (ownerId) {
    const u1 = buildPublicUrl('audio-images', `${ownerId}/${v}`)
    if (u1) return u1
  }

  // 2) probamos buckets comunes (incluyendo audio-images)
  const commonBuckets = [
    'audio-images',
    'covers',
    'images',
    'artwork',
    'thumbnails',
    'audio-covers',
    'audio_covers'
  ]

  for (const b of commonBuckets) {
    const u = buildPublicUrl(b, v)
    if (u) return u
  }

  // Último fallback: devolver tal cual
  return v
})

/* ======================
   ✅ USERNAME FIX
====================== */
const loadUsernameIfMissing = async () => {
  const s = song.value
  if (!s) {
    displayUsername.value = 'Usuario'
    displayFtUsername.value = ''
    return
  }

  const direct =
    s.username ||
    s.profiles?.username ||
    s.profile?.username ||
    s.user?.username

  const ftDirect =
    s.ft_username ||
    s.feat_username ||
    s.featured_username ||
    s.ft?.username ||
    s.feat?.username ||
    s.featured?.username ||
    s.ft_profile?.username ||
    s.feat_profile?.username

  if (direct) {
    displayUsername.value = direct
  } else {
    const uid = s.user_id || s.userId || s.profile_id || s.owner_id
    if (!uid) {
      displayUsername.value = 'Usuario'
    } else {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', uid)
          .single()
        if (error) throw error
        displayUsername.value = data?.username || 'Usuario'
      } catch (e) {
        console.warn('⚠️ No se pudo cargar username del perfil:', e)
        displayUsername.value = 'Usuario'
      }
    }
  }

  if (ftDirect) {
    displayFtUsername.value = String(ftDirect).trim()
    return
  }

  const ftUid =
    s.feat_user_id ||
    s.ft_user_id ||
    s.feature_user_id ||
    s.featured_user_id ||
    s.featUserId ||
    s.ftUserId

  if (!ftUid) {
    displayFtUsername.value = ''
    return
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', ftUid)
      .single()
    if (error) throw error
    displayFtUsername.value = (data?.username || '').trim()
  } catch (e) {
    console.warn('⚠️ No se pudo cargar username del ft:', e)
    displayFtUsername.value = ''
  }
}

/* ======================
   ✅ FAVORITES SYNC
====================== */
const syncIsSaved = async () => {
  if (!userId.value || !song.value?.id) {
    isSaved.value = false
    return
  }
  try {
    isSaved.value = favorites.isFav(song.value.id)
  } catch (e) {
    console.warn('⚠️ No se pudo sincronizar favoritos:', e)
    isSaved.value = false
  }
}

/* ======================
   SHUFFLE HELPERS
====================== */
const shuffleArray = (arr) => {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

const initShuffleQueue = (audios, currentId) => {
  if (!Array.isArray(audios) || audios.length === 0) {
    shuffleQueue.value = []
    shuffleIndex.value = 0
    return
  }

  shuffleQueue.value = shuffleArray(audios)

  if (currentId) {
    const idx = shuffleQueue.value.findIndex((a) => a?.id === currentId)
    if (idx > 0) {
      const current = shuffleQueue.value.splice(idx, 1)[0]
      shuffleQueue.value.unshift(current)
    }
  }

  shuffleIndex.value = 0
}

const playNextShuffled = async () => {
  if (!cacheLoaded.value) {
    await fetchAudiosCache()
  }

  const audios = resolvePlaylist()

  if (!audios || audios.length === 0) {
    if (typeof player.nextSong === 'function') return player.nextSong()
    if (typeof player.next === 'function') return player.next()
    if (typeof player.playNext === 'function') return player.playNext()
    return
  }

  if (shuffleQueue.value.length === 0) {
    initShuffleQueue(audios, song.value?.id)
  }

  shuffleIndex.value += 1

  if (shuffleIndex.value >= shuffleQueue.value.length) {
    initShuffleQueue(audios, song.value?.id)
    shuffleIndex.value = 1
  }

  let nextAudio = shuffleQueue.value[shuffleIndex.value]

  if (!nextAudio) {
    const currentId = song.value?.id
    const pool = audios.filter((a) => a?.id && a.id !== currentId)
    if (pool.length) {
      nextAudio = pool[Math.floor(Math.random() * pool.length)]
    }
  }

  if (!nextAudio) {
    if (typeof player.nextSong === 'function') return player.nextSong()
    if (typeof player.next === 'function') return player.next()
    if (typeof player.playNext === 'function') return player.playNext()
    return
  }

  player.playSong(nextAudio)
}

const handleNext = async () => {
  if (isShuffle.value) {
    await playNextShuffled()
    return
  }
  if (typeof player.nextSong === 'function') return player.nextSong()
  if (typeof player.next === 'function') return player.next()
  if (typeof player.playNext === 'function') return player.playNext()
  emit('next')
}

const toggleShuffle = async () => {
  isShuffle.value = !isShuffle.value

  if (isShuffle.value) {
    if (!cacheLoaded.value) await fetchAudiosCache()
    initShuffleQueue(resolvePlaylist(), song.value?.id)

    if (typeof player.setEndedOverride === 'function') {
      player.setEndedOverride(() => {
        try {
          playNextShuffled()
        } catch (e) {
          console.warn('⚠️ Error en auto-next shuffle:', e)
        }
      })
    }
  } else {
    if (typeof player.clearEndedOverride === 'function') {
      player.clearEndedOverride()
    }
  }
}

watch(
  () => [song.value?.id, playlist.value?.length],
  () => {
    coverLoadError.value = false
    if (isShuffle.value) initShuffleQueue(resolvePlaylist(), song.value?.id)
    loadUsernameIfMissing()
    syncIsSaved()
  }
)

// ✅ Si el store reemplaza la instancia de Audio, re-enganchamos listeners
watch(
  () => player.audio,
  (a) => {
    bindAudioEvents(a)
    readAudioState(a)
  }
)

/* ======================
   TIME FORMAT
====================== */
const formatTime = (sec) => {
  const s = Number(sec)
  if (!Number.isFinite(s) || s < 0) return '00:00'
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

/* ======================
   CONTROLS
====================== */
const toggle = () => {
  if (!player.audio) {
    if (song.value) player.playSong(song.value)
    return
  }
  player.isPlaying ? player.pauseSong() : player.resumeSong()
}

const seek = (e) => {
  const v = Number(e?.target?.value)
  if (player.audio && Number.isFinite(v)) {
    player.audio.currentTime = v
    currentTime.value = v
  }
}

/* ======================
   SAVE
====================== */
const toggleSave = async () => {
  const audioId = song.value?.id
  if (!audioId) return

  const uid = userId.value
  if (!uid) {
    isSaved.value = false
    return
  }

  const next = !isSaved.value
  isSaved.value = next

  try {
    if (favorites.userId !== uid) {
      await favorites.init(uid)
    }
    await favorites.toggle(audioId)
    isSaved.value = favorites.isFav(audioId)
  } catch (e) {
    console.warn('⚠️ No se pudo actualizar favorito:', e)
    isSaved.value = !next
  }
}

// ✅ PLEGAR / EXPANDIR
const collapsePlayer = () => {
  isCollapsed.value = true
}
const expandPlayer = () => {
  isCollapsed.value = false
}

// ✅ Ir al perfil del usuario que subió la canción
const goProfile = () => {
  const id =
    song.value?.user_id ||
    song.value?.userId ||
    song.value?.profile_id ||
    song.value?.owner_id

  if (!id) {
    console.warn('⚠️ No se encontró user_id en la canción:', song.value)
    return
  }

  emit('go-profile', id)
}

// ✅ Cerrar player (móvil): pausa y avisa al padre
const closePlayer = () => {
  try {
    if (typeof player.stopSong === 'function') player.stopSong()
    else if (typeof player.pauseSong === 'function') player.pauseSong()
    else if (player.audio) player.audio.pause()
  } catch (e) {
    console.warn('⚠️ No se pudo pausar al cerrar:', e)
  }

  isCollapsed.value = false
  emit('close')
}
</script>

<template>
  <!-- ✅ MINI PLAYER (PLEGADO) -->
  <div v-if="song && isCollapsed" class="player-mini" :class="{ playing }">
    <button class="mini-expand" @click="expandPlayer" title="Abrir">
      ⌃
    </button>

    <div class="mini-info" @click="expandPlayer">
      <div class="mini-title">{{ displayTitle }}</div>
      <button
        class="mini-sub mini-user-btn"
        @click.stop="goProfile"
        title="Ver perfil"
      >
        {{ displayFtUsername ? `${displayUsername} ft ${displayFtUsername}` : displayUsername }}
      </button>
    </div>

    <button class="mini-play" @click.stop="toggle" title="Play/Pause">
      {{ playing ? '⏸' : '▶' }}
    </button>

    <button class="mini-close" @click.stop="closePlayer" title="Cerrar">
      ✕
    </button>
  </div>

  <!-- ✅ PLAYER GRANDE -->
  <div v-else-if="song" class="player" :class="{ playing }">
    <!-- COVER + NOTAS -->
    <div class="cover-wrapper" data-playerbar-build="2026-02-05">
      <img
        v-if="coverUrl && !coverLoadError"
        :src="coverUrl"
        class="cover"
        alt="cover"
        @error="onCoverError"
      />
      <div v-else class="cover cover--fallback" aria-label="sin cover">🎧</div>

      <div v-if="playing" class="music-notes">
        <span class="note">🎵</span>
        <span class="note">🎶</span>
        <span class="note">🎵</span>
        <span class="note">🎶</span>
      </div>
    </div>

    <!-- ✅ BOTONES ARRIBA A LA DERECHA (LADO A LADO) -->
    <div class="header-buttons">
      <button
        class="header-btn collapse-btn"
        @click="collapsePlayer"
        title="Minimizar"
        aria-label="Minimizar reproductor"
      >
        ⌄
      </button>
      <button
        class="header-btn close-btn"
        @click="closePlayer"
        title="Cerrar"
        aria-label="Cerrar reproductor"
      >
        ✕
      </button>
    </div>

    <!-- HEADER -->
    <div class="header">
      <div class="title-wrapper">
        <strong class="title">
          <span>{{ displayTitle }}</span>
        </strong>
      </div>

      <button
        class="username-btn"
        @click="goProfile"
        title="Ver perfil"
      >
        {{ displayFtUsername ? `${displayUsername} ft ${displayFtUsername}` : displayUsername }}
      </button>
    </div>

    <!-- PROGRESS -->
    <input
      class="range"
      type="range"
      min="0"
      :max="Math.max(total || 0, 1)"
      :value="progress"
      step="0.01"
      @input="seek"
    />

    <!-- TIME -->
    <div class="time">
      <span>{{ formatTime(progress) }}</span>
      <span>{{ formatTime(total) }}</span>
    </div>

    <!-- CONTROLS -->
    <div class="controls">
      <button class="shuffle" :class="{ active: isShuffle }" @click="toggleShuffle" title="Shuffle">
        🔀
      </button>

      <button class="play" @click="toggle">
        {{ playing ? '⏸' : '▶' }}
      </button>

      <button class="next" @click="handleNext">⏭</button>

      <button
        class="save"
        :class="{ active: isSaved }"
        @click="toggleSave"
      >
        ❤️
      </button>
    </div>
  </div>
</template>

<style scoped>
/* =========================
   PLAYER (CENTRADO REAL)
========================= */
.player {
  position: fixed;
  bottom: calc(16px + env(safe-area-inset-bottom));
  left: 50%;
  transform: translateX(-50%);
  width: calc(100% - 20px);
  max-width: 420px;

  background: linear-gradient(
    180deg,
    rgba(20,20,20,.98),
    rgba(10,10,10,.98)
  );

  color: white;
  padding: 16px;
  border-radius: 26px;

  /* MUY IMPORTANTE para que no se esconda */
  z-index: 999999;

  display: flex;
  flex-direction: column;
  gap: 12px;

  box-shadow:
    0 12px 36px rgba(0,0,0,.6),
    inset 0 1px 0 rgba(255,255,255,.05);

  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

/* =========================
   ✅ MINI PLAYER (PLEGADO)
========================= */
.player-mini {
  position: fixed;
  bottom: calc(16px + env(safe-area-inset-bottom));
  left: 50%;
  transform: translateX(-50%);
  width: calc(100% - 20px);
  max-width: 420px;

  z-index: 999999;

  display: flex;
  align-items: center;
  gap: 10px;

  padding: 12px 12px;
  border-radius: 22px;

  background: rgba(15, 15, 15, 0.92);
  border: 1px solid rgba(255,255,255,0.08);

  box-shadow: 0 16px 45px rgba(0,0,0,0.55);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);

  transition: bottom 0.25s ease;
}

.mini-expand {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.10);
  cursor: pointer;
  font-size: 1.15rem;
  font-weight: 900;
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.95);
  display: grid;
  place-items: center;
}

.mini-expand:active {
  transform: scale(0.94);
}

.mini-info {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.mini-title {
  font-weight: 900;
  font-size: 0.9rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mini-sub {
  margin-top: 2px;
  font-size: 0.75rem;
  opacity: 0.65;
  font-weight: 800;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mini-user-btn {
  background: none;
  border: none;
  padding: 0;
  text-align: left;
  color: rgba(255,255,255,.6);
  cursor: pointer;
}

.mini-user-btn:hover {
  text-decoration: underline;
  color: rgba(255,255,255,.85);
}

.mini-play {
  width: 44px;
  height: 44px;
  border-radius: 999px;
  border: none;
  cursor: pointer;
  font-size: 1.1rem;
  background: radial-gradient(circle at top, #22c55e, #16a34a);
  color: white;
}

.mini-play:active {
  transform: scale(0.94);
}

.mini-close {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.10);
  cursor: pointer;
  font-size: 1.1rem;
  font-weight: 900;
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.95);
  display: grid;
  place-items: center;
}

.mini-close:hover {
  background: rgba(239, 68, 68, 0.18);
  border-color: rgba(239, 68, 68, 0.28);
}

.mini-close:active {
  transform: scale(0.94);
}

/* 🖥️ Desktop: NO tocar centrado */
@media (min-width: 1024px) {
  .player {
    left: 50%;
    transform: translateX(-50%);
    margin-left: 0;
  }
}

/* =========================
   COVER
========================= */
.cover-wrapper {
  position: absolute;
  top: -29px;
  left: 16px;
  width: 56px;
  height: 58px;
}

.cover {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  object-fit: cover;
  background: #111;
  box-shadow: 0 8px 24px rgba(0,0,0,.6);
}
.cover--fallback {
  display: grid;
  place-items: center;
  font-size: 18px;
  color: rgba(255,255,255,.85);
  background: radial-gradient(circle at 30% 20%, rgba(34,197,94,.25), rgba(17,17,17,1));
  border: 1px solid rgba(255,255,255,0.10);
}

.player.playing .cover {
  animation: cover-beat 1.8s infinite ease-in-out;
}

@keyframes cover-beat {
  0% { transform: scale(1); }
  40% { transform: scale(1.12); }
  100% { transform: scale(1); }
}

/* =========================
   NOTAS 🎵
========================= */
.music-notes {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.note {
  position: absolute;
  bottom: 6px;
  font-size: 14px;
  color: #fff;

  text-shadow:
    0 0 6px rgba(255,255,255,.6),
    0 0 14px rgba(255,255,255,.35),
    0 0 24px rgba(255,255,255,.15);

  opacity: 0;
  animation: floatNote 2.4s infinite ease-in-out;
}

.note:nth-child(1) { left: 5%; }
.note:nth-child(2) { left: 30%; animation-delay: .6s; }
.note:nth-child(3) { left: 55%; animation-delay: 1.2s; }
.note:nth-child(4) { left: 75%; animation-delay: 1.8s; }

@keyframes floatNote {
  0% { transform: translateY(0) scale(.7); opacity: 0; }
  20% { opacity: .9; }
  100% { transform: translateY(-42px) scale(1.2); opacity: 0; }
}

/* =========================
   ✅ BOTONES HEADER (LADO A LADO)
========================= */
.header-buttons {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  gap: 8px;
  z-index: 10002;
}

.header-btn {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: rgba(255, 255, 255, 0.9);
  font-size: 1.1rem;
  font-weight: 900;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: transform 0.15s ease, background 0.2s ease;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

.header-btn:active {
  transform: scale(0.92);
}

.collapse-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}

.close-btn:hover {
  background: rgba(239, 68, 68, 0.25);
  border-color: rgba(239, 68, 68, 0.4);
}

/* ✅ En móvil, botones más grandes para mejor tap */
@media (max-width: 520px) {
  .header-buttons {
    top: 10px;
    right: 10px;
    gap: 6px;
  }

  .header-btn {
    width: 44px;
    height: 44px;
    border-radius: 14px;
    font-size: 1.2rem;
  }
}

/* ✅ En desktop, ocultamos los botones de cerrar/minimizar */
@media (min-width: 1024px) {
  .header-buttons {
    display: none;
  }
}

/* =========================
   HEADER - ✅ CENTRADO REAL
========================= */
.header {
  position: relative;
  margin-top: 12px;
  z-index: 2;
  padding-top: 2px;
  
  /* ✅ Centramos con flexbox */
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.title-wrapper,
.title,
.title span {
  pointer-events: none;
}

.title {
  font-weight: 700;
  font-size: .95rem;
  max-width: 100%;
}

.title-wrapper {
  width: 100%;
  max-width: calc(100% - 110px); /* ✅ Espacio para botones en móvil */
  overflow: hidden;
  white-space: nowrap;
  position: relative;
  mask-image: linear-gradient(90deg, transparent, black 5%, black 95%, transparent);
  -webkit-mask-image: linear-gradient(90deg, transparent, black 5%, black 95%, transparent);
}

@media (min-width: 1024px) {
  .title-wrapper {
    max-width: 100%; /* ✅ Sin botones en desktop, usa todo el ancho */
  }
}

/* ✅ MARQUEE CLÁSICO: visible y se mueve en loop */
.title span {
  display: inline-block;
  padding-left: 100%;
  padding-right: 50px;
  animation: marquee 12s linear infinite;
}

.player:not(.playing) .title span {
  animation-play-state: paused;
}

@keyframes marquee {
  0% { transform: translateX(0); }
  100% { transform: translateX(-100%); }
}

/* ✅ USERNAME CENTRADO */
.username-btn {
  margin-top: 4px;
  background: none;
  border: none;
  color: rgba(255,255,255,.6);
  font-size: .75rem;
  cursor: pointer;
  pointer-events: auto;
  /* ✅ Centrado automático por el flexbox del padre */
}

.username-btn:hover {
  color: rgba(255,255,255,.85);
  text-decoration: underline;
}

/* =========================
   🎚️ PROGRESS — GLASS REAL
========================= */
.range {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  background: transparent;
}

.range::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: rgba(255,255,255,.18);
  backdrop-filter: blur(6px);
}

.range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 22px;
  height: 22px;
  margin-top: -9px;

  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.35);

  background: rgba(255,255,255,.35);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);

  box-shadow:
    inset 0 0 6px rgba(255,255,255,.6),
    0 6px 16px rgba(0,0,0,.35),
    0 0 18px rgba(255,255,255,.45);

  cursor: pointer;
  transition: transform .15s ease;
}

.range::-webkit-slider-thumb:active {
  transform: scale(1.15);
}

/* =========================
   TIME
========================= */
.time {
  display: flex;
  justify-content: space-between;
  font-size: .72rem;
  color: rgba(255,255,255,.55);
}

/* =========================
   CONTROLS
========================= */
.controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.shuffle {
  width: 44px;
  height: 44px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.14);
  background: rgba(255,255,255,.06);
  color: rgba(255,255,255,.8);
  cursor: pointer;
  font-size: 1.1rem;
  display: grid;
  place-items: center;
  transition: transform .15s ease, background .2s ease, opacity .2s ease;
  opacity: .7;
}

.shuffle:active {
  transform: scale(.94);
}

.shuffle.active {
  opacity: 1;
  background: rgba(34,197,94,.20);
  border-color: rgba(34,197,94,.45);
}

.play,
.next {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: radial-gradient(circle at top, #22c55e, #16a34a);
  border: none;
  font-size: 1.4rem;
  cursor: pointer;
  color: white;
}

.play:active,
.next:active {
  transform: scale(0.95);
}

.save {
  font-size: 1.6rem;
  background: none;
  border: none;
  opacity: .35;
  cursor: pointer;
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.save:active {
  transform: scale(0.9);
}

.save.active {
  opacity: 1;
  color: #ef4444;
  transform: scale(1.15);
}

/* =========================
   ✅ FIX: NO PISAR COMENTARIOS
========================= */
:global(.cmt-overlay) ~ .player-mini {
  bottom: calc(16px + env(safe-area-inset-bottom) + 190px) !important;
}

:global(.cmt-overlay) ~ .player {
  bottom: calc(16px + env(safe-area-inset-bottom) + 190px) !important;
}

@media (max-width: 520px) {
  :global(.cmt-overlay) ~ .player-mini {
    bottom: calc(16px + env(safe-area-inset-bottom) + 165px) !important;
  }

  :global(.cmt-overlay) ~ .player {
    bottom: calc(16px + env(safe-area-inset-bottom) + 165px) !important;
  }
}
</style>