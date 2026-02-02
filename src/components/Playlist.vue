<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick, computed } from 'vue'
import { supabase } from '../lib/supabase'

// ✅ Capacitor (iOS nativo)
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'

// ✅ Share Sheet para "Guardar en Archivos"
import { Share } from '@capacitor/share'

// ✅ OFFLINE IMPORTS
import { getOfflineTrack, deleteOfflineTrack } from '../offline/db'
import { downloadTrack } from '../offline/download'
import { exportOfflineTrackFile } from '../offline/export'

/* ======================
   PROPS / EMITS
====================== */
const props = defineProps({
  search: { type: String, default: '' }
})

const emit = defineEmits(['play', 'songs-loaded'])

/* ======================
   SESSION (ANTI RECARGA)
====================== */
const SESSION_KEY = 'played_songs_session'
const playedThisSession = new Set(
  JSON.parse(sessionStorage.getItem(SESSION_KEY) || '[]')
)

const isPlayLocked = ref(false)

/* ======================
   STATE
====================== */
const songs = ref([])
const loading = ref(true)
const currentUserId = ref(null)
const playCounts = ref({})
const songRefs = ref({})
const hiddenSongs = ref(new Set())

let channel = null
const lastPlayedId = ref(null)

const rejectingId = ref(null)
const searchHitId = ref(null)
const expandedVideoId = ref(null)
const videoElsById = ref({})

/* ======================
   ✅ OFFLINE STATE (POR CANCIÓN)
====================== */

/* ======================
   ✅ OFFLINE STATE (POR CANCIÓN)
====================== */
const offlineById = ref({})
const downloadingById = ref({})

const refreshOfflineFlags = async (list) => {
  const entries = await Promise.all(
    (list || []).map(async (s) => {
      const local = await getOfflineTrack(s.id)
      return [s.id, !!local]
    })
  )
  offlineById.value = Object.fromEntries(entries)
}

const iconClassFor = (songId) => {
  if (downloadingById.value[songId]) return 'pi-spin pi-spinner'
  if (offlineById.value[songId]) return 'pi-check'
  return 'pi-download'
}

/* ======================
   ✅ crear carpeta al arrancar (y forzar que exista)
====================== */
const ensureIosDownloadsFolder = async () => {
  try {
    const platform = Capacitor.getPlatform?.() || 'web'
    const isIOS = platform === 'ios'
    const isNative = Capacitor.isNativePlatform?.() === true
    if (!isIOS || !isNative) return

    await Filesystem.mkdir({
      path: 'MusicApp',
      directory: Directory.Documents,
      recursive: true
    }).catch(() => {})

    await Filesystem.writeFile({
      path: 'MusicApp/.keep',
      data: 'ok',
      directory: Directory.Documents
    }).catch(() => {})
  } catch (e) {
    console.log('❌ ensureIosDownloadsFolder error:', e)
  }
}

/* ======================
   ✅ Share Sheet: guardar en Archivos (Descargas)
====================== */
const exportToFilesIOS = async ({ filename, uri }) => {
  try {
    const platform = Capacitor.getPlatform?.() || 'web'
    const isIOS = platform === 'ios'
    const isNative = Capacitor.isNativePlatform?.() === true
    if (!isIOS || !isNative) return
    if (!uri) return

    await Share.share({
      title: filename || 'audio.mp3',
      url: uri,
      dialogTitle: 'Guardar en Archivos'
    })
  } catch (e) {
    console.log('❌ exportToFilesIOS error:', e)
  }
}

/* ======================
   ✅ HELPERS (Blob -> Base64)
====================== */
const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const res = String(reader.result || '')
      const base64 = res.includes(',') ? res.split(',')[1] : res
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })

/* ======================
   ✅ DOWNLOAD TOGGLE (iOS nativo)
====================== */
const toggleDownload = async (song) => {
  try {
    if (!song?.id || !song?.audio_url) return

    if (offlineById.value[song.id]) {
      await deleteOfflineTrack(song.id)
      offlineById.value = { ...offlineById.value, [song.id]: false }
      return
    }

    downloadingById.value = { ...downloadingById.value, [song.id]: true }

    const platform = Capacitor.getPlatform?.() || 'web'
    const isIOS = platform === 'ios'
    const isNative = Capacitor.isNativePlatform?.() === true

    const rawTitle = String(song.title || 'audio')
    const safeBase = rawTitle
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)

    const filename = `${safeBase || 'audio'}.mp3`

    const response = await fetch(song.audio_url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const blob = await response.blob()

    await downloadTrack({
      id: song.id,
      title: song.title || 'Canción',
      artist: song.username || 'Usuario',
      audioUrl: song.audio_url,
      blob
    })

    if (isIOS && isNative) {
      await ensureIosDownloadsFolder()

      const base64 = await blobToBase64(blob)
      const savePath = `MusicApp/${filename}`

      const res = await Filesystem.writeFile({
        path: savePath,
        data: base64,
        directory: Directory.Documents
      })

      console.log('✅ SAVED URI:', res?.uri, 'PATH:', savePath)
      await exportToFilesIOS({ filename, uri: res?.uri || '' })
    } else if (isIOS) {
      // iOS web/PWA
    } else {
      const blobUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()

      setTimeout(() => {
        document.body.removeChild(link)
        URL.revokeObjectURL(blobUrl)
      }, 300)
    }

    offlineById.value = { ...offlineById.value, [song.id]: true }
  } catch (e) {
    console.error('Error en descarga:', e)
  } finally {
    downloadingById.value = { ...downloadingById.value, [song?.id]: false }
  }
}

/* ======================
   SEARCH HELPERS
====================== */
const normalizedSearch = computed(() => (props.search || '').trim().toLowerCase())
const isSearching = computed(() => normalizedSearch.value.length > 0)

const matchesSong = (song) => {
  const q = normalizedSearch.value
  if (!q) return true
  const title = (song.title || '').toLowerCase()
  const note = (song.note || '').toLowerCase()
  const user = (song.username || '').toLowerCase()
  return title.includes(q) || note.includes(q) || user.includes(q)
}

const filteredSongs = computed(() => {
  if (!isSearching.value) return songs.value
  return songs.value.filter(matchesSong)
})

/* ======================
   ✅ PROMOTED HELPERS
====================== */
const isPromoted = (song) => {
  const until = song?.promoted_until
  if (!until) return false
  return new Date(until) > new Date()
}

const promoDaysByPlan = {
  basic: 1,
  pro: 3,
  max: 7
}

/* ======================
   ✅ APLICAR PROMOCIÓN DESDE URL (VERSIÓN MEJORADA CON DEBUG)
====================== */
const applyPromotionFromUrl = async () => {
  try {
    console.log('🔍 Checking for promotion params in URL...')
    
    const url = new URL(window.location.href)
    console.log('📍 Full URL:', url.href)

    let params = url.searchParams
    let promoSuccess = params.get('promosuccess')
    let audioId = params.get('audio_id')
    let planRaw = params.get('plan')

    if (!promoSuccess && url.hash.includes('?')) {
      const hashQuery = url.hash.split('?')[1] || ''
      params = new URLSearchParams(hashQuery)
      promoSuccess = params.get('promosuccess')
      audioId = params.get('audio_id')
      planRaw = params.get('plan')
      console.log('🔎 Params from hash:', { promoSuccess, audioId, planRaw })
    } else {
      console.log('🔎 Params from search:', { promoSuccess, audioId, planRaw })
    }

    if (!promoSuccess || !audioId || !planRaw) {
      console.log('❌ No promotion params found')
      return
    }

    if (!currentUserId.value) {
      console.log('❌ No user logged in')
      return
    }

    console.log('✅ Promotion params found!', { audioId, plan: planRaw, userId: currentUserId.value })

    const plan = String(planRaw).toLowerCase()
    const days = promoDaysByPlan[plan] || 1

    const now = new Date()
    const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

    console.log('📅 Setting promotion until:', until.toISOString(), `(${days} days)`)

    const { data: updateData, error } = await supabase
      .from('audios')
      .update({
        promoted_until: until.toISOString(),
        promoted_plan: plan,
        promoted_at: now.toISOString()
      })
      .eq('id', audioId)
      .eq('user_id', currentUserId.value)
      .select()

    if (error) {
      console.error('❌ Error updating audio promotion:', error)
      alert(`Error al aplicar la promoción: ${error.message}`)
      return
    }

    console.log('✅ Audio promotion updated in DB!', updateData)

    const cleanSearch = new URLSearchParams(url.searchParams)
    cleanSearch.delete('promosuccess')
    cleanSearch.delete('audio_id')
    cleanSearch.delete('plan')
    cleanSearch.delete('promotion_id')

    let cleanHash = url.hash
    if (cleanHash.includes('?')) {
      const baseHash = cleanHash.split('?')[0]
      const hashParams = new URLSearchParams(cleanHash.split('?')[1] || '')
      hashParams.delete('promosuccess')
      hashParams.delete('audio_id')
      hashParams.delete('plan')
      hashParams.delete('promotion_id')
      cleanHash = `${baseHash}${hashParams.toString() ? `?${hashParams.toString()}` : ''}`
    }

    const cleanUrl = `${url.pathname}${cleanSearch.toString() ? `?${cleanSearch.toString()}` : ''}${cleanHash}`
    window.history.replaceState({}, '', cleanUrl)

    console.log('🧹 URL cleaned:', cleanUrl)

    console.log('🔄 Force reloading songs...')
    loading.value = true
    await loadSongs()
    loading.value = false
    
    console.log('✅ Songs reloaded. Total songs:', songs.value.length)
    
    const promotedSong = songs.value.find(s => s.id === audioId)
    if (promotedSong) {
      console.log('🎯 Found promoted song:', promotedSong)
      console.log('🔥 Is promoted?', isPromoted(promotedSong))
      console.log('📅 promoted_until:', promotedSong.promoted_until)
      console.log('📋 promoted_plan:', promotedSong.promoted_plan)
    }
    
    lastPlayedId.value = audioId

    console.log('✅ Promotion applied successfully!')

    await nextTick()
    setTimeout(() => {
      const el = songRefs.value?.[audioId]
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        console.log('📍 Scrolled to promoted audio')
      }
    }, 300)

    alert('🔥 ¡Audio promocionado exitosamente!')
    
  } catch (e) {
    console.error('💥 applyPromotionFromUrl crash:', e)
    alert(`Error inesperado: ${e.message}`)
  }
}

/* ======================
   DOTLOTTIE
====================== */
const DOTLOTTIE_SRC =
  'https://unpkg.com/@lottiefiles/dotlottie-wc@0.1.0/dist/dotlottie-wc.js'

const ensureDotLottie = () =>
  new Promise((resolve) => {
    if (customElements.get('dotlottie-wc')) return resolve()

    const existing = document.querySelector('script[data-dotlottie]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })

      const t = setInterval(() => {
        if (customElements.get('dotlottie-wc')) {
          clearInterval(t)
          resolve()
        }
      }, 50)

      return
    }

    const s = document.createElement('script')
    s.type = 'module'
    s.src = DOTLOTTIE_SRC
    s.setAttribute('data-dotlottie', '1')
    s.onload = () => resolve()
    document.head.appendChild(s)
  })

/* ======================
   GEO CACHE
====================== */
let cachedGeo = null
const getGeoFromIP = async () => {
  if (cachedGeo) return cachedGeo
  try {
    const res = await fetch('https://ipapi.co/json/')
    const data = await res.json()
    cachedGeo = data
    return data
  } catch {
    return null
  }
}

/* ======================
   PLAY COUNTS
====================== */
const loadPlayCounts = async () => {
  const { data } = await supabase.from('listening_history').select('song_id')

  const counts = {}
  data?.forEach((row) => {
    counts[row.song_id] = (counts[row.song_id] || 0) + 1
  })

  playCounts.value = counts
}

/* ======================
   LOAD SONGS
====================== */
const loadSongs = async () => {
  loading.value = true

  try {
    // 1) Hidden songs
    const { data: hidden, error: hiddenErr } = await supabase
      .from('not_interested_songs')
      .select('song_id')
      .eq('user_id', currentUserId.value)

    if (hiddenErr) {
      console.error('❌ not_interested_songs select error:', hiddenErr)
    }

    hiddenSongs.value = new Set((hidden || []).map((h) => h.song_id))

    // 2) Audios
    const { data: audios, error: audiosErr } = await supabase
      .from('audios')
      .select(
        `
        id,
        title,
        audio_url,
        note,
        created_at,
        image_url,
        video_url,
        user_id,
        promoted_until,
        promoted_plan,
        promoted_at,
        profiles ( username )
      `
      )
      .order('created_at', { ascending: false })

    if (audiosErr) {
      console.error('❌ audios select error:', audiosErr)
      songs.value = []
      emit('songs-loaded', songs.value)
      return
    }

    songs.value = (audios || [])
      .filter((song) => !hiddenSongs.value.has(song.id))
      .map((song) => ({
        ...song,
        username: song.profiles?.username || 'Usuario'
      }))

    // 3) Promotions (optional)
    const nowIso = new Date().toISOString()

    const { data: promotions, error: promoErr } = await supabase
      .from('promotions')
      .select('audio_id, ends_at, plan, status')
      .in('status', ['active', 'paid'])
      .gt('ends_at', nowIso)

    if (promoErr) {
      console.log('⚠️ promotions select error:', promoErr)
    }

    const promoMap = {}
    for (const promo of promotions || []) {
      if (!promo?.audio_id) continue
      promoMap[promo.audio_id] = promo
    }

    songs.value = songs.value.map((song) => {
      const promo = promoMap[song.id]

      const promoUntil = promo?.ends_at || song.promoted_until || null
      const promoPlan = promo?.plan || song.promoted_plan || null

      return {
        ...song,
        promoted_until: promoUntil,
        promoted_plan: promoPlan
      }
    })

    // 4) Sorting
    const now = new Date()
    songs.value = songs.value.sort((a, b) => {
      const aPromo = a.promoted_until && new Date(a.promoted_until) > now
      const bPromo = b.promoted_until && new Date(b.promoted_until) > now

      if (aPromo !== bPromo) return Number(bPromo) - Number(aPromo)

      if (aPromo && bPromo) {
        return new Date(b.promoted_until) - new Date(a.promoted_until)
      }

      return new Date(b.created_at) - new Date(a.created_at)
    })

    emit('songs-loaded', songs.value)

    await loadPlayCounts()
    await refreshOfflineFlags(songs.value)
  } catch (err) {
    console.error('❌ loadSongs crash:', err)
    songs.value = []
    emit('songs-loaded', songs.value)
  } finally {
    loading.value = false
  }
}

/* ======================
   SEARCH AUTOSCROLL + HIT
====================== */
watch(
  () => normalizedSearch.value,
  async (value) => {
    searchHitId.value = null
    if (!value) return

    await nextTick()

    const match = songs.value.find((song) => matchesSong(song))
    if (!match) return

    searchHitId.value = match.id

    const el = songRefs.value?.[match.id]
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }
)

/* ======================
   ▶️ PLAY SONG
====================== */
const playSong = async (song) => {
  if (isPlayLocked.value) return
  isPlayLocked.value = true

  try {
    lastPlayedId.value = song.id

    emit('play', {
      ...song,
      url: song.audio_url,
      username: song.username || 'Usuario'
    })

    if (playedThisSession.has(song.id)) return
    if (song.user_id === currentUserId.value) return

    playedThisSession.add(song.id)
    sessionStorage.setItem(SESSION_KEY, JSON.stringify([...playedThisSession]))

    const geo = await getGeoFromIP()

    await supabase.from('listening_history').insert({
      user_id: currentUserId.value,
      song_id: song.id,
      country: geo?.country_name || null,
      city: geo?.city || null
    })
  } finally {
    setTimeout(() => {
      isPlayLocked.value = false
    }, 300)
  }
}

/* ======================
   🎥 VIDEO PREVIEW (modo Spotify)
   - click en la card abre/cierra
   - autoplay + loop + sin audio
====================== */
const pauseVideo = (songId) => {
  const el = videoElsById.value?.[songId]
  if (!el) return
  try {
    el.pause()
    el.currentTime = 0
  } catch {}
}

const playVideo = async (songId) => {
  const el = videoElsById.value?.[songId]
  if (!el) return
  try {
    el.muted = true
    el.volume = 0
    el.loop = true
    el.playsInline = true
    await el.play()
  } catch {}
}

const toggleVideo = async (song) => {
  const songId = song?.id
  if (!songId) return

  const prev = expandedVideoId.value
  const next = prev === songId ? null : songId

  if (prev && prev !== next) pauseVideo(prev)

  expandedVideoId.value = next

  if (next) {
    await nextTick()
    await playVideo(next)
  }
}

const onSongCardClick = (song) => {
  // Reproduce el audio (player) como siempre
  playSong(song)

  // Si hay vídeo, lo muestra y lo reproduce en bucle sin audio
  if (song?.video_url) {
    toggleVideo(song)
  } else if (expandedVideoId.value) {
    // Si no hay vídeo, cierra cualquier vídeo abierto
    pauseVideo(expandedVideoId.value)
    expandedVideoId.value = null
  }
}

/* ======================
   REALTIME
====================== */
onMounted(async () => {
  await ensureDotLottie()
  await ensureIosDownloadsFolder()

  const { data } = await supabase.auth.getUser()
  if (!data?.user) return

  currentUserId.value = data.user.id

  await applyPromotionFromUrl()

  if (!songs.value.length) {
    await loadSongs()
  }

  channel = supabase
    .channel('playlist-realtime')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'listening_history' },
      (payload) => {
        playCounts.value[payload.new.song_id] =
          (playCounts.value[payload.new.song_id] || 0) + 1
      }
    )
    .subscribe()
})

onUnmounted(() => {
  if (channel) supabase.removeChannel(channel)
})

/* ======================
   SHARE (POPUP + COPY LINK)
====================== */
// --- Share overlay state
const shareOpen = ref(false)
const shareSongData = ref(null)

const copiedToast = ref(false)
let copiedTimer = null

const getSongLink = (song) => `${window.location.origin}/#/song/${song.id}`

// ✅ use a unique class to avoid collisions with other global styles
const SHARE_OPEN_CLASS = 'cm-share-open'

const applyShareClass = (on) => {
  const html = document.documentElement
  const body = document.body
  if (!html || !body) return

  // remove legacy class just in case it exists from previous builds
  html.classList.remove('share-open')
  body.classList.remove('share-open')

  if (on) {
    html.classList.add(SHARE_OPEN_CLASS)
    body.classList.add(SHARE_OPEN_CLASS)
  } else {
    html.classList.remove(SHARE_OPEN_CLASS)
    body.classList.remove(SHARE_OPEN_CLASS)
  }
}

const openShare = (song) => {
  shareSongData.value = song
  copiedToast.value = false
  shareOpen.value = true
}

const closeShare = () => {
  shareOpen.value = false
  shareSongData.value = null
  copiedToast.value = false
  clearTimeout(copiedTimer)
}

// ✅ keep DOM class in sync even if route changes / rerenders
watch(shareOpen, (v) => {
  applyShareClass(!!v)
})

onMounted(() => {
  // defensive cleanup in case the class was left behind
  applyShareClass(false)
})

const copyShareLink = async () => {
  if (!shareSongData.value) return

  try {
    const url = getSongLink(shareSongData.value)
    await navigator.clipboard.writeText(url)

    copiedToast.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copiedToast.value = false
    }, 1300)
  } catch (e) {
    console.log('Error copiando link', e)
  }
}

onUnmounted(() => {
  clearTimeout(copiedTimer)
  applyShareClass(false)
})

/* ======================
   DELETE SONG (solo dueño)
====================== */
const deleteSong = async (songId) => {
  try {
    if (!songId) return

    const ok = confirm('¿Seguro que quieres eliminar este audio?')
    if (!ok) return

    const { error: e1 } = await supabase.from('audios').delete().eq('id', songId)
    if (e1) throw e1

    const { error: e2 } = await supabase
      .from('listening_history')
      .delete()
      .eq('song_id', songId)
    if (e2) console.log('⚠️ listening_history delete:', e2)

    songs.value = songs.value.filter((s) => s.id !== songId)

    await loadPlayCounts()
    await refreshOfflineFlags(songs.value)
  } catch (err) {
    console.error('❌ deleteSong error:', err)
    alert('No se pudo eliminar. Mira la consola para ver el error.')
  }
}

/* ======================
   NO ME INTERESA
====================== */
const noMeInteresa = async (songId) => {
  try {
    if (!songId || !currentUserId.value) return

    hiddenSongs.value.add(songId)
    songs.value = songs.value.filter((s) => s.id !== songId)

    const { error } = await supabase.from('not_interested_songs').insert({
      user_id: currentUserId.value,
      song_id: songId
    })

    if (error) {
      console.log('⚠️ not_interested_songs insert:', error)
    }
  } catch (e) {
    console.error('❌ noMeInteresa error:', e)
  }
}

const triggerNoMeInteresa = (songId) => {
  rejectingId.value = songId
  setTimeout(async () => {
    await noMeInteresa(songId)
    rejectingId.value = null
  }, 350)
}
</script>

<template>
  <div class="playlist-container">
    <p v-if="loading" class="empty">Cargando audios...</p>
    <p v-else-if="!songs.length" class="empty">No hay audios aún</p>

    <div v-else-if="isSearching && !filteredSongs.length" class="no-results-wrap">
      <div class="no-results-sway">
        <dotlottie-wc
          class="no-results-lottie"
          src="https://lottie.host/00e193e5-95ec-4eae-8304-cf7e0e948265/hoa7Th0L0z.lottie"
          autoplay
          loop
        ></dotlottie-wc>
      </div>

      <div class="no-results-title">
        No hay resultados para "{{ props.search }}"
      </div>
      <div class="no-results-sub">
        Prueba con otro nombre, nota o usuario
      </div>
    </div>

    <TransitionGroup name="list" tag="div" class="playlist-wrapper">
      <div v-for="song in filteredSongs" :key="song.id" class="song-item">
        <div
          class="song-card"
          :class="{
            promoted: isPromoted(song),
            playing: lastPlayedId === song.id,
            'is-rejecting': rejectingId === song.id,
            'has-search': isSearching && searchHitId === song.id,
            'search-hit': searchHitId === song.id
          }"
          :ref="(el) => { if (el) songRefs[song.id] = el }"
          @click="onSongCardClick(song)"
        >
          <button
            v-if="song.user_id !== currentUserId"
            class="not-interest-btn"
            @click.stop="triggerNoMeInteresa(song.id)"
          >
            <span class="x-icon">✕</span>
          </button>

          <div class="info">
            <div class="title-marquee">
              <div class="marquee-inner">
                <strong>{{ song.title }}</strong>
                <strong v-if="lastPlayedId === song.id" class="dup">{{ song.title }}</strong>
              </div>
            </div>
            <small v-if="song.note">{{ song.note }}</small>

            <!-- chips row: promo -->
            <div class="chips-row">
              <div v-if="isPromoted(song)" class="promo-badge">
                🔥 promocionado
              </div>
            </div>
          </div>

          <div class="actions">
            <div class="plays-badge">
              ▶ {{ playCounts[song.id] || 0 }}
            </div>

            <!-- Compartir -->
            <button class="share-btn" @click.stop="openShare(song)" aria-label="Compartir">
              <img class="share-icon-img" src="/share.png" alt="share" />
            </button>

            <!-- 🎥 Ver vídeo (si existe) -->
            <button
              v-if="song.video_url"
              class="video-btn"
              :class="{ active: expandedVideoId === song.id }"
              @click.stop="toggleVideo(song)"
              aria-label="Ver vídeo"
              title="Ver vídeo"
            >
              🎥
            </button>

            <!-- ✅ Descargar -->
            <button
              class="download-btn"
              @click.stop="toggleDownload(song)"
              :disabled="downloadingById[song.id]"
              :title="offlineById[song.id] ? 'Eliminar descarga' : 'Descargar sin conexión'"
              aria-label="Descargar"
            >
              <!-- Spinner -->
              <svg v-if="downloadingById[song.id]" class="dl-spin" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" opacity="0.25"/>
                <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>

              <!-- Check -->
              <svg v-else-if="offlineById[song.id]" class="dl-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>

              <!-- Download -->
              <svg v-else class="dl-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3v10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
                <path d="M8 11l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M5 21h14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
              </svg>
            </button>

            <!-- Borrar (solo dueño) -->
            <button
              v-if="song.user_id === currentUserId"
              class="delete-btn"
              @click.stop="deleteSong(song.id)"
            >
              🗑️
            </button>
          </div>

          <!-- Flecha solo en hit -->
          <button
            v-if="isSearching && searchHitId === song.id"
            class="search-arrow"
            title="Reproducir"
            @click.stop="playSong(song)"
          >
            ➜
          </button>
        </div>

        <!-- 🎥 Video panel (desplegable) -->
        <transition name="video">
          <div
            v-if="expandedVideoId === song.id"
            class="video-panel"
            @click.stop
          >
            <video
              class="video-player"
              :src="song.video_url"
              muted
              loop
              playsinline
              preload="metadata"
              :ref="(el) => { if (el) videoElsById[song.id] = el }"
            ></video>
          </div>
        </transition>
      </div>
    </TransitionGroup>
  </div>

  <!-- SHARE POPUP (fuera del v-for) -->
  <div v-if="shareOpen" class="share-overlay" @click="closeShare">
    <div class="share-sheet" @click.stop>
      <div class="share-top">
        <div class="share-title">Compartir</div>
        <button class="share-close" @click="closeShare">✕</button>
      </div>

      <div class="share-sub">
        {{ shareSongData?.title || 'Canción' }}
      </div>

      <div class="share-grid one">
        <button class="share-action" @click="copyShareLink">
          <span class="share-emoji">🔗</span>
          <span>Copiar link</span>
        </button>
      </div>

      <!-- Toast -->
      <div v-if="copiedToast" class="share-toast">
        !! a compartir con tus amigos !!
      </div>
    </div>
  </div>
</template>

<style scoped>
/* =========================================
   1. CONTENEDOR
   ========================================= */
.playlist-container {
  width: 100%;
  margin-top: 1.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow-x: hidden;
  padding-bottom: 120px;

  /* ✅ asegura que toda la playlist quede en su propio nivel (no tape header/categorías) */
  position: relative;
  z-index: 0;
  /* ✅ FIX: evita scroll interno (barra blanca en medio) */
  height: auto;
  max-height: none;
  overflow-y: visible;
}

.playlist-wrapper {
  width: 100%;
  max-width: 500px;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
  /* ✅ FIX: evita scroll interno */
  height: auto;
  max-height: none;
  overflow: visible;
}

/* wrapper por item (card + panel) */
.song-item{
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* =========================================
   2. TARJETA
   ========================================= */
.song-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;

  width: calc(100% - 32px);
  max-width: 480px;
  margin: 0 auto 12px auto;

  padding: 12px 16px;
  height: auto;
  min-height: 75px;
  border-radius: 24px;
  box-sizing: border-box;

  cursor: pointer;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);

  border: 1.5px solid transparent;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.05);

  transition: transform .22s ease, box-shadow .22s ease, border-color .22s ease;
  overflow: hidden;
}

/* ✅ Hover sin "subir" */
.song-card:hover {
  transform: none;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.08);
  border-color: rgba(99, 102, 241, 0.22);
}

/* ✅ SOLO el card del HIT reserva hueco a la izquierda */
.song-card.has-search {
  overflow: visible;
  padding-left: 56px;
}

/* Estado cuando suena */
.song-card.playing {
  background: #ffffff;
  border-color: #3b82f6;
  box-shadow: 0 10px 20px rgba(59, 130, 246, 0.15);
}

/* resalta el match */
.song-card.search-hit {
  border-color: #6366f1;
  box-shadow: 0 12px 26px rgba(99, 102, 241, 0.22);
}

/* 🔥 PROMOCIONADO */
.song-card.promoted {
  border-color: rgba(255, 87, 34, 0.65) !important;
  box-shadow: 0 16px 34px rgba(255, 87, 34, 0.14) !important;
}

.chips-row{
  display: grid;
  grid-template-columns: 1fr; /* <- antes 1fr auto */
  align-items: center;
  column-gap: 10px;
  row-gap: 6px;
  margin-top: 6px;
  width: 100%;
  min-width: 0;
}

@media (max-width: 520px){
  .chips-row{
    column-gap: 8px;
    row-gap: 6px;
    margin-top: 5px;
  }
}

.promo-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 0.70rem;
  font-weight: 900;
  background: rgba(255, 87, 34, 0.12);
  border: 1px solid rgba(255, 87, 34, 0.22);
  color: #ff5722;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: fit-content;
}

/* rechazar */
.is-rejecting {
  animation: shake 0.4s ease;
  background: #fff5f5 !important;
  border-color: #ff4d4f !important;
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-6px); }
  75% { transform: translateX(6px); }
}

/* =========================================
   3. BOTÓN NO ME INTERESA
   ========================================= */
.not-interest-btn {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  border: none;
  background: #f1f3f5;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.x-icon {
  font-size: 12px;
  font-weight: 900;
  color: #adb5bd;
}

.not-interest-btn:active,
.not-interest-btn:hover {
  background: #ff4d4f;
  transform: rotate(90deg) scale(1.1);
}

.not-interest-btn:active .x-icon,
.not-interest-btn:hover .x-icon {
  color: white;
}

/* =========================================
   4. TEXTO / MARQUEE
   ========================================= */
.info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.title-marquee {
  overflow: hidden;
  white-space: nowrap;
  mask-image: linear-gradient(to right, black 80%, transparent 100%);
  -webkit-mask-image: linear-gradient(to right, black 80%, transparent 100%);
}

.marquee-inner { display: inline-flex; }

.marquee-inner strong {
  font-size: 0.95rem;
  font-weight: 700;
  color: #111;
  padding-right: 40px;
}

.song-card.playing .marquee-inner {
  animation: marquee-scroll 10s linear infinite;
}

@keyframes marquee-scroll {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}

.info small {
  font-size: 0.7rem;
  color: #888;
  margin-top: 1px;
}

/* =========================================
   5. ACCIONES
   ========================================= */
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.plays-badge {
  height: 24px;
  padding: 0 10px;
  font-size: 0.7rem;
  font-weight: 800;
  border-radius: 999px;
  background: rgba(0,0,0,0.05);
  display: flex;
  align-items: center;
  color: #111;
}

.delete-btn {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: #f8f9fa;
  border: none;
  cursor: pointer;
}

/* =========================================
   ✅ FLECHA FUERA DEL CARD (A LA IZQUIERDA)
   ========================================= */
.search-arrow {
  position: absolute;
  top: 50%;
  left: -18px;
  transform: translateY(-50%);

  width: 38px;
  height: 38px;
  border-radius: 999px;
  border: none;

  background: #6366f1;
  color: #fff;
  font-size: 18px;
  font-weight: 900;

  display: grid;
  place-items: center;

  cursor: pointer;
  box-shadow: 0 10px 24px rgba(99, 102, 241, 0.38);
  transition: transform .18s ease, filter .18s ease, box-shadow .18s ease;
  z-index: 10;
}

.song-card:hover .search-arrow {
  transform: translateY(-50%) translateX(-3px);
  box-shadow: 0 14px 28px rgba(99, 102, 241, 0.48);
}

.search-arrow:active {
  transform: translateY(-50%) scale(0.96);
  filter: brightness(0.95);
}

/* móvil */
@media (max-width: 520px) {
  .search-arrow { left: -12px; }
  .song-card.has-search { padding-left: 52px; }
}

/* =========================================
   6. ANIMACIONES DE LISTA
   ========================================= */
.list-enter-active, .list-leave-active { transition: all 0.4s ease; }
.list-enter-from { opacity: 0; transform: translateY(15px); }
.list-leave-to { opacity: 0; transform: translateX(-100px); }
.list-move { transition: transform 0.4s ease; }

/* =========================================
   MODO OSCURO
   ========================================= */
:global(.p-dark) .song-card {
  background: rgba(30, 30, 32, 0.9);
  border-color: rgba(255, 255, 255, 0.05);
}
:global(.p-dark) .info strong { color: white; }

/* ================================
   NO RESULTS (dotlottie) + animación PRO
   ================================ */

.no-results-wrap {
  width: 100%;
  max-width: 520px;
  margin: 26px auto 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  animation: noresPop .22s ease-out;
}

@keyframes noresPop {
  from { transform: translateY(8px); opacity: 0; }
  to   { transform: translateY(0); opacity: 1; }
}

/* ✅ ESTE es el que se mueve (wrapper) */
.no-results-sway {
  display: grid;
  place-items: center;
  width: fit-content;

  /* punto de "cuerda" arriba */
  transform-origin: 50% 8%;
  will-change: transform;

  /* animación balanceo + "bobbing" */
  animation: swingFace 2.4s cubic-bezier(.45,.02,.55,.98) infinite;
}

/* ✅ Balanceo completo derecha ↔ izquierda (con overshoot pro) */
@keyframes swingFace {
  0%   { transform: rotate(14deg)  translate3d(10px, 0px, 0); }
  18%  { transform: rotate(4deg)   translate3d(4px,  1px, 0); }
  50%  { transform: rotate(-14deg) translate3d(-10px, 2px, 0); }
  82%  { transform: rotate(-4deg)  translate3d(-4px,  1px, 0); }
  100% { transform: rotate(14deg)  translate3d(10px, 0px, 0); }
}

/* ✅ el dotlottie: tamaño + sombra */
.no-results-lottie {
  width: 190px;
  height: 190px;
  display: block;
  opacity: 0.98;
  filter: drop-shadow(0 18px 45px rgba(0,0,0,0.22));
}

/* Textos */
.no-results-title {
  font-size: 0.98rem;
  font-weight: 800;
  color: rgba(255,255,255,0.82);
}

.no-results-sub {
  font-size: 0.85rem;
  font-weight: 600;
  color: rgba(255,255,255,0.45);
}

/* Light mode */
:global(:root:not(.p-dark)) .no-results-title { color: rgba(0,0,0,0.72); }
:global(:root:not(.p-dark)) .no-results-sub   { color: rgba(0,0,0,0.42); }

/* móvil */
@media (max-width: 520px) {
  .no-results-lottie { width: 165px; height: 165px; }
  .no-results-wrap { margin-top: 18px; }
  .no-results-sway { animation-duration: 2.8s; }
}

/* accesibilidad */
@media (prefers-reduced-motion: reduce) {
  .no-results-sway { animation: none !important; }
}

/* =========================================
   SHARE POPUP (CUSTOM)
   ========================================= */

.share-overlay{
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.55);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999999;
  padding: 18px;
}

.share-modal{
  width: 100%;
  max-width: 360px;
  background: rgba(255,255,255,.92);
  border: 1px solid rgba(255,255,255,.55);
  border-radius: 26px;
  box-shadow: 0 30px 90px rgba(0,0,0,.35);
  overflow: hidden;
  transform: translateY(6px);
  animation: sharePop .18s ease-out;
}

@keyframes sharePop{
  from{ opacity: 0; transform: translateY(14px) scale(.98); }
  to{ opacity: 1; transform: translateY(6px) scale(1); }
}

.share-header{
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 10px;
}

.share-title{
  font-weight: 900;
  font-size: 1rem;
  letter-spacing: .02em;
  color: #111;
}

.share-close{
  width: 38px;
  height: 38px;
  border-radius: 999px;
  border: 1px solid rgba(0,0,0,.08);
  background: rgba(255,255,255,.75);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: transform .15s ease, background .15s ease;
}

.share-close:hover{ transform: scale(1.05); background: rgba(255,255,255,.95); }
.share-close:active{ transform: scale(.96); }

.share-body{
  padding: 0 16px 16px;
}

.share-preview{
  background: rgba(0,0,0,.03);
  border: 1px solid rgba(0,0,0,.06);
  border-radius: 18px;
  padding: 12px 12px;
  font-size: .9rem;
  color: rgba(0,0,0,.78);
  line-height: 1.25rem;
  margin-bottom: 12px;
}

.share-grid{
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.share-item{
  border: 1px solid rgba(0,0,0,.07);
  background: rgba(255,255,255,.8);
  border-radius: 18px;
  padding: 10px 8px;
  display: grid;
  gap: 6px;
  place-items: center;
  cursor: pointer;
  transition: transform .15s ease, box-shadow .15s ease, background .15s ease;
  box-shadow: 0 10px 24px rgba(0,0,0,.08);
  text-decoration: none;
}

.share-item:hover{
  transform: translateY(-2px);
  background: rgba(255,255,255,.96);
  box-shadow: 0 16px 34px rgba(0,0,0,.12);
}

.share-item:active{ transform: translateY(0px) scale(.98); }

.share-icon-img{
  width: 18px;
  height: 18px;
  object-fit: contain;
  opacity: .95;
}

.share-label{
  font-size: .72rem;
  font-weight: 800;
  color: rgba(0,0,0,.72);
  letter-spacing: .02em;
}

/* icon colors */
.share-wa{ background: #22c55e; }
.share-x{ background: #111111; }
.share-ig{ background: linear-gradient(135deg,#f58529,#dd2a7b,#8134af,#515bd4); }
.share-tt{ background: #0f172a; }

/* copy button */
.share-copy{
  width: 100%;
  margin-top: 12px;
  border: none;
  border-radius: 999px;
  padding: 12px 14px;
  background: #111;
  color: #fff;
  font-weight: 900;
  cursor: pointer;
  box-shadow: 0 14px 32px rgba(0,0,0,.18);
  transition: transform .15s ease, filter .15s ease;
}

.share-copy:hover{ transform: translateY(-1px); filter: brightness(1.12); }
.share-copy:active{ transform: translateY(0px) scale(.98); }

/* Dark mode */
:global(.p-dark) .share-modal{
  background: rgba(18,18,20,.92);
  border-color: rgba(255,255,255,.10);
}

:global(.p-dark) .share-title{ color: rgba(255,255,255,.92); }

:global(.p-dark) .share-preview{
  background: rgba(255,255,255,.06);
  border-color: rgba(255,255,255,.10);
  color: rgba(255,255,255,.82);
}

:global(.p-dark) .share-item{
  border-color: rgba(255,255,255,.12);
  background: rgba(255,255,255,.06);
  box-shadow: 0 14px 32px rgba(0,0,0,.35);
}

:global(.p-dark) .share-label{ color: rgba(255,255,255,.78); }

:global(.p-dark) .share-close{
  background: rgba(255,255,255,.06);
  border-color: rgba(255,255,255,.14);
  color: rgba(255,255,255,.9);
}

/* ======================
   SHARE BUTTON (card)
====================== */
.share-btn{
  width: 40px;
  height: 34px;
  border-radius: 12px;
  border: none;
  background: #f3f4f6;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: transform .15s ease, box-shadow .15s ease, background .15s ease;
}
.share-btn:hover{
  transform: translateY(-1px);
  background: #eef2ff;
  box-shadow: 0 10px 20px rgba(0,0,0,.08);
}
.share-btn:active{
  transform: scale(.96);
}
.share-icon{
  width: 18px;
  height: 18px;
  object-fit: contain;
  opacity: .95;
}

/* ======================
   SHARE POPUP (fixed + blur)
====================== */
.share-overlay{
  position: fixed;
  inset: 0;

  /* ✅ blur real detrás del modal */
  background: rgba(15, 23, 42, .38);
  backdrop-filter: blur(22px) saturate(150%);
  -webkit-backdrop-filter: blur(22px) saturate(150%);

  /* ✅ por encima incluso del logout-fab (que usa z-index enorme) */
  z-index: 2147483647;

  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;

  /* ayuda a que Safari/iOS renderice el backdrop-filter mejor */
  transform: translateZ(0);
  isolation: isolate;
}

/* ✅ algunos elementos fixed (logout/player) tienen z-index más alto y se "salvan" del blur.
   Con esta clase global, los difuminamos y evitamos interacción mientras el share está abierto. */
/* --- SHARE overlay blur/freeze for fixed elements --- */
:global(html.cm-share-open) .logout-fab,
:global(body.cm-share-open) .logout-fab,
:global(html.cm-share-open) .player-mini,
:global(body.cm-share-open) .player-mini,
:global(html.cm-share-open) .player,
:global(body.cm-share-open) .player,
:global(html.cm-share-open) .player-bar,
:global(body.cm-share-open) .player-bar,
:global(html.cm-share-open) .mobile-sidebar-btn,
:global(body.cm-share-open) .mobile-sidebar-btn,
:global(html.cm-share-open) .side-card {
  filter: blur(14px);
  opacity: 0.75;
  pointer-events: none;
}

.share-sheet{
  width: min(380px, calc(100% - 28px));
  background: rgba(255,255,255,.92);
  border: 1px solid rgba(255,255,255,.55);
  border-radius: 22px;
  box-shadow: 0 30px 90px rgba(0,0,0,.35);
  padding: 14px;
}

.share-top{
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.share-title{
  font-weight: 900;
  font-size: 1.05rem;
  color: #111;
}

.share-close{
  width: 36px;
  height: 36px;
  border-radius: 12px;
  border: none;
  background: rgba(0,0,0,.06);
  cursor: pointer;
}

.share-sub{
  margin-top: 8px;
  font-size: .85rem;
  color: rgba(0,0,0,.55);
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.share-grid{
  margin-top: 12px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.share-action{
  border: none;
  cursor: pointer;
  border-radius: 16px;
  padding: 12px 10px;
  background: rgba(0,0,0,.06);
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 800;
  color: #111;
  transition: transform .15s ease, background .15s ease, box-shadow .15s ease;
}

.share-action:hover{
  transform: translateY(-1px);
  background: rgba(99,102,241,.12);
  box-shadow: 0 12px 24px rgba(0,0,0,.10);
}

.share-emoji{
  width: 34px;
  height: 34px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: rgba(255,255,255,.85);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.75);
}
/* ✅ SOLO 1 botón en el popup: centrado */
.share-grid{
  justify-items: center; /* centra los items del grid */
}

.share-action{
  width: 100%;
  max-width: 260px;      /* se ve pro y no gigante */
  justify-content: center; /* centra icono + texto */
}

/* si quieres, puedes usar esta clase en el HTML: class="share-grid one" */
.share-grid.one{
  grid-template-columns: 1fr;
}
/* ✅ Toast dentro del share-sheet con animación */
.share-toast{
  margin-top: 12px;
  width: 100%;
  padding: 10px 12px;
  border-radius: 14px;
  text-align: center;
  font-weight: 900;
  font-size: .92rem;
  color: #0f172a;

  background: rgba(99,102,241,.10);
  border: 1px solid rgba(99,102,241,.22);

  /* animación */
  animation: shareToastPop .22s cubic-bezier(.2, 1.2, .2, 1) both;
  transform-origin: 50% 80%;
  position: relative;
  overflow: hidden;
}

/* brillo sutil */
.share-toast::after{
  content: "";
  position: absolute;
  top: -40%;
  left: -60%;
  width: 60%;
  height: 180%;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255,255,255,.55),
    transparent
  );
  transform: rotate(20deg);
  animation: shareToastShine 1.1s ease both;
  pointer-events: none;
}

@keyframes shareToastPop{
  0%{
    opacity: 0;
    transform: translateY(6px) scale(.96);
    filter: blur(2px);
  }
  100%{
    opacity: 1;
    transform: translateY(0) scale(1);
    filter: blur(0);
  }
}

@keyframes shareToastShine{
  0%{ left: -70%; opacity: 0; }
  20%{ opacity: .9; }
  100%{ left: 120%; opacity: 0; }
}

.song-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.icon-btn {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: none;
  background: #f2f2f2;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: transform .08s ease;
}

.icon-btn:hover {
  transform: scale(1.03);
}

.icon-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
/* ======================
   ✅ DOWNLOAD BUTTON (igual que share)
====================== */
.download-btn{
  width: 40px;
  height: 34px;
  border-radius: 12px;
  border: none;
  background: #f3f4f6;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: transform .15s ease, box-shadow .15s ease, background .15s ease;
}

.download-btn:hover{
  transform: translateY(-1px);
  background: #eef2ff;
  box-shadow: 0 10px 20px rgba(0,0,0,.08);
}

.download-btn:active{
  transform: scale(.96);
}

.download-btn:disabled{
  opacity: .6;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.download-btn .pi{
  font-size: 16px;
}

/* =========================
   ✅ MÓVIL: cards más bajitos + texto más pequeño
========================= */
@media (max-width: 520px) {
  .song-card{
    height: auto;
    min-height: 62px;
    padding: 10px 12px;
    border-radius: 20px;
    gap: 10px;
  }

  .not-interest-btn{
    width: 28px;
    height: 28px;
    border-radius: 9px;
  }

  .marquee-inner strong{
    font-size: 0.86rem;
    padding-right: 26px;
  }

  .info small{
    font-size: 0.64rem;
    line-height: 1.05;
    margin-top: 0;
  }

  .actions{
    gap: 6px;
  }

  .plays-badge{
    height: 20px;
    padding: 0 8px;
    font-size: 0.62rem;
  }

  .share-btn,
  .download-btn{
    width: 34px;
    height: 30px;
    border-radius: 10px;
  }

  .delete-btn{
    width: 30px;
    height: 30px;
    border-radius: 10px;
  }

  .dl-icon{ width: 18px; height: 18px; }
  .dl-spin{ width: 18px; height: 18px; }
}

@media (max-width: 520px) {
  .marquee-inner strong{
    font-size: 0.78rem !important;
    font-weight: 800;
    letter-spacing: -0.01em;
    padding-right: 22px;
    line-height: 1.05;
  }

  .info small{
    font-size: 0.60rem !important;
    opacity: .70;
    line-height: 1.05;
  }

  .info{
    min-width: 0;
  }

  .title-marquee{
    mask-image: linear-gradient(to right, black 70%, transparent 100%);
    -webkit-mask-image: linear-gradient(to right, black 70%, transparent 100%);
  }
}

@media (max-width: 520px) {
  .song-card{
    height: auto;
    min-height: 64px;
    padding: 10px 14px;
    border-radius: 20px;
  }

  .info small{
    font-size: 0.62rem;
    margin-top: 0px;
    line-height: 1;
  }

  .title-marquee{
    overflow: hidden;
    white-space: nowrap;
    mask-image: linear-gradient(to right, black 78%, transparent 100%);
    -webkit-mask-image: linear-gradient(to right, black 78%, transparent 100%);
  }

  .marquee-inner{
    display: inline-flex;
    animation: marquee-scroll 9s linear infinite !important;
    will-change: transform;
  }

  .marquee-inner strong{
    font-size: 0.80rem;
    font-weight: 850;
    padding-right: 26px;
    line-height: 1.05;
  }

  .marquee-inner strong.dup{
    display: inline-block !important;
  }
}

@media (max-width: 520px) {
  .song-card .title-marquee .marquee-inner strong{
    font-size: 0.80rem !important;
    line-height: 1.05 !important;
  }

  .song-card .title-marquee .marquee-inner strong.dup{
    font-size: 0.80rem !important;
    line-height: 1.05 !important;
    display: inline-block !important;
  }
}

:global(html),
:global(body) {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}

.playlist-container,
.song-card,
.info,
.title-marquee {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}

@media (max-width: 520px) {
  .song-card .title-marquee .marquee-inner strong,
  .song-card .title-marquee .marquee-inner strong.dup {
    font-size: 0.80rem !important;
    line-height: 1.05 !important;
  }
}
/* ======================
   🎥 VIDEO BUTTON + PANEL
====================== */
.video-btn{
  width: 40px;
  height: 34px;
  border-radius: 12px;
  border: none;
  background: #f3f4f6;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: transform .15s ease, box-shadow .15s ease, background .15s ease;
  font-size: 16px;
}

.video-btn:hover{
  transform: translateY(-1px);
  background: rgba(99,102,241,.12);
  box-shadow: 0 10px 20px rgba(0,0,0,.08);
}

.video-btn:active{
  transform: scale(.96);
}

.video-btn.active{
  background: rgba(99,102,241,.18);
}

.video-panel{
  width: calc(100% - 32px);
  max-width: 480px;
  margin: 10px auto 14px auto; /* ✅ sin margen negativo (evita que “suba” y tape arriba) */
  padding: 10px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(0,0,0,.06);
  box-shadow: 0 16px 34px rgba(0,0,0,.10);
  overflow: hidden;
  position: relative;
  z-index: 0;
}

.video-player{
  width: 100%;
  height: auto;
  border-radius: 14px;
  display: block;
  background: #000;
}

.video-enter-active, .video-leave-active{ transition: all .18s ease; }
.video-enter-from, .video-leave-to{ opacity: 0; transform: translateY(-6px); }

@media (max-width: 520px){
  .video-btn{ width: 34px; height: 30px; border-radius: 10px; }
  .video-panel{ width: calc(100% - 28px); border-radius: 16px; }
  .video-player{ border-radius: 12px; }
}

:global(.p-dark) .video-panel{
  background: rgba(18,18,20,.92);
  border-color: rgba(255,255,255,.10);
  box-shadow: 0 18px 45px rgba(0,0,0,.35);
}

/* =========================================
   ✅ HARD OVERRIDE: NO inner scrollbars
   ========================================= */
.playlist-container,
.playlist-wrapper {
  height: auto !important;
  max-height: none !important;
  overflow-y: visible !important;
}
</style>
