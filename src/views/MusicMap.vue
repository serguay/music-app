<script setup>
import { onMounted, onBeforeUnmount, ref, computed, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { usePlayer } from '../stores/player'

import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

const router = useRouter()
const player = usePlayer()

const loading = ref(true)
const mapReady = ref(false)

const DEFAULT_CENTER = { lat: 41.4720, lng: 2.0843 }
const geoStatus = ref('idle')
const geoMessage = ref('')

const reactionToast = ref('')
let reactionToastTimer = null
function showReactionToast(msg) {
  reactionToast.value = msg
  if (reactionToastTimer) clearTimeout(reactionToastTimer)
  reactionToastTimer = setTimeout(() => {
    reactionToast.value = ''
    reactionToastTimer = null
  }, 1600)
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function formatFromOffsetMinutes(offsetMin) {
  const d = new Date(Date.now() + offsetMin * 60_000)
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
}

function isSecureOrigin() {
  const proto = window.location.protocol
  if (proto === 'https:') return true
  if (proto === 'capacitor:' || proto === 'ionic:' || proto === 'file:' || proto === 'app:') return true
  const host = window.location.hostname
  const isLocalhost = host === 'localhost' || host === '127.0.0.1'
  return isLocalhost
}

const shareOnMap = ref(localStorage.getItem('musicmap_share') === 'true')

const lastPos = JSON.parse(localStorage.getItem('musicmap_lastpos') || 'null')
const myLat = ref(lastPos?.lat ?? null)
const myLng = ref(lastPos?.lng ?? null)

const nowPlaying = ref({ id: null, title: null, artist: null })

const myPresence = ref(null) // { track_id, track_title, artist, tz_offset_min, updated_at, visibility }

// Evita mostrar presence viejo como fallback
const PRESENCE_STALE_MS = 45_000
const isPresenceFresh = computed(() => {
  const p = myPresence.value
  if (!p?.updated_at) return false
  const t = new Date(p.updated_at).getTime()
  if (!t || Number.isNaN(t)) return false
  return (Date.now() - t) <= PRESENCE_STALE_MS
})

const effectiveNowPlaying = computed(() => {
  if (nowPlaying.value?.title) return { ...nowPlaying.value, source: 'local' }
  const p = myPresence.value
  if (isPresenceFresh.value && p?.track_title) {
    return {
      id: p.track_id ?? null,
      title: p.track_title ?? null,
      artist: p.artist ?? null,
      source: 'presence'
    }
  }
  return { id: null, title: null, artist: null, source: 'none' }
})

function setShareOnMap(value) {
  shareOnMap.value = value
  localStorage.setItem('musicmap_share', value ? 'true' : 'false')
}

function saveLastPosition(lat, lng) {
  localStorage.setItem('musicmap_lastpos', JSON.stringify({ lat, lng }))
}

const others = ref([])

const isPositionReady = computed(() => typeof myLat.value === 'number' && typeof myLng.value === 'number')
const currentUserId = ref(null)

let map = null
let myMarker = null
let watchId = null
let presenceInterval = null
let realtimeChannel = null
let reactionsChannel = null
const otherMarkers = new Map()

const lastReactionByUser = new Map()
const usernameCache = new Map()

function setLastReaction(toUserId, emoji, fromUserId = null, fromUsername = null, createdAt = null) {
  if (!toUserId || !emoji) return
  lastReactionByUser.set(String(toUserId), {
    emoji: String(emoji),
    from_user_id: fromUserId ? String(fromUserId) : null,
    from_username: fromUsername ? String(fromUsername) : null,
    created_at: createdAt || null
  })
}

function getLastReaction(toUserId) {
  return lastReactionByUser.get(String(toUserId || '')) || null
}

async function resolveUsername(userId) {
  if (!userId) return null
  const key = String(userId)
  if (usernameCache.has(key)) return usernameCache.get(key)

  const { data, error } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', key)
    .maybeSingle()

  if (error) {
    console.warn('resolveUsername error', error)
    return null
  }

  const name = data?.username || null
  if (name) usernameCache.set(key, name)
  return name
}

async function ensureReactionSenderName(toUserId, fromUserId) {
  if (!toUserId || !fromUserId) return
  const cur = getLastReaction(toUserId)
  if (!cur || cur.from_username) return

  const name = await resolveUsername(fromUserId)
  if (!name) return

  const next = { ...cur, from_username: name }
  lastReactionByUser.set(String(toUserId), next)
  refreshPopupForUser(toUserId)
}

async function fetchLatestReactionsForVisibleUsers() {
  const ids = [
    currentUserId.value,
    ...others.value.map(o => o.user_id).filter(Boolean)
  ].filter(Boolean)

  if (!ids.length) return

  const { data, error } = await supabase
    .from('map_reactions')
    .select('to_user_id, from_user_id, emoji, track_id, created_at')
    .in('to_user_id', ids)
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) {
    console.warn('fetchLatestReactions error', error)
    return
  }

  const seen = new Set()
  for (const r of (data || [])) {
    if (!r?.to_user_id || !r?.emoji) continue
    const key = String(r.to_user_id)
    if (seen.has(key)) continue
    seen.add(key)

    setLastReaction(r.to_user_id, r.emoji, r.from_user_id, null, r.created_at)
    refreshPopupForUser(r.to_user_id)
    ensureReactionSenderName(r.to_user_id, r.from_user_id).catch(() => {})
  }
}

function refreshPopupForUser(userId) {
  if (!userId) return

  if (userId === currentUserId.value) {
    if (myMarker) {
      const popup = myMarker.getPopup()
      if (popup) popup.setHTML(myPopupHtml())
    }
    return
  }

  const m = otherMarkers.get(userId)
  const u = others.value.find(x => x.user_id === userId)
  if (m && u) {
    const popup = m.getPopup()
    if (popup) popup.setHTML(makePopupHtml(u))
  }
}

function subscribeReactionsRealtime() {
  if (reactionsChannel) return

  reactionsChannel = supabase
    .channel('realtime:map_reactions')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'map_reactions' },
      (payload) => {
        const r = payload.new
        if (!r?.to_user_id || !r?.emoji) return

        setLastReaction(r.to_user_id, r.emoji, r.from_user_id, null, r.created_at)
        refreshPopupForUser(r.to_user_id)
        ensureReactionSenderName(r.to_user_id, r.from_user_id).catch(() => {})

        if (r.to_user_id === currentUserId.value) {
          showReactionToast(`${r.emoji} alguien reaccionó a tu audio`)
        }
      }
    )
    .subscribe()
}

let fetchInterval = null
let reconnectTimeout = null
const FETCH_MS = 45000

let lastPresenceStatus = null
let lastPresenceStatusAt = 0

function logPresenceStatus(status) {
  const now = Date.now()
  if (status !== lastPresenceStatus || (now - lastPresenceStatusAt) > 12000) {
    lastPresenceStatus = status
    lastPresenceStatusAt = now
    console.warn('[presence] realtime status:', status)
  }
}

function clearReconnect() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout)
    reconnectTimeout = null
  }
}

function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

function spreadLatLng(lat, lng, userId) {
  const h = hashString(String(userId || ''))
  const angle = (h % 360) * (Math.PI / 180)
  const r = 0.00018 + (h % 7) * 0.00001
  const dLat = Math.cos(angle) * r
  const dLng = Math.sin(angle) * r
  return [lat + dLat, lng + dLng]
}

function roundCoord(n, decimals = 3) {
  const p = 10 ** decimals
  return Math.round(n * p) / p
}

function escapeHtml(str) {
  if (!str) return ''
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function pickTitle(song) {
  if (!song) return null
  return song.title || song.name || song.song_title || song.track_title || song.filename || null
}

function pickArtist(song) {
  if (!song) return null
  return song.artist ||
    song.username ||
    song.user_name ||
    song.author ||
    song.profiles?.username ||
    song.profile?.username ||
    song.user?.username ||
    null
}

function goToProfile(userId) {
  if (!userId) return
  try {
    router.push({ name: 'profile', params: { id: userId } })
  } catch (e) {
    router.push(`/profile/${userId}`)
  }
}

async function sendReaction(toUserId, emoji, trackId = null) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const fromUserId = session?.user?.id || null
    if (!toUserId || !emoji) return

    const payload = {
      from_user_id: fromUserId,
      to_user_id: toUserId,
      emoji,
      track_id: trackId,
      created_at: new Date().toISOString()
    }

    const { error } = await supabase.from('map_reactions').insert(payload)
    if (error) console.warn('sendReaction (ok si no existe tabla)', error)

    showReactionToast(`${emoji} reacción enviada`)
    setLastReaction(toUserId, emoji, currentUserId.value, 'Tú', new Date().toISOString())
    refreshPopupForUser(toUserId)
  } catch (e) {
    console.warn('sendReaction error', e)
  }
}

async function fetchAudioById(id) {
  if (!id) return null
  const { data, error } = await supabase
    .from('audios')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('fetch audio error', error)
    return null
  }
  return data || null
}

async function playFromTrackId(trackId) {
  if (!trackId) return

  const cur = getCurrentSong()
  const curId = cur?.id ?? cur?.song_id ?? null

  if (curId === trackId) {
    if (player.isPlaying) {
      if (player.audio) {
        player.audio.pause()
        player.isPlaying = false
      }
    } else {
      if (player.audio) {
        player.audio.play()
        player.isPlaying = true
      }
    }
    return
  }

  const row = await fetchAudioById(trackId)
  if (!row) {
    console.warn('No se encontró el audio para track_id:', trackId)
    showReactionToast('⚠️ Ese audio ya no existe')

    if (trackId === (myPresence.value?.track_id ?? null)) {
      myPresence.value = null
      clearMyTrackInPresence().catch(() => {})
      updateMyPopup()
    }
    return
  }

  await player.playSong?.(row)
}

function getCurrentSong() {
  const song =
    player.currentSong ||
    player.current ||
    player.song ||
    player.nowPlaying ||
    player.track ||
    null
  return song
}

function setupGlobalHandlers() {
  window.__mmPlayTrack__ = (trackId) => playFromTrackId(trackId)
  window.__mmReact__ = (userId, emoji, trackId) => sendReaction(userId, emoji, trackId || null)
  window.__mmGoProfile__ = (userId) => goToProfile(userId)
}

function makePopupHtml(u) {
  const hasTitle = !!(u.track_title && String(u.track_title).trim())

  const title = hasTitle
    ? `🎧 <strong>${escapeHtml(u.track_title)}</strong>`
    : '🔇 <strong>Sin audio</strong>'

  const artist = (hasTitle && u.artist && String(u.artist).trim())
    ? `<div style="opacity:.75;font-weight:600;margin-top:2px;font-size:13px">${escapeHtml(u.artist)}</div>`
    : (hasTitle
        ? '<div style="opacity:.5;font-size:12px;margin-top:4px">(sin datos del artista)</div>'
        : '<div style="opacity:.5;font-size:12px;margin-top:4px">No hay canción disponible</div>')

  const theirTime = (typeof u.tz_offset_min === 'number')
    ? `<div class="mm-theirtime" data-offset="${u.tz_offset_min}" style="opacity:.6;font-size:11px;margin-top:6px">🕒 hora local ${formatFromOffsetMinutes(u.tz_offset_min)}</div>`
    : ''

  const playBtn = u.track_id
    ? `<button class="mm-play-btn" onclick="window.__mmPlayTrack__('${escapeHtml(u.track_id)}')">▶️ Escuchar</button>`
    : ''

  const reactions = ['🔥', '😍', '😂', '👏', '😮', '😭']
  const reactsHtml = `
    <div class="mm-reacts" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
      ${reactions
        .map(
          (e) => `
        <button
          class="mm-react-btn"
          onclick="window.__mmReact__('${escapeHtml(u.user_id)}', '${e}', '${escapeHtml(u.track_id || '')}')"
          title="Reaccionar ${e}"
        >${e}</button>`
        )
        .join('')}
    </div>
  `

  const last = getLastReaction(u.user_id)
  const who = last?.from_username
    ? ` de <strong>${escapeHtml(last.from_username)}</strong>`
    : (last?.from_user_id ? ' de alguien' : '')

  const lastHtml = last?.emoji
    ? `<div style="margin-top:8px;opacity:.75;font-size:12px;font-weight:800">✨ Reacción: <span style="font-size:16px">${escapeHtml(last.emoji)}</span>${who}</div>`
    : ''

  const btn = `<button class="mm-profile-btn" onclick="window.__mmGoProfile__('${escapeHtml(u.user_id)}')">Ver perfil</button>`
  return `<div class="mm-popup">${title}${artist}${theirTime}${playBtn}${reactsHtml}${lastHtml}${btn}</div>`
}

function myPopupHtml() {
  const song = getCurrentSong()
  const isPlaying = player.isPlaying

  const lastMine = getLastReaction(currentUserId.value)
  const whoMine = lastMine?.from_username
    ? ` de <strong>${escapeHtml(lastMine.from_username)}</strong>`
    : (lastMine?.from_user_id ? ' de alguien' : '')

  const mineReactionHtml = lastMine?.emoji
    ? `<div style="margin-top:8px;opacity:.75;font-size:12px;font-weight:900">✨ Reacción: <span style="font-size:16px">${escapeHtml(lastMine.emoji)}</span>${whoMine}</div>`
    : ''

  if (song && isPlaying) {
    const t = pickTitle(song)
    const a = pickArtist(song)
    const title = t ? `🎧 <strong>${escapeHtml(t)}</strong>` : '🎧 <strong>Escuchando…</strong>'
    const artist = a ? `<div style="opacity:.75;font-weight:600;margin-top:2px;font-size:13px">${escapeHtml(a)}</div>` : ''
    return `<div class="mm-popup">${title}${artist}<div style="opacity:.5;font-size:11px;margin-top:6px">📍 Tú</div>${mineReactionHtml}</div>`
  }

  if (song) {
    const t = pickTitle(song)
    const a = pickArtist(song)
    const title = t ? `⏸️ <strong>${escapeHtml(t)}</strong>` : '📍 <strong>Tú</strong>'
    const artist = a ? `<div style="opacity:.75;font-weight:600;margin-top:2px;font-size:13px">${escapeHtml(a)}</div>` : ''
    return `<div class="mm-popup">${title}${artist}<div style="opacity:.5;font-size:11px;margin-top:6px">⏸️ Pausado</div>${mineReactionHtml}</div>`
  }

  const p = myPresence.value
  if (isPresenceFresh.value && p?.track_title) {
    const title = `🎧 <strong>${escapeHtml(p.track_title)}</strong>`
    const artist = p.artist ? `<div style="opacity:.75;font-weight:600;margin-top:2px;font-size:13px">${escapeHtml(p.artist)}</div>` : ''
    const hint = `<div style="opacity:.5;font-size:11px;margin-top:6px">📱 Sonando en otro dispositivo</div>`
    return `<div class="mm-popup">${title}${artist}${hint}${mineReactionHtml}</div>`
  }

  return `<div class="mm-popup"><strong>📍 Tú</strong><div style="opacity:.6;font-size:12px;margin-top:4px">Sin reproducir</div>${mineReactionHtml}</div>`
}

function initMap(lat, lng) {
  if (map) return

  const container = document.getElementById('maplibre-map')
  if (!container) {
    console.warn('⚠️ Map container not found, retrying...')
    setTimeout(() => initMap(lat, lng), 100)
    return
  }

  map = new maplibregl.Map({
    container: 'maplibre-map',
    style: 'https://api.maptiler.com/maps/streets-v2-dark/style.json?key=vcBhfHo0odyStYxe6Yie',
    center: [lng, lat],
    zoom: 15,
    pitch: 50,
    bearing: -17.6,
    antialias: true
  })

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')

  map.on('load', () => {
    const layers = map.getStyle().layers
    const labelLayerId = layers.find(
      (layer) => layer.type === 'symbol' && layer.layout['text-field']
    )?.id

    map.addLayer(
      {
        id: '3d-buildings',
        source: 'openmaptiles',
        'source-layer': 'building',
        type: 'fill-extrusion',
        minzoom: 14,
        paint: {
          'fill-extrusion-color': [
            'interpolate',
            ['linear'],
            ['get', 'render_height'],
            0, '#1a1a2e',
            20, '#16213e',
            40, '#0f3460',
            80, '#533483',
            150, '#e94560'
          ],
          'fill-extrusion-height': [
            'interpolate',
            ['linear'],
            ['zoom'],
            14, 0,
            14.5, ['get', 'render_height']
          ],
          'fill-extrusion-base': [
            'interpolate',
            ['linear'],
            ['zoom'],
            14, 0,
            14.5, ['get', 'render_min_height']
          ],
          'fill-extrusion-opacity': 0.9
        }
      },
      labelLayerId
    )

    const myEl = document.createElement('div')
    myEl.className = 'pulse-marker you'
    myEl.innerHTML = '🎧'

    const myPopup = new maplibregl.Popup({ offset: 25, closeButton: true })
      .setHTML(myPopupHtml())

    myMarker = new maplibregl.Marker({ element: myEl, anchor: 'center' })
      .setLngLat([lng, lat])
      .setPopup(myPopup)
      .addTo(map)

    mapReady.value = true

    if (others.value.length) {
      for (const u of others.value) upsertOtherMarker(u)
    }
  })
}

function updateMyMarker(lat, lng) {
  if (!map || !myMarker) return
  myMarker.setLngLat([lng, lat])
}

function updateMyPopup() {
  if (!myMarker) return
  const popup = myMarker.getPopup()
  if (popup) popup.setHTML(myPopupHtml())

  const song = getCurrentSong()
  if (song) {
    nowPlaying.value = {
      id: song.id ?? null,
      title: pickTitle(song),
      artist: pickArtist(song)
    }
  } else {
    nowPlaying.value = { id: null, title: null, artist: null }
  }
}

function upsertOtherMarker(u) {
  if (!map) return
  if (!u?.user_id || typeof u.lat !== 'number' || typeof u.lng !== 'number') return
  if (u.user_id === currentUserId.value) return

  const [lat2, lng2] = spreadLatLng(u.lat, u.lng, u.user_id)

  const existing = otherMarkers.get(u.user_id)
  if (existing) {
    existing.setLngLat([lng2, lat2])
    const popup = existing.getPopup()
    if (popup) popup.setHTML(makePopupHtml(u))
    return
  }

  const el = document.createElement('div')
  el.className = 'pulse-marker other'
  el.innerHTML = '🎵'

  const popup = new maplibregl.Popup({ offset: 25, closeButton: true })
    .setHTML(makePopupHtml(u))

  const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
    .setLngLat([lng2, lat2])
    .setPopup(popup)
    .addTo(map)

  otherMarkers.set(u.user_id, marker)
}

function removeOtherMarker(userId) {
  const m = otherMarkers.get(userId)
  if (m) m.remove()
  otherMarkers.delete(userId)
}

function pruneOldOthers(maxAgeMs = 2 * 60 * 1000) {
  const now = Date.now()
  const keep = []
  for (const u of others.value) {
    const t = u.updated_at ? new Date(u.updated_at).getTime() : 0
    if (t && (now - t) <= maxAgeMs) keep.push(u)
    else removeOtherMarker(u.user_id)
  }
  others.value = keep
}

async function ensureAuth() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    router.push('/')
    return false
  }
  currentUserId.value = session.user.id
  return true
}

function startGeolocation() {
  const hasStored = typeof myLat.value === 'number' && typeof myLng.value === 'number'
  const centerLat = hasStored ? myLat.value : DEFAULT_CENTER.lat
  const centerLng = hasStored ? myLng.value : DEFAULT_CENTER.lng

  if (!map) {
    initMap(centerLat, centerLng)
  }

  if (!('geolocation' in navigator)) {
    geoStatus.value = 'error'
    geoMessage.value = 'Geolocalización no disponible en este navegador.'
    return
  }

  if (!isSecureOrigin()) {
    geoStatus.value = 'insecure'
    geoMessage.value = 'En iPhone (Safari) la ubicación solo funciona en HTTPS.'
    return
  }

  geoStatus.value = 'requesting'
  geoMessage.value = 'Pidiendo permisos de ubicación…'

  let didSetView = false

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords
      const lat = roundCoord(latitude, 3)
      const lng = roundCoord(longitude, 3)

      myLat.value = lat
      myLng.value = lng
      saveLastPosition(lat, lng)

      updateMyMarker(lat, lng)
      if (map && !didSetView) {
        map.flyTo({ center: [lng, lat], zoom: 16, pitch: 55, bearing: 0, duration: 2000 })
        didSetView = true
      }

      geoStatus.value = 'ok'
      geoMessage.value = ''

      if (shareOnMap.value) upsertMyPresence().catch(console.error)
    },
    (err) => {
      if (err?.code === 1) {
        geoStatus.value = 'denied'
        geoMessage.value = 'Permiso de ubicación denegado.'
      } else {
        geoStatus.value = 'error'
        geoMessage.value = 'No se pudo obtener la ubicación.'
      }
      console.warn('Geolocation getCurrentPosition error', err)
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 12000 }
  )

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords
      const lat = roundCoord(latitude, 3)
      const lng = roundCoord(longitude, 3)

      myLat.value = lat
      myLng.value = lng
      saveLastPosition(lat, lng)

      updateMyMarker(lat, lng)
      if (map && !didSetView) {
        map.flyTo({ center: [lng, lat], zoom: 16, pitch: 55, bearing: 0, duration: 2000 })
        didSetView = true
      }

      geoStatus.value = 'ok'
      geoMessage.value = ''

      if (shareOnMap.value) upsertMyPresence().catch(console.error)
    },
    (err) => {
      if (err?.code === 1) {
        geoStatus.value = 'denied'
        geoMessage.value = 'Permiso de ubicación denegado.'
      } else {
        geoStatus.value = 'error'
        geoMessage.value = 'Error de ubicación.'
      }
      console.warn('Geolocation watchPosition error', err)
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
  )
}

async function upsertMyPresence() {
  const hasPos = isPositionReady.value
  const fallbackPos = JSON.parse(localStorage.getItem('musicmap_lastpos') || 'null')
  const safeLat = hasPos ? myLat.value : (fallbackPos?.lat ?? DEFAULT_CENTER.lat)
  const safeLng = hasPos ? myLng.value : (fallbackPos?.lng ?? DEFAULT_CENTER.lng)

  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user?.id) {
    geoMessage.value = '⚠️ Sesión caducada. Vuelve a iniciar sesión.'
    setShareOnMap(false)
    return
  }

  currentUserId.value = session.user.id

  const song = getCurrentSong()
  const normalized = player.nowPlaying || null
  const src = normalized || song

  const title = src ? pickTitle(src) : null
  const artist = src ? pickArtist(src) : null
  const trackId = (normalized?.id ?? song?.id ?? null)

  const payload = {
    user_id: currentUserId.value,
    lat: safeLat,
    lng: safeLng,
    visibility: !!shareOnMap.value,
    tz_offset_min: -new Date().getTimezoneOffset(),
    updated_at: new Date().toISOString()
  }

  if (trackId) payload.track_id = trackId
  if (title && String(title).trim()) payload.track_title = title
  if (artist && String(artist).trim()) payload.artist = artist

  const { error } = await supabase
    .from('user_presence')
    .upsert(payload, { onConflict: 'user_id' })

  if (error) {
    console.error('upsert presence error', error)
    if (error.status === 401 || error.status === 403) {
      geoMessage.value = '⚠️ Error de permisos. Re-loguea.'
      setShareOnMap(false)
    }
  }
}

async function setPresenceInvisible() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user?.id) return
  currentUserId.value = session.user.id

  await supabase
    .from('user_presence')
    .upsert(
      { user_id: currentUserId.value, visibility: false, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
}

async function clearMyTrackInPresence() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user?.id) return
  currentUserId.value = session.user.id

  const { error } = await supabase
    .from('user_presence')
    .upsert(
      {
        user_id: currentUserId.value,
        track_id: null,
        track_title: null,
        artist: null,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id' }
    )

  if (error) console.warn('clearMyTrackInPresence error', error)
}

async function fetchMyPresence() {
  if (!currentUserId.value) return
  const { data, error } = await supabase
    .from('user_presence')
    .select('user_id, track_id, track_title, artist, tz_offset_min, updated_at, visibility')
    .eq('user_id', currentUserId.value)
    .maybeSingle()

  if (error) {
    console.warn('fetchMyPresence error', error)
    return
  }

  if (!data) {
    myPresence.value = null
    return
  }

  myPresence.value = {
    track_id: data.track_id,
    track_title: data.track_title,
    artist: data.artist,
    tz_offset_min: data.tz_offset_min,
    updated_at: data.updated_at,
    visibility: data.visibility
  }

  if (myPresence.value?.track_id) {
    const exists = await fetchAudioById(myPresence.value.track_id)
    if (!exists) {
      myPresence.value = null
      clearMyTrackInPresence().catch(() => {})
    }
  }

  updateMyPopup()
}

async function fetchNearby() {
  const { data, error } = await supabase
    .from('user_presence')
    .select('user_id, lat, lng, track_id, track_title, artist, tz_offset_min, updated_at, visibility')
    .eq('visibility', true)
    .limit(250)

  if (error) {
    console.error('fetch presence error', error)
    return
  }

  // Limpieza anti "canción fantasma": valida track_id contra tabla audios
  const trackIds = Array.from(
    new Set((data || []).map(r => r?.track_id).filter(Boolean).map(String))
  )

  let existingTrackIds = new Set()
  if (trackIds.length) {
    const { data: audiosData, error: audiosErr } = await supabase
      .from('audios')
      .select('id')
      .in('id', trackIds)

    if (audiosErr) {
      console.warn('fetchNearby: error validando audios', audiosErr)
    } else {
      existingTrackIds = new Set((audiosData || []).map(a => String(a.id)))
    }
  }

  const cleaned = (data || []).map(r => {
    const tid = r?.track_id ? String(r.track_id) : null
    if (tid && !existingTrackIds.has(tid)) {
      return { ...r, track_id: null, track_title: null, artist: null }
    }
    return r
  })

  const mine = (cleaned || []).find(u => u?.user_id === currentUserId.value)
  if (mine && mine.visibility !== false) {
    myPresence.value = {
      track_id: mine.track_id,
      track_title: mine.track_title,
      artist: mine.artist,
      tz_offset_min: mine.tz_offset_min,
      updated_at: mine.updated_at,
      visibility: mine.visibility
    }
  } else {
    if (mine && mine.visibility === false) myPresence.value = null
  }

  const now = Date.now()
  const maxAgeMs = 2 * 60 * 1000

  others.value = (cleaned || [])
    .filter(u => u?.user_id && u.user_id !== currentUserId.value)
    .filter(u => {
      const t = u.updated_at ? new Date(u.updated_at).getTime() : 0
      return !t || (now - t) <= maxAgeMs
    })

  if (map) {
    for (const u of others.value) upsertOtherMarker(u)
    pruneOldOthers(maxAgeMs)
  }
  fetchLatestReactionsForVisibleUsers().catch(() => {})
}

function subscribeRealtime() {
  if (realtimeChannel) return
  realtimeChannel = supabase
    .channel('realtime:user_presence')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user_presence' }, (payload) => {
      const row = payload.new || payload.old
      if (!row?.user_id) return

      if (row.user_id === currentUserId.value) {
        if (payload.eventType === 'DELETE') {
          myPresence.value = null
        } else {
          myPresence.value = {
            track_id: row.track_id,
            track_title: row.track_title,
            artist: row.artist,
            tz_offset_min: row.tz_offset_min,
            updated_at: row.updated_at,
            visibility: row.visibility
          }
        }

        if (myPresence.value?.track_id) {
          fetchAudioById(myPresence.value.track_id).then((exists) => {
            if (!exists) {
              myPresence.value = null
              clearMyTrackInPresence().catch(() => {})
              updateMyPopup()
            }
          }).catch(() => {})
        }

        updateMyPopup()
        return
      }

      if (payload.eventType === 'DELETE' || row.visibility === false) {
        others.value = others.value.filter(u => u.user_id !== row.user_id)
        removeOtherMarker(row.user_id)
        return
      }

      const u = {
        user_id: row.user_id,
        lat: row.lat,
        lng: row.lng,
        track_id: row.track_id,
        track_title: row.track_title,
        artist: row.artist,
        tz_offset_min: row.tz_offset_min,
        updated_at: row.updated_at,
        visibility: row.visibility
      }

      const idx = others.value.findIndex(x => x.user_id === u.user_id)
      if (idx >= 0) others.value[idx] = u
      else others.value.push(u)

      upsertOtherMarker(u)
      pruneOldOthers()
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        fetchNearby().catch(console.error)
      }
      if (status === 'TIMED_OUT' || status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        logPresenceStatus(status)
        if (!reconnectTimeout) reconnectRealtimeSoon(status)
      }
    })
}

function startFetchLoop() {
  stopFetchLoop()
  fetchInterval = setInterval(() => {
    fetchNearby().catch(console.error)
    fetchMyPresence().catch(() => {})
  }, FETCH_MS)
}

function stopFetchLoop() {
  if (fetchInterval) {
    clearInterval(fetchInterval)
    fetchInterval = null
  }
}

async function reconnectRealtimeSoon(reason = '') {
  clearReconnect()
  lastPresenceStatus = null
  lastPresenceStatusAt = 0

  reconnectTimeout = setTimeout(async () => {
    try {
      if (realtimeChannel) {
        await supabase.removeChannel(realtimeChannel)
        realtimeChannel = null
      }
    } catch (e) {}

    try {
      subscribeRealtime()
      await fetchNearby()
    } catch (e) {
      console.warn('reconnectRealtimeSoon failed', reason, e)
    }
  }, 1200)
}

function onFocusRefresh() {
  fetchNearby().catch(console.error)
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') {
    fetchNearby().catch(console.error)
  }
}

function startPresenceLoop() {
  presenceInterval = setInterval(() => {
    upsertMyPresence().catch(console.error)
    pruneOldOthers()
  }, 15000)
}

async function toggleShare() {
  setShareOnMap(!shareOnMap.value)

  if (shareOnMap.value) {
    await upsertMyPresence()
    return
  }

  await upsertMyPresence()
}

function toggleMyPlayback() {
  const song = getCurrentSong()
  if (!song) return

  if (player.audio) {
    if (player.isPlaying) {
      player.audio.pause()
      if (typeof player.isPlaying !== 'undefined') {
        player.isPlaying = false
      }
    } else {
      player.audio.play().catch(console.error)
      if (typeof player.isPlaying !== 'undefined') {
        player.isPlaying = true
      }
    }
  } else {
    if (player.isPlaying) {
      player.pause?.() || player.togglePlay?.()
    } else {
      player.play?.() || player.resume?.() || player.togglePlay?.()
    }
  }
}

function stopMyPlayback() {
  if (player.audio) {
    player.audio.pause()
    player.audio.currentTime = 0
  }

  if (player.stopSong) player.stopSong()
  else if (player.stop) player.stop()
  else if (player.clear) player.clear()

  clearMyTrackInPresence().catch(() => {})

  nowPlaying.value = { id: null, title: null, artist: null }
  updateMyPopup()

  if (shareOnMap.value) {
    upsertMyPresence().catch(() => {})
  }
}

function nextMySong() {
  if (player.nextSong) {
    player.nextSong()
    return
  }
}

function centerOnMe() {
  if (map && myLat.value && myLng.value) {
    map.flyTo({
      center: [myLng.value, myLat.value],
      zoom: 17,
      pitch: 60,
      bearing: 0,
      duration: 1500
    })
    if (myMarker) {
      const popup = myMarker.getPopup()
      if (popup && !popup.isOpen()) myMarker.togglePopup()
    }
  }
}

function tiltMore() {
  if (!map) return
  const currentPitch = map.getPitch()
  map.easeTo({ pitch: Math.min(currentPitch + 15, 85), duration: 500 })
}

function tiltLess() {
  if (!map) return
  const currentPitch = map.getPitch()
  map.easeTo({ pitch: Math.max(currentPitch - 15, 0), duration: 500 })
}

function rotateMap() {
  if (!map) return
  const currentBearing = map.getBearing()
  map.easeTo({ bearing: currentBearing + 45, duration: 500 })
}

function stopAll() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId)
    watchId = null
  }
  stopFetchLoop()
  clearReconnect()
  window.removeEventListener('focus', onFocusRefresh)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('online', onFocusRefresh)
  if (presenceInterval) {
    clearInterval(presenceInterval)
    presenceInterval = null
  }
  if (reactionsChannel) {
    supabase.removeChannel(reactionsChannel)
    reactionsChannel = null
  }
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel)
    realtimeChannel = null
  }
  if (map) {
    map.remove()
    map = null
  }
  otherMarkers.clear()
  if (reactionToastTimer) {
    clearTimeout(reactionToastTimer)
    reactionToastTimer = null
  }
}

watch(
  () => ({
    song: player.currentSong,
    current: player.current,
    playing: player.isPlaying,
    audio: player.audio?.src
  }),
  () => {
    const song = getCurrentSong()

    if (song) {
      nowPlaying.value = {
        id: song.id ?? null,
        title: pickTitle(song),
        artist: pickArtist(song)
      }
    } else {
      nowPlaying.value = { id: null, title: null, artist: null }
    }

    updateMyPopup()

    if (shareOnMap.value) {
      upsertMyPresence().catch(console.error)
    }
  },
  { immediate: true, deep: true }
)

watch(
  () => mapReady.value,
  (ready) => {
    if (!ready) return
    if (!others.value.length) return
    for (const u of others.value) upsertOtherMarker(u)
  }
)

let updateInterval = null

onMounted(async () => {
  setupGlobalHandlers()

  const ok = await ensureAuth()
  if (!ok) return

  player.initUser?.().catch?.(() => {})

  loading.value = false

  await nextTick()

  startGeolocation()
  await fetchNearby()
  await fetchMyPresence()
  await fetchLatestReactionsForVisibleUsers()
  subscribeReactionsRealtime()
  subscribeRealtime()
  startPresenceLoop()
  startFetchLoop()

  window.addEventListener('focus', onFocusRefresh)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('online', onFocusRefresh)

  const song = getCurrentSong()
  if (song) {
    nowPlaying.value = {
      id: song.id ?? null,
      title: pickTitle(song),
      artist: pickArtist(song)
    }
  }

  updateInterval = setInterval(() => {
    const song = getCurrentSong()
    if (song) {
      const newTitle = pickTitle(song)
      const newArtist = pickArtist(song)

      if (nowPlaying.value.title !== newTitle || nowPlaying.value.artist !== newArtist) {
        nowPlaying.value = {
          id: song.id ?? null,
          title: newTitle,
          artist: newArtist
        }
        updateMyPopup()
      }
    } else if (nowPlaying.value.title) {
      nowPlaying.value = { id: null, title: null, artist: null }
      updateMyPopup()
    }
  }, 3000)

  if (shareOnMap.value && isPositionReady.value) {
    await upsertMyPresence()
  }
})

onBeforeUnmount(async () => {
  if (shareOnMap.value) await setPresenceInvisible()
  stopAll()

  if (updateInterval) {
    clearInterval(updateInterval)
    updateInterval = null
  }
})
</script>

<template>
  <section class="music-map">
    <!-- HEADER -->
    <header class="header">
      <button class="back-btn" @click="router.back()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
      </button>
      <div class="header-info">
        <h1>Music Map 3D</h1>
        <p>Descubre qué escuchan cerca</p>
      </div>
    </header>

    <!-- LOADING -->
    <div v-if="loading" class="loading-screen">
      <div class="loader"></div>
      <span>Cargando...</span>
    </div>

    <!-- CONTENT -->
    <div v-else class="content">
      <!-- NOW PLAYING CARD -->
      <div class="now-playing" :class="{ active: effectiveNowPlaying.title }">
        <div class="np-visual">
          <div class="np-icon" :class="{ playing: effectiveNowPlaying.title && player.isPlaying && effectiveNowPlaying.source === 'local' }">
            {{ effectiveNowPlaying.title ? '🎧' : '🔇' }}
          </div>
          <div class="sound-waves" v-if="effectiveNowPlaying.title && player.isPlaying && effectiveNowPlaying.source === 'local'">
            <span></span><span></span><span></span>
          </div>
        </div>

        <div class="np-info">
          <span class="np-label">
            {{
              effectiveNowPlaying.title
                ? (effectiveNowPlaying.source === 'local'
                    ? (player.isPlaying ? 'Escuchando ahora' : 'Pausado')
                    : 'Escuchando en otro dispositivo')
                : 'Sin reproducir'
            }}
          </span>
          <strong class="np-title">{{ effectiveNowPlaying.title || 'Pon música para aparecer' }}</strong>
          <span class="np-artist" v-if="effectiveNowPlaying.artist">{{ effectiveNowPlaying.artist }}</span>
        </div>

        <!-- Controles solo si la canción es local -->
        <div class="np-actions" v-if="effectiveNowPlaying.title && effectiveNowPlaying.source === 'local'">
          <button class="np-action" @click.stop="toggleMyPlayback" :title="player.isPlaying ? 'Pausar' : 'Reanudar'">
            {{ player.isPlaying ? '⏸️' : '▶️' }}
          </button>

          <button class="np-action" @click.stop="nextMySong" title="Siguiente">
            ⏭️
          </button>

          <button class="np-action danger" @click.stop="stopMyPlayback" title="Parar">
            ⏹️
          </button>
        </div>

        <!-- Si viene del presence (otro dispositivo), permite escucharla aquí -->
        <div class="np-actions" v-else-if="effectiveNowPlaying.title && effectiveNowPlaying.source === 'presence'">
          <button class="np-action" @click.stop="playFromTrackId(effectiveNowPlaying.id)" title="Escuchar aquí">
            ▶️
          </button>
        </div>
      </div>

      <!-- STATS + SHARE ROW -->
      <div class="cards-grid">
        <div class="stat-card">
          <span class="stat-icon">📍</span>
          <div class="stat-info">
            <span class="stat-label">Ubicación</span>
            <strong class="stat-value">
              {{
                geoStatus === 'ok' ? 'Activa' :
                geoStatus === 'requesting' ? 'Pidiendo…' :
                geoStatus === 'insecure' ? 'HTTPS requerido' :
                geoStatus === 'denied' ? 'Denegada' :
                'Obteniendo…'
              }}
            </strong>
          </div>
        </div>

        <div class="stat-card">
          <span class="stat-icon">👥</span>
          <div class="stat-info">
            <span class="stat-label">Cerca</span>
            <strong class="stat-value">{{ others.length }}</strong>
          </div>
        </div>

        <div class="share-card" @click="toggleShare">
          <div class="share-icon">{{ shareOnMap ? '🌍' : '🔒' }}</div>
          <span class="share-label">{{ shareOnMap ? 'Visible' : 'Privado' }}</span>
          <div class="toggle-indicator" :class="{ on: shareOnMap }"></div>
        </div>
      </div>

      <div v-if="geoMessage" class="geo-warning">⚠️ {{ geoMessage }}</div>
      <div v-if="reactionToast" class="reaction-toast">{{ reactionToast }}</div>

      <!-- MAP 3D -->
      <div class="map-container">
        <div v-if="!mapReady" class="map-loading">
          <div class="loader"></div>
          <span>{{ isPositionReady ? 'Cargando mapa 3D...' : 'Obteniendo ubicación...' }}</span>
        </div>
        <div id="maplibre-map" class="map"></div>

        <!-- MAP CONTROLS 3D -->
        <div class="map-controls" v-if="mapReady">
          <button class="map-btn" @click="centerOnMe" title="Mi ubicación">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
            </svg>
          </button>
          <button class="map-btn" @click="tiltMore" title="Más inclinación">
            ⬆️
          </button>
          <button class="map-btn" @click="tiltLess" title="Menos inclinación">
            ⬇️
          </button>
          <button class="map-btn" @click="rotateMap" title="Rotar">
            🔄
          </button>
        </div>

        <!-- LEGEND -->
        <div class="map-legend" v-if="mapReady">
          <div class="legend-item">
            <span class="legend-dot you"></span>
            <span>Tú</span>
          </div>
          <div class="legend-item">
            <span class="legend-dot other"></span>
            <span>Otros</span>
          </div>
        </div>
      </div>

      <!-- TIP -->
      <p class="tip">💡 Arrastra para rotar • Pellizca para inclinar • Toca marcadores</p>
    </div>
  </section>
</template>
<style scoped>
/* =====================
   BASE
===================== */
.music-map {
  min-height: 100vh;
  min-height: 100dvh;
  background: linear-gradient(180deg, #0a0a0a 0%, #111 100%);
  color: white;
  padding-top: env(safe-area-inset-top);
  padding-bottom: calc(100px + env(safe-area-inset-bottom));
}

/* =====================
   HEADER
===================== */
.header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(10, 10, 10, 0.85);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.back-btn {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.05);
  color: white;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.back-btn:active {
  transform: scale(0.95);
  background: rgba(255,255,255,0.1);
}

.header-info {
  min-width: 0;
}

.header-info h1 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 800;
  background: linear-gradient(135deg, #22c55e 0%, #8b5cf6 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.header-info p {
  margin: 1px 0 0;
  font-size: 0.8rem;
  opacity: 0.5;
  font-weight: 500;
}

/* =====================
   LOADING
===================== */
.loading-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 60px 20px;
}

.loader {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255,255,255,0.1);
  border-top-color: #22c55e;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* =====================
   CONTENT
===================== */
.content {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* =====================
   NOW PLAYING
===================== */
.now-playing {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 18px;
  transition: all 0.3s ease;
}

.now-playing.active {
  background: linear-gradient(135deg, rgba(34,197,94,0.12) 0%, rgba(139,92,246,0.08) 100%);
  border-color: rgba(34,197,94,0.25);
}

.np-visual {
  position: relative;
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.np-icon {
  font-size: 1.8rem;
  z-index: 1;
}

.np-icon.playing {
  animation: bounce 1s ease infinite;
}

@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}

.sound-waves {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.sound-waves span {
  width: 3px;
  background: rgba(34,197,94,0.4);
  border-radius: 99px;
  animation: wave 0.8s ease-in-out infinite;
}

.sound-waves span:nth-child(1) { animation-delay: 0s; height: 14px; }
.sound-waves span:nth-child(2) { animation-delay: 0.2s; height: 22px; }
.sound-waves span:nth-child(3) { animation-delay: 0.4s; height: 16px; }

@keyframes wave {
  0%, 100% { transform: scaleY(0.5); opacity: 0.4; }
  50% { transform: scaleY(1); opacity: 1; }
}


.np-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.np-actions{
  display:flex;
  gap:8px;
  align-items:center;
  flex-shrink:0;
}

.np-action{
  width: 40px;
  height: 40px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(255,255,255,0.06);
  color: white;
  cursor: pointer;
  display: grid;
  place-items: center;
  font-size: 1.05rem;
  transition: transform .15s ease, background .2s ease;
}

.np-action:active{
  transform: scale(0.95);
  background: rgba(255,255,255,0.10);
}

.np-action.danger{
  background: rgba(239,68,68,0.12);
  border-color: rgba(239,68,68,0.18);
}

.np-action.danger:active{
  background: rgba(239,68,68,0.20);
}

.np-label {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  opacity: 0.45;
  font-weight: 600;
}

.np-title {
  font-size: 0.95rem;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.np-artist {
  font-size: 0.8rem;
  opacity: 0.6;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* =====================
   CARDS GRID
===================== */
.cards-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 10px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 14px;
  text-align: center;
}

.stat-icon {
  font-size: 1.3rem;
}

.stat-info {
  display: flex;
  flex-direction: column;
}

.stat-label {
  font-size: 0.6rem;
  opacity: 0.45;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.2px;
}

.stat-value {
  font-size: 0.8rem;
  font-weight: 700;
}

.share-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 10px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.share-card:active {
  transform: scale(0.97);
}

.share-icon {
  font-size: 1.3rem;
}

.share-label {
  font-size: 0.75rem;
  font-weight: 700;
}

.toggle-indicator {
  width: 32px;
  height: 6px;
  border-radius: 99px;
  background: rgba(255,255,255,0.15);
  position: relative;
  overflow: hidden;
}

.toggle-indicator::after {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  width: 0;
  background: linear-gradient(90deg, #22c55e, #8b5cf6);
  border-radius: 99px;
  transition: width 0.3s ease;
}

.toggle-indicator.on::after {
  width: 100%;
}

/* =====================
   MAP
===================== */
.map-container {
  position: relative;
  border-radius: 20px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 16px 48px rgba(0,0,0,0.4);
}

.map {
  width: 100%;
  height: 52vh;
  min-height: 300px;
}

.map-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(15,15,15,0.95);
  z-index: 10;
}

.map-loading span {
  font-weight: 600;
  opacity: 0.6;
  font-size: 0.9rem;
}

.map-controls {
  position: absolute;
  bottom: 14px;
  right: 10px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.map-btn {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  border: none;
  background: rgba(15,15,15,0.9);
  color: white;
  display: grid;
  place-items: center;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0,0,0,0.35);
  transition: all 0.2s ease;
  backdrop-filter: blur(10px);
  font-size: 1.1rem;
}

.map-btn:active {
  transform: scale(0.95);
  background: rgba(30,30,30,0.95);
}

.map-legend {
  position: absolute;
  bottom: 14px;
  left: 10px;
  z-index: 1000;
  display: flex;
  gap: 12px;
  padding: 8px 12px;
  background: rgba(15,15,15,0.9);
  border-radius: 10px;
  backdrop-filter: blur(10px);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.75rem;
  font-weight: 600;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.25);
}

.legend-dot.you {
  background: #22c55e;
  box-shadow: 0 0 8px rgba(34,197,94,0.5);
}

.legend-dot.other {
  background: #8b5cf6;
  box-shadow: 0 0 8px rgba(139,92,246,0.5);
}

/* =====================
   TIP
===================== */
.tip {
  text-align: center;
  font-size: 0.8rem;
  opacity: 0.4;
  font-weight: 500;
  margin: 4px 0 0;
}

/* =====================
   MARKERS 3D (GLOBAL)
===================== */
:global(.pulse-marker) {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  border: 3px solid white;
  box-shadow: 0 4px 20px rgba(0,0,0,0.4), 0 0 20px rgba(0,0,0,0.2);
  cursor: pointer;
  transition: transform 0.2s ease;
}

:global(.pulse-marker:hover) {
  transform: scale(1.15);
}

:global(.pulse-marker.you) {
  background: linear-gradient(135deg, #22c55e, #16a34a);
  animation: pulse-glow 2s ease-in-out infinite;
}

:global(.pulse-marker.other) {
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
}

@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 4px 20px rgba(0,0,0,0.4), 0 0 20px rgba(34,197,94,0.3); }
  50% { box-shadow: 0 4px 20px rgba(0,0,0,0.4), 0 0 40px rgba(34,197,94,0.6); }
}

/* =====================
   POPUP STYLES (GLOBAL)
===================== */
:global(.maplibregl-popup-content) {
  background: rgba(20, 20, 25, 0.95) !important;
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 16px !important;
  padding: 16px !important;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  color: white;
}

:global(.maplibregl-popup-tip) {
  border-top-color: rgba(20, 20, 25, 0.95) !important;
}

:global(.maplibregl-popup-close-button) {
  color: white !important;
  font-size: 20px;
  padding: 4px 8px;
}

:global(.mm-popup) {
  min-width: 180px;
  font-family: system-ui, -apple-system, sans-serif;
}

:global(.mm-play-btn) {
  margin-top: 10px;
  width: 100%;
  padding: 9px 10px;
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,0.12);
  background: rgba(34,197,94,0.18);
  color: white;
  font-weight: 900;
  cursor: pointer;
}

:global(.mm-play-btn:active) {
  transform: scale(0.98);
}

:global(.mm-profile-btn) {
  margin-top: 10px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(0,0,0,0.12);
  background: rgba(0,0,0,0.06);
  color: white;
  font-weight: 800;
  cursor: pointer;
}

:global(.mm-profile-btn:active) {
  transform: scale(0.98);
}

:global(.mm-react-btn) {
  width: 42px;
  height: 36px;
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,0.12);
  background: rgba(255,255,255,0.08);
  cursor: pointer;
  font-size: 18px;
  display: grid;
  place-items: center;
}

:global(.mm-react-btn:active) {
  transform: scale(0.96);
}

/* =====================
   TABLET (600px+)
===================== */
@media (min-width: 600px) {
  .content {
    max-width: 580px;
    margin: 0 auto;
    padding: 20px;
    gap: 16px;
  }

  .header {
    padding: 18px 24px;
  }

  .header-info h1 {
    font-size: 1.4rem;
  }

  .now-playing {
    padding: 20px;
  }

  .cards-grid {
    gap: 12px;
  }

  .stat-card,
  .share-card {
    padding: 18px 14px;
  }

  .map {
    height: 55vh;
    min-height: 380px;
  }
}

/* =====================
   DESKTOP (900px+)
===================== */
@media (min-width: 900px) {
  .music-map {
    padding-bottom: 40px;
  }

  .content {
    max-width: 720px;
    gap: 18px;
  }

  .header-info h1 {
    font-size: 1.5rem;
  }

  .now-playing {
    padding: 24px;
  }

  .np-icon {
    font-size: 2.2rem;
  }

  .np-title {
    font-size: 1.1rem;
  }

  .map {
    height: 58vh;
    min-height: 450px;
  }

  .map-container {
    border-radius: 24px;
  }
}

/* =====================
   SMALL PHONES
===================== */
@media (max-width: 380px) {
  .header {
    padding: 12px;
    gap: 10px;
  }

  .back-btn {
    width: 38px;
    height: 38px;
  }

  .header-info h1 {
    font-size: 1.1rem;
  }

  .content {
    padding: 10px;
    gap: 10px;
  }

  .now-playing {
    padding: 12px;
    gap: 10px;
  }

  .np-visual {
    width: 44px;
    height: 44px;
  }

  .np-icon {
    font-size: 1.5rem;
  }

  .np-title {
    font-size: 0.85rem;
  }

  .cards-grid {
    gap: 6px;
  }

  .stat-card,
  .share-card {
    padding: 10px 6px;
    border-radius: 12px;
  }

  .stat-icon,
  .share-icon {
    font-size: 1.1rem;
  }

  .stat-value,
  .share-label {
    font-size: 0.7rem;
  }

  .map {
    height: 48vh;
    min-height: 260px;
  }

  .map-container {
    border-radius: 16px;
  }
}

.geo-warning{
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  font-size: .82rem;
  opacity: .85;
}

.reaction-toast{
  position: fixed;
  left: 50%;
  bottom: calc(90px + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  padding: 10px 14px;
  border-radius: 14px;
  background: rgba(0,0,0,0.75);
  border: 1px solid rgba(255,255,255,0.10);
  color: white;
  font-weight: 800;
  font-size: 0.85rem;
  z-index: 9999;
}
</style>