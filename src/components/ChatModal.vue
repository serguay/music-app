
<script setup>
import { ref, watch, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { supabase } from '../lib/supabase'

import nacl from 'tweetnacl'
import { decodeUTF8, encodeUTF8, encodeBase64, decodeBase64 } from 'tweetnacl-util'

// ✅ Soporta base64 y base64url
const normalizeBase64 = (s) => {
  if (!s) return ''
  let out = String(s).trim()
  out = out.replace(/-/g, '+').replace(/_/g, '/')
  const pad = out.length % 4
  if (pad) out += '='.repeat(4 - pad)
  return out
}
const decodeB64Any = (s) => decodeBase64(normalizeBase64(s))

const props = defineProps({
  show: { type: Boolean, default: false },
  authUserId: { type: String, default: null },
  profileUserId: { type: String, default: null },
  profileUsername: { type: String, default: 'Usuario' }
})
const emit = defineEmits(['close'])

const chatText = ref('')
const chatMessages = ref([])
const messagesEl = ref(null)
const inputEl = ref(null)

// ✅ E2EE
const e2eeActive = ref(false)
const e2eeChecked = ref(false)

// ✅ cache de claves
const myPublicKeyB64 = ref(null)
const mySecretKeyB64 = ref(null)
const otherPublicKeyB64 = ref(null)

const e2eeStatusText = computed(() => {
  if (!e2eeChecked.value) return 'Comprobando cifrado…'
  return e2eeActive.value ? '🔒 Cifrado E2EE activo' : '🔓 Cifrado no disponible'
})

/* =========================================================
   ✅ Keypair local + publicar public_key
========================================================= */
const KEYPAIR_LS = 'cmusic:crypto:keypair:v1'

const getOrCreateLocalKeypair = () => {
  try {
    const raw = localStorage.getItem(KEYPAIR_LS)
    if (raw) {
      const obj = JSON.parse(raw)
      if (obj?.publicKey && obj?.secretKey) return obj
    }
  } catch {}

  const kp = nacl.box.keyPair()
  const out = {
    version: 1,
    publicKey: encodeBase64(kp.publicKey),
    secretKey: encodeBase64(kp.secretKey),
    createdAt: new Date().toISOString()
  }

  try {
    localStorage.setItem(KEYPAIR_LS, JSON.stringify(out))
  } catch {}

  return out
}

const ensureMyPublicKey = async () => {
  if (!props.authUserId) return null

  const local = getOrCreateLocalKeypair()
  myPublicKeyB64.value = local.publicKey
  mySecretKeyB64.value = local.secretKey

  const { data, error } = await supabase
    .from('profiles')
    .select('id, public_key')
    .eq('id', props.authUserId)
    .maybeSingle()

  if (error) throw error

  const needsWrite = !data?.id || !data?.public_key || data.public_key !== local.publicKey

  if (needsWrite) {
    const { data: upserted, error: upErr } = await supabase
      .from('profiles')
      .upsert([{ id: props.authUserId, public_key: local.publicKey, public_key_version: 1 }], { onConflict: 'id' })
      .select('public_key')
      .maybeSingle()

    if (upErr) throw upErr
    if (upserted?.public_key) return upserted.public_key

    const { data: after, error: afterErr } = await supabase
      .from('profiles')
      .select('public_key')
      .eq('id', props.authUserId)
      .maybeSingle()

    if (afterErr) throw afterErr
    if (after?.public_key) return after.public_key

    throw new Error('public_key sigue null tras upsert (RLS o schema)')
  }

  return data.public_key
}

const loadOtherPublicKey = async () => {
  if (!props.profileUserId) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('public_key, public_key_version')
    .eq('id', props.profileUserId)
    .maybeSingle()

  if (error) throw error

  otherPublicKeyB64.value = data?.public_key || null
  return otherPublicKeyB64.value
}

const refreshE2EEKeys = async () => {
  try {
    const local = getOrCreateLocalKeypair()
    myPublicKeyB64.value = local.publicKey
    mySecretKeyB64.value = local.secretKey
  } catch {}

  try {
    await ensureMyPublicKey()
  } catch (e) {
    console.warn('⚠️ refreshE2EEKeys: no se pudo asegurar mi public_key:', e)
  }

  try {
    await loadOtherPublicKey()
  } catch (e) {
    console.warn('⚠️ refreshE2EEKeys: no se pudo cargar public_key del otro:', e)
  }

  const hasLocalKeypair = !!(myPublicKeyB64.value && mySecretKeyB64.value)
  e2eeActive.value = !!(otherPublicKeyB64.value && hasLocalKeypair)
  e2eeChecked.value = true

  return { hasLocalKeypair, hasOtherKey: !!otherPublicKeyB64.value }
}

/* =========================================================
   ✅ E2EE NUEVO (recomendado):
   - shared key = nacl.box.before(otherPub, mySecret)
   - cipher = nacl.secretbox(msg, nonce, sharedKey)
   ✅ Así el emisor TAMBIÉN puede leer su propio mensaje
========================================================= */
const getSharedKey = () => {
  if (!otherPublicKeyB64.value) throw new Error('Missing other public key')
  if (!mySecretKeyB64.value) throw new Error('Missing my secret key')

  const theirPub = decodeB64Any(otherPublicKeyB64.value)
  const mySecret = decodeB64Any(mySecretKeyB64.value)
  return nacl.box.before(theirPub, mySecret) // 32 bytes
}

const encryptShared = (plaintext) => {
  const key = getSharedKey()
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
  const msg = decodeUTF8(String(plaintext || ''))

  const boxed = nacl.secretbox(msg, nonce, key)
  if (!boxed) throw new Error('Encryption failed')

  return {
    ciphertext: encodeBase64(boxed),
    nonce: encodeBase64(nonce),
    sender_pubkey: myPublicKeyB64.value, // útil para compat / debug
    enc_algo: 'crypto_secretbox_shared_v1'
  }
}

const decryptShared = (row) => {
  const key = getSharedKey()
  const nonce = decodeB64Any(row.nonce)
  const boxed = decodeB64Any(row.ciphertext)
  const opened = nacl.secretbox.open(boxed, nonce, key)
  if (!opened) return null
  return encodeUTF8(opened)
}

/* =========================================================
   ✅ Compat con mensajes antiguos crypto_box_easy
   (solo los podrá descifrar el receptor, NO el emisor)
========================================================= */
const decryptLegacyBoxEasy = (row) => {
  try {
    if (!mySecretKeyB64.value) return null
    const mySecret = decodeB64Any(mySecretKeyB64.value)
    const senderPub = decodeB64Any(row.sender_pubkey)
    const nonce = decodeB64Any(row.nonce)
    const boxed = decodeB64Any(row.ciphertext)
    const opened = nacl.box.open(boxed, nonce, senderPub, mySecret)
    if (!opened) return null
    return encodeUTF8(opened)
  } catch {
    return null
  }
}

/* =========================================================
   ✅ DESCIFRADO + ocultar lo no-descifrable
========================================================= */
const decorateMessage = (row) => {
  if (!row) return row

  // Si ya trae plaintext (optimista), NO lo tocamos, pero añadimos __song si aplica
  if (row.__plaintext != null) {
    const out = { ...row, __hidden: false }
    // cache de song
    if (out.message_type === 'song') {
      try {
        out.__song = typeof out.__plaintext === 'string' ? JSON.parse(out.__plaintext) : out.__plaintext
      } catch {
        out.__song = null
        out.__hidden = true
      }
    } else {
      out.__song = null
    }
    return out
  }

  // No cifrado
  if (!row.ciphertext || !row.nonce) {
    const t = String(row.text || '')
    const out = { ...row, __plaintext: t, __hidden: !t.trim(), __song: null }
    if (out.message_type === 'song') {
      try {
        out.__song = t ? JSON.parse(t) : null
      } catch {
        out.__song = null
        out.__hidden = true
      }
    }
    return out
  }

  // Cifrado
  let plain = null

  if (row.enc_algo === 'crypto_secretbox_shared_v1') {
    try {
      plain = decryptShared(row)
    } catch {
      plain = null
    }
  } else {
    plain = decryptLegacyBoxEasy(row)
  }

  if (!plain || !String(plain).trim()) {
    return { ...row, __hidden: true, __plaintext: null, __song: null }
  }

  const low = String(plain).toLowerCase()
  if (low.includes('mensaje cifrado') || low.includes('no se pudo descifrar') || String(plain).startsWith('🔒')) {
    return { ...row, __hidden: true, __plaintext: null, __song: null }
  }

  const out = { ...row, __hidden: false, __plaintext: plain, __song: null }

  // cache de song si aplica
  if (out.message_type === 'song') {
    try {
      out.__song = JSON.parse(String(plain))
    } catch {
      out.__song = null
      out.__hidden = true
    }
  }

  return out
}

const getPlainText = (m) => {
  if (!m) return ''
  if (m.__plaintext != null) return String(m.__plaintext || '')
  return String(m.text || '')
}

const visibleChatMessages = computed(() => {
  return (chatMessages.value || []).filter((m) => {
    if (m?.__hidden) return false
    if (m?.message_type === 'song') return true
    const t = String(getPlainText(m) || '').trim()
    return !!t
  })
})

const prepareMessages = async (rows) => {
  await refreshE2EEKeys()
  return (rows || []).map(decorateMessage).filter(m => !m.__hidden)
}

/* =========================================================
   ✅ Check E2EE
========================================================= */
const checkE2EEStatus = async () => {
  e2eeChecked.value = false
  e2eeActive.value = false

  if (!props.authUserId || !props.profileUserId) {
    e2eeChecked.value = true
    return
  }

  try {
    await ensureMyPublicKey()
    await loadOtherPublicKey()
    const hasLocalKeypair = !!(myPublicKeyB64.value && mySecretKeyB64.value)
    e2eeActive.value = !!(otherPublicKeyB64.value && hasLocalKeypair)
  } catch (err) {
    console.warn('⚠️ No se pudo comprobar E2EE:', err)
    e2eeActive.value = false
  } finally {
    e2eeChecked.value = true
  }
}

// ✅ MENÚ MÓVIL
const showMobileMenu = ref(false)
const toggleMobileMenu = () => { showMobileMenu.value = !showMobileMenu.value }
const closeMobileMenu = () => { showMobileMenu.value = false }

/* =========================================================
   ✅ Helpers de fecha (ES)
========================================================= */
const formatDayMonth = (iso) => {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' }) } catch { return '' }
}
const formatDayMonthTime = (iso) => {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const datePart = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })
    const timePart = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return `${datePart} · ${timePart}`
  } catch { return '' }
}
const formatTimeAgo = (iso) => {
  if (!iso) return ''
  try {
    const then = new Date(iso).getTime()
    const now = Date.now()
    const diffMs = Math.max(0, now - then)
    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour
    const month = 30 * day
    const year = 365 * day

    if (diffMs < minute) return 'unos segundos'
    if (diffMs < hour) { const m = Math.floor(diffMs / minute); return `${m} minuto${m === 1 ? '' : 's'}` }
    if (diffMs < day) { const h = Math.floor(diffMs / hour); return `${h} hora${h === 1 ? '' : 's'}` }
    if (diffMs < month) { const d = Math.floor(diffMs / day); return `${d} día${d === 1 ? '' : 's'}` }
    if (diffMs < year) { const mo = Math.floor(diffMs / month); return `${mo} mes${mo === 1 ? '' : 'es'}` }
    const y = Math.floor(diffMs / year)
    return `${y} año${y === 1 ? '' : 's'}`
  } catch { return '' }
}
const isSameDay = (a, b) => {
  if (!a || !b) return false
  const da = new Date(a), db = new Date(b)
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate()
}

/* =========================================================
   ✅ BLOQUEO
========================================================= */
const isUserBlocked = ref(false)
const hasBlockedMe = ref(false)

const checkBlockStatus = async () => {
  if (!props.authUserId || !props.profileUserId) return

  const { data: myBlock } = await supabase
    .from('blocked_users')
    .select('id')
    .eq('blocker_id', props.authUserId)
    .eq('blocked_id', props.profileUserId)
    .maybeSingle()
  isUserBlocked.value = !!myBlock

  const { data: theirBlock } = await supabase
    .from('blocked_users')
    .select('id')
    .eq('blocker_id', props.profileUserId)
    .eq('blocked_id', props.authUserId)
    .maybeSingle()
  hasBlockedMe.value = !!theirBlock
}

const blockUser = async () => {
  closeMobileMenu()
  if (!props.authUserId || !props.profileUserId) return
  const confirmed = confirm(`¿Bloquear a ${props.profileUsername}? Ya no podrán enviarte mensajes.`)
  if (!confirmed) return
  const { error } = await supabase.from('blocked_users').insert([{ blocker_id: props.authUserId, blocked_id: props.profileUserId }])
  if (error) { console.error('❌ Error bloqueando usuario:', error); alert('Error al bloquear usuario'); return }
  isUserBlocked.value = true
}

const unblockUser = async () => {
  closeMobileMenu()
  if (!props.authUserId || !props.profileUserId) return
  const confirmed = confirm(`¿Desbloquear a ${props.profileUsername}?`)
  if (!confirmed) return
  const { error } = await supabase.from('blocked_users').delete().eq('blocker_id', props.authUserId).eq('blocked_id', props.profileUserId)
  if (error) { console.error('❌ Error desbloqueando usuario:', error); alert('Error al desbloquear usuario'); return }
  isUserBlocked.value = false
}

const blockStatusText = computed(() => {
  if (hasBlockedMe.value) return `${props.profileUsername} te ha bloqueado`
  if (isUserBlocked.value) return `Has bloqueado a ${props.profileUsername}`
  return ''
})

/* =========================================================
   ✅ Presencia + estado
========================================================= */
const isProfileUserActive = ref(false)
const lastActiveAt = ref(null)

const isProfileUserTyping = ref(false)
let typingTimeout = null

const profileStatusText = computed(() => {
  if (isProfileUserTyping.value) return 'Escribiendo...'
  if (isProfileUserActive.value) return 'Activo ahora'
  if (lastActiveAt.value) {
    const ago = formatTimeAgo(lastActiveAt.value)
    return ago ? `Conectado hace ${ago}` : 'Desconectado'
  }
  return 'Desconectado'
})

/* =========================================================
   ✅ Canciones
========================================================= */
const showSongPicker = ref(false)
const availableSongs = ref([])
const songSearchQuery = ref('')

let realtimeChannel = null

const roomId = computed(() => {
  if (!props.authUserId || !props.profileUserId) return null
  const ids = [props.authUserId, props.profileUserId].sort()
  return `${ids[0]}_${ids[1]}`
})

const filteredSongs = computed(() => {
  if (!songSearchQuery.value) return availableSongs.value
  const query = songSearchQuery.value.toLowerCase()
  return availableSongs.value.filter(song =>
    song.title?.toLowerCase().includes(query) ||
    song.artist?.toLowerCase().includes(query)
  )
})

const lastMyMessageId = computed(() => {
  const mine = chatMessages.value.filter(m => m.from_user === props.authUserId)
  return mine.length ? mine[mine.length - 1].id : null
})
const lastMyMessageReadAt = computed(() => {
  if (!lastMyMessageId.value) return null
  const msg = chatMessages.value.find(m => m.id === lastMyMessageId.value)
  return msg?.read_at || null
})

/* =========================================================
   ✅ Listening Together (lo de antes)
   (NO lo toco aquí para no romper nada)
========================================================= */
const togetherActive = ref(false)
const togetherSong = ref(null)
const togetherIsPlaying = ref(false)
const togetherPosition = ref(0)

const togetherAudioEl = ref(null)
let togetherSyncTimer = null
let ignoreNextSeek = false

const getSongUrl = (songObj) => songObj?.audio_url || songObj?.media_url || songObj?.audioUrl || ''

const startTogetherLocal = async (songObj, autoplay = true, position = 0) => {
  if (!songObj) return
  togetherSong.value = {
    title: songObj.title || 'Sin título',
    artist: songObj.artist || 'Artista desconocido',
    image_url: songObj.image_url || '',
    media_url: getSongUrl(songObj)
  }
  togetherActive.value = true
  togetherPosition.value = position || 0

  await nextTick()
  const audio = togetherAudioEl.value
  if (!audio) return
  const url = togetherSong.value.media_url
  if (!url) return

  if (audio.src !== url) audio.src = url

  ignoreNextSeek = true
  try { audio.currentTime = Math.max(0, Number(position || 0)) } catch {}
  setTimeout(() => (ignoreNextSeek = false), 250)

  if (autoplay) {
    try { await audio.play(); togetherIsPlaying.value = true; startTogetherSyncLoop() }
    catch { togetherIsPlaying.value = false }
  } else {
    audio.pause()
    togetherIsPlaying.value = false
    stopTogetherSyncLoop()
  }
}

const stopTogetherLocal = () => {
  togetherActive.value = false
  togetherIsPlaying.value = false
  togetherPosition.value = 0
  togetherSong.value = null
  stopTogetherSyncLoop()
  const audio = togetherAudioEl.value
  if (audio) { audio.pause(); audio.src = '' }
}

const startTogetherSyncLoop = () => {
  stopTogetherSyncLoop()
  togetherSyncTimer = setInterval(() => {
    if (!togetherActive.value) return
    if (!togetherIsPlaying.value) return
    const audio = togetherAudioEl.value
    const pos = audio?.currentTime ?? togetherPosition.value
    sendTogetherState({ is_playing: true, position: pos })
  }, 3000)
}
const stopTogetherSyncLoop = () => {
  if (togetherSyncTimer) clearInterval(togetherSyncTimer)
  togetherSyncTimer = null
}

const sendTogetherStart = async (songObj) => {
  if (!realtimeChannel || !props.authUserId) return
  realtimeChannel.send({
    type: 'broadcast',
    event: 'listen_start',
    payload: {
      from_user: props.authUserId,
      song: {
        title: songObj.title || '',
        artist: songObj.artist || '',
        image_url: songObj.image_url || '',
        media_url: getSongUrl(songObj)
      },
      is_playing: true,
      position: 0,
      sent_at: Date.now()
    }
  })
}
const sendTogetherState = async ({ is_playing, position }) => {
  if (!realtimeChannel || !props.authUserId) return
  if (!togetherActive.value) return
  realtimeChannel.send({
    type: 'broadcast',
    event: 'listen_state',
    payload: { from_user: props.authUserId, is_playing: !!is_playing, position: Number(position || 0), sent_at: Date.now() }
  })
}
const sendTogetherStop = async () => {
  if (!realtimeChannel || !props.authUserId) return
  realtimeChannel.send({ type: 'broadcast', event: 'listen_stop', payload: { from_user: props.authUserId, sent_at: Date.now() } })
}
const listenTogether = async (msgOrSong) => {
  const url = getSongUrl(msgOrSong)
  if (!url) { alert('❌ Esta canción no tiene audio_url'); return }
  await startTogetherLocal(msgOrSong, true, 0)
  await sendTogetherStart(msgOrSong)
}
const leaveTogether = async () => { stopTogetherLocal(); await sendTogetherStop() }
const toggleTogetherPlay = async () => {
  const audio = togetherAudioEl.value
  if (!audio) return
  if (audio.paused) {
    try { await audio.play(); togetherIsPlaying.value = true; startTogetherSyncLoop(); await sendTogetherState({ is_playing: true, position: audio.currentTime }) } catch {}
  } else {
    audio.pause()
    togetherIsPlaying.value = false
    stopTogetherSyncLoop()
    await sendTogetherState({ is_playing: false, position: audio.currentTime })
  }
}
const onTogetherSeek = async (e) => {
  const audio = togetherAudioEl.value
  if (!audio) return
  if (ignoreNextSeek) return
  const newPos = Number(e?.target?.value || 0)
  ignoreNextSeek = true
  try { audio.currentTime = newPos } catch {}
  setTimeout(() => (ignoreNextSeek = false), 250)
  togetherPosition.value = newPos
  await sendTogetherState({ is_playing: togetherIsPlaying.value, position: newPos })
}
const onTogetherTimeUpdate = () => {
  const audio = togetherAudioEl.value
  if (!audio) return
  togetherPosition.value = audio.currentTime
}

/* =========================================================
   ✅ DRAG (igual que antes)
========================================================= */
const togetherBarEl = ref(null)
const togetherPos = ref({ x: 14, y: 86 })
const isDraggingTogether = ref(false)
const dragOffset = ref({ x: 0, y: 0 })
const togetherBarStyle = computed(() => ({ left: `${togetherPos.value.x}px`, top: `${togetherPos.value.y}px` }))
const clamp = (n, min, max) => Math.max(min, Math.min(max, n))
const saveTogetherPos = () => {
  try { if (!roomId.value) return; localStorage.setItem(`together_pos_${roomId.value}`, JSON.stringify(togetherPos.value)) } catch {}
}
const loadTogetherPos = () => {
  try {
    if (!roomId.value) return
    const raw = localStorage.getItem(`together_pos_${roomId.value}`)
    if (!raw) return
    const p = JSON.parse(raw)
    if (typeof p?.x === 'number' && typeof p?.y === 'number') togetherPos.value = p
  } catch {}
}
const startDragTogether = (e) => {
  if (!togetherBarEl.value) return
  isDraggingTogether.value = true
  const rect = togetherBarEl.value.getBoundingClientRect()
  dragOffset.value = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  window.addEventListener('pointermove', onDragTogether, { passive: false })
  window.addEventListener('pointerup', stopDragTogether, { passive: true })
}
const onDragTogether = (e) => {
  if (!isDraggingTogether.value || !togetherBarEl.value) return
  e.preventDefault()
  const rect = togetherBarEl.value.getBoundingClientRect()
  const maxX = window.innerWidth - rect.width - 8
  const maxY = window.innerHeight - rect.height - 90
  togetherPos.value = {
    x: clamp(e.clientX - dragOffset.value.x, 8, maxX),
    y: clamp(e.clientY - dragOffset.value.y, 8, maxY)
  }
}
const stopDragTogether = () => {
  if (!isDraggingTogether.value) return
  isDraggingTogether.value = false
  saveTogetherPos()
  window.removeEventListener('pointermove', onDragTogether)
  window.removeEventListener('pointerup', stopDragTogether)
}

/* =========================================================
   ✅ Typing
========================================================= */
const sendTypingEvent = () => {
  if (!realtimeChannel || !props.authUserId || !props.profileUserId) return
  realtimeChannel.send({ type: 'broadcast', event: 'typing', payload: { user_id: props.authUserId, is_typing: true } })
}
const sendStopTypingEvent = () => {
  if (!realtimeChannel || !props.authUserId || !props.profileUserId) return
  realtimeChannel.send({ type: 'broadcast', event: 'typing', payload: { user_id: props.authUserId, is_typing: false } })
}
const onInputTyping = () => {
  sendTypingEvent()
  if (typingTimeout) clearTimeout(typingTimeout)
  typingTimeout = setTimeout(() => { sendStopTypingEvent() }, 2000)
}

/* =========================================================
   ✅ Cargar canciones
========================================================= */
const loadAvailableSongs = async () => {
  try {
    const { data, error } = await supabase
      .from('audios')
      .select('id, user_id, title, artist, audio_url, image_url, created_at')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) throw error
    availableSongs.value = data || []
  } catch (error) {
    console.error('❌ Error cargando canciones:', error)
    availableSongs.value = []
  }
}
const openSongPicker = async () => {
  showSongPicker.value = true
  songSearchQuery.value = ''
  if (availableSongs.value.length === 0) await loadAvailableSongs()
}
const closeSongPicker = () => {
  showSongPicker.value = false
  songSearchQuery.value = ''
}

/* =========================================================
   ✅ Compartir canción (igual, pero cifrando con shared secretbox)
========================================================= */
const shareSong = async (song) => {
  if (!props.authUserId || !props.profileUserId || !roomId.value) return

  const songMessage = {
    type: 'song',
    user_id: song.user_id,
    title: song.title,
    artist: song.artist,
    media_url: song.audio_url || song.media_url || '',
    image_url: song.image_url
  }

  const optimisticId = `optimistic_${Date.now()}`
  const songJson = JSON.stringify(songMessage)

  const optimisticMsg = {
    id: optimisticId,
    room_id: roomId.value,
    from_user: props.authUserId,
    to_user: props.profileUserId,
    text: e2eeActive.value ? null : songJson,
    __plaintext: songJson,
    __song: songMessage,
    message_type: 'song',
    created_at: new Date().toISOString(),
    ciphertext: null,
    nonce: null,
    sender_pubkey: null,
    enc_algo: null
  }

  chatMessages.value.push(optimisticMsg)
  closeSongPicker()
  await scrollBottom()

  let insertRow = { room_id: roomId.value, from_user: props.authUserId, to_user: props.profileUserId, message_type: 'song' }

  if (e2eeActive.value) {
    const { hasLocalKeypair, hasOtherKey } = await refreshE2EEKeys()
    if (!hasLocalKeypair) { chatMessages.value = chatMessages.value.filter(m => m.id !== optimisticId); alert('No se pudo enviar: no tienes tu keypair local listo (E2EE).'); return }
    if (!hasOtherKey) { chatMessages.value = chatMessages.value.filter(m => m.id !== optimisticId); alert('No se pudo enviar: el otro usuario aún no tiene clave pública (E2EE).'); return }

    try {
      const enc = encryptShared(songJson)
      insertRow = { ...insertRow, text: null, ciphertext: enc.ciphertext, nonce: enc.nonce, sender_pubkey: enc.sender_pubkey, enc_algo: enc.enc_algo }
    } catch (e) {
      console.error('❌ No se pudo cifrar (shared):', e)
      chatMessages.value = chatMessages.value.filter(m => m.id !== optimisticId)
      alert('No se pudo enviar: error de cifrado (E2EE).')
      return
    }
  } else {
    insertRow = { ...insertRow, text: songJson }
  }

  const { data: inserted, error } = await supabase
    .from('messages')
    .insert([insertRow])
    .select('id, room_id, from_user, to_user, text, message_type, created_at, read_at, ciphertext, nonce, sender_pubkey, enc_algo')
    .single()

  if (error) {
    console.error('❌ Error compartiendo canción:', error)
    chatMessages.value = chatMessages.value.filter(m => m.id !== optimisticId)
    alert('Error compartiendo canción 😢')
    return
  }

  const idx = chatMessages.value.findIndex(m => m.id === optimisticId)
  if (idx !== -1) {
    inserted.__plaintext = chatMessages.value[idx].__plaintext
    inserted.__song = chatMessages.value[idx].__song || null
    chatMessages.value[idx] = decorateMessage(inserted)
  }
}


const getSongObj = (m) => m?.__song || null

/* =========================================================
   ✅ Cargar chat
========================================================= */
const loadChatFromSupabase = async () => {
  if (!roomId.value) { chatMessages.value = []; return }

  const { data, error } = await supabase
    .from('messages')
    .select('id, room_id, from_user, to_user, text, message_type, created_at, read_at, ciphertext, nonce, sender_pubkey, enc_algo')
    .eq('room_id', roomId.value)
    .order('created_at', { ascending: true })

  if (error) { console.error('❌ Error cargando chat:', error); chatMessages.value = []; return }

  chatMessages.value = await prepareMessages(data || [])
  await scrollBottom()
}

/* =========================================================
   ✅ Realtime
========================================================= */
const startRealtime = () => {
  stopRealtime()
  if (!roomId.value) return

  realtimeChannel = supabase
    .channel(`chat-room-${roomId.value}`, {
      config: { presence: { key: props.authUserId || 'anon' }, broadcast: { ack: false } }
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId.value}` },
      async (payload) => {
        const rawNewMsg = payload.new

        if (chatMessages.value.some(m => m.id === rawNewMsg.id)) {
          if (props.show && rawNewMsg.to_user === props.authUserId) markMessageAsRead(rawNewMsg.id)
          return
        }

        await refreshE2EEKeys()
        const newMsg = decorateMessage(rawNewMsg)
        if (newMsg.__hidden) return

        const optimisticIndex = chatMessages.value.findIndex(m =>
          String(m.id).startsWith('optimistic_') &&
          m.from_user === newMsg.from_user &&
          m.to_user === newMsg.to_user &&
          m.message_type === newMsg.message_type
        )

        if (optimisticIndex !== -1) {
          newMsg.__plaintext = chatMessages.value[optimisticIndex].__plaintext
          newMsg.__song = chatMessages.value[optimisticIndex].__song || null
          chatMessages.value[optimisticIndex] = decorateMessage(newMsg)
          scrollBottom()
        } else {
          chatMessages.value.push(newMsg)
          scrollBottom()
        }

        if (props.show && newMsg.to_user === props.authUserId) markMessageAsRead(newMsg.id)
      }
    )
    .on('presence', { event: 'sync' }, () => {
      const state = realtimeChannel.presenceState()
      const otherOnline = !!(state?.[props.profileUserId]?.length)
      isProfileUserActive.value = otherOnline
      if (otherOnline) lastActiveAt.value = new Date().toISOString()
    })
    .on('presence', { event: 'join' }, ({ key }) => {
      if (key === props.profileUserId) { isProfileUserActive.value = true; lastActiveAt.value = new Date().toISOString() }
    })
    .on('presence', { event: 'leave' }, ({ key }) => {
      if (key === props.profileUserId) { isProfileUserActive.value = false; lastActiveAt.value = new Date().toISOString() }
    })
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload.user_id === props.profileUserId) {
        isProfileUserTyping.value = payload.is_typing
        if (payload.is_typing) setTimeout(() => (isProfileUserTyping.value = false), 3000)
      }
    })
    .on('broadcast', { event: 'listen_start' }, async ({ payload }) => {
      if (!payload) return
      if (payload.from_user === props.authUserId) return
      if (!payload.song?.media_url) return
      await startTogetherLocal(payload.song, payload.is_playing, payload.position || 0)
      togetherIsPlaying.value = !!payload.is_playing
    })
    .on('broadcast', { event: 'listen_state' }, async ({ payload }) => {
      if (!payload) return
      if (payload.from_user === props.authUserId) return
      if (!togetherActive.value) return

      const audio = togetherAudioEl.value
      if (!audio) return

      const newPos = Number(payload.position || 0)
      ignoreNextSeek = true
      try { audio.currentTime = newPos } catch {}
      setTimeout(() => (ignoreNextSeek = false), 250)
      togetherPosition.value = newPos

      if (payload.is_playing) {
        try { await audio.play(); togetherIsPlaying.value = true; startTogetherSyncLoop() } catch {}
      } else {
        audio.pause()
        togetherIsPlaying.value = false
        stopTogetherSyncLoop()
      }
    })
    .on('broadcast', { event: 'listen_stop' }, ({ payload }) => {
      if (!payload) return
      if (payload.from_user === props.authUserId) return
      stopTogetherLocal()
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED' && props.authUserId) {
        try { await realtimeChannel.track({ online_at: new Date().toISOString() }) } catch {}
      }
    })
}

const stopRealtime = () => {
  if (realtimeChannel) {
    sendStopTypingEvent()
    if (typingTimeout) { clearTimeout(typingTimeout); typingTimeout = null }
    realtimeChannel.untrack?.().catch(() => {})
    supabase.removeChannel(realtimeChannel)
    realtimeChannel = null
  }
  isProfileUserTyping.value = false
  stopTogetherSyncLoop()
}

/* =========================================================
   ✅ Scroll
========================================================= */
const scrollBottom = async () => {
  await nextTick()
  if (messagesEl.value) messagesEl.value.scrollTo({ top: messagesEl.value.scrollHeight, behavior: 'smooth' })
}

/* =========================================================
   ✅ Leídos
========================================================= */
const markAllAsRead = async () => {
  if (!roomId.value || !props.authUserId) return
  const unread = chatMessages.value.filter(m => m.to_user === props.authUserId && (!m.read_at && !m.readAt))
  if (!unread.length) return

  const nowIso = new Date().toISOString()

  chatMessages.value = chatMessages.value.map(m => {
    if (m.to_user === props.authUserId && (!m.read_at && !m.readAt)) return { ...m, read_at: nowIso }
    return m
  })

  await supabase
    .from('messages')
    .update({ read_at: nowIso })
    .eq('room_id', roomId.value)
    .eq('to_user', props.authUserId)
    .is('read_at', null)
}

const markMessageAsRead = async (messageId) => {
  if (!messageId || !roomId.value || !props.authUserId) return
  const msg = chatMessages.value.find(m => m.id === messageId)
  if (!msg) return
  if (msg.to_user !== props.authUserId) return
  if (msg.read_at) return

  const nowIso = new Date().toISOString()

  chatMessages.value = chatMessages.value.map(m => (m.id === messageId ? { ...m, read_at: nowIso } : m))

  await supabase
    .from('messages')
    .update({ read_at: nowIso })
    .eq('id', messageId)
    .eq('to_user', props.authUserId)
}

/* =========================================================
   ✅ Enviar mensaje (AHORA cifra con shared secretbox)
========================================================= */
const sendChatMessage = async () => {
  const text = (chatText.value || '').trim()
  if (!text) return
  if (!props.authUserId || !props.profileUserId) return
  if (!roomId.value) return

  if (isUserBlocked.value) { alert(`Has bloqueado a ${props.profileUsername}. Desbloquéalo para poder chatear.`); return }
  if (hasBlockedMe.value) { alert(`${props.profileUsername} te ha bloqueado.`); return }

  sendStopTypingEvent()
  if (typingTimeout) { clearTimeout(typingTimeout); typingTimeout = null }

  const optimisticId = `optimistic_${Date.now()}`
  const optimisticMsg = {
    id: optimisticId,
    room_id: roomId.value,
    from_user: props.authUserId,
    to_user: props.profileUserId,
    text: e2eeActive.value ? null : text,
    __plaintext: text,
    message_type: 'text',
    created_at: new Date().toISOString(),
    ciphertext: null,
    nonce: null,
    sender_pubkey: null,
    enc_algo: null
  }

  chatMessages.value.push(optimisticMsg)
  chatText.value = ''
  await scrollBottom()
  await nextTick()
  inputEl.value?.focus()

  let insertRow = { room_id: roomId.value, from_user: props.authUserId, to_user: props.profileUserId, message_type: 'text' }

  if (e2eeActive.value) {
    const { hasLocalKeypair, hasOtherKey } = await refreshE2EEKeys()
    if (!hasLocalKeypair) { chatMessages.value = chatMessages.value.filter(m => m.id !== optimisticId); alert('No se puede enviar: no tienes tu keypair local listo (E2EE).'); return }
    if (!hasOtherKey) { chatMessages.value = chatMessages.value.filter(m => m.id !== optimisticId); alert('No se puede enviar: el otro usuario aún no tiene clave pública (E2EE).'); return }

    try {
      const enc = encryptShared(text)
      insertRow = { ...insertRow, text: null, ciphertext: enc.ciphertext, nonce: enc.nonce, sender_pubkey: enc.sender_pubkey, enc_algo: enc.enc_algo }
    } catch (e) {
      console.error('❌ No se pudo cifrar (shared):', e)
      chatMessages.value = chatMessages.value.filter(m => m.id !== optimisticId)
      alert('No se puede enviar: error de cifrado (E2EE).')
      return
    }
  } else {
    insertRow = { ...insertRow, text }
  }

  const { data: inserted, error } = await supabase
    .from('messages')
    .insert([insertRow])
    .select('id, room_id, from_user, to_user, text, message_type, created_at, read_at, ciphertext, nonce, sender_pubkey, enc_algo')
    .single()

  if (error) {
    console.error('❌ Error enviando mensaje:', error)
    chatMessages.value = chatMessages.value.filter(m => m.id !== optimisticId)
    alert('Error enviando mensaje 😢')
    return
  }

  const idx = chatMessages.value.findIndex(m => m.id === optimisticId)
  if (idx !== -1) {
    inserted.__plaintext = chatMessages.value[idx].__plaintext
    chatMessages.value[idx] = decorateMessage(inserted)
  }
}

const deleteMessage = async (msg) => {
  if (!msg) return

  if (String(msg.id).startsWith('optimistic_')) {
    chatMessages.value = chatMessages.value.filter(m => m.id !== msg.id)
    return
  }

  if (msg.from_user !== props.authUserId) {
    alert('❌ Solo puedes borrar tus propios mensajes')
    return
  }

  const originalMessages = [...chatMessages.value]
  chatMessages.value = chatMessages.value.filter(m => m.id !== msg.id)

  const { error } = await supabase
    .from('messages')
    .delete()
    .eq('id', msg.id)
    .eq('from_user', props.authUserId)

  if (error) {
    console.error('❌ Error borrando mensaje:', error)
    chatMessages.value = originalMessages
    alert('No se pudo borrar el mensaje')
  }
}

const close = () => {
  // ✅ Cierra cualquier overlay interno antes de cerrar el modal
  showSongPicker.value = false
  closeMobileMenu()

  // ✅ Suelta scroll-lock sí o sí
  try { document.body.style.overflow = '' } catch {}

  emit('close')
}

const onKeyDown = (e) => {
  if (!props.show) return
  if (e.key === 'Escape') {
    if (showSongPicker.value) closeSongPicker()
    else if (showMobileMenu.value) closeMobileMenu()
    else close()
  }
}

onMounted(() => {
  console.log('✅ ChatModal.vue E2EE shared secretbox activo')
  window.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)

  // ✅ Garantiza que nunca nos quedamos con la app “bloqueada” al salir de ruta
  try {
    document.body.style.overflow = ''
    document.body.style.overflowY = ''
    document.body.style.pointerEvents = ''
    document.body.style.filter = ''

    document.documentElement.style.overflow = ''
    document.documentElement.style.overflowY = ''
    document.documentElement.style.pointerEvents = ''
    document.documentElement.style.filter = ''
  } catch {}

  // ✅ Limpia UI interna
  showSongPicker.value = false
  showMobileMenu.value = false

  stopRealtime()
  stopTogetherLocal()
})

watch(
  () => props.show,
  async (v) => {
    if (v) {
      document.body.style.overflow = 'hidden'
      loadTogetherPos()

      await checkBlockStatus()
      await checkE2EEStatus()

      await loadChatFromSupabase()
      await markAllAsRead()
      startRealtime()
      await nextTick()
      await scrollBottom()
      inputEl.value?.focus()
    } else {
      document.body.style.overflow = ''
      stopRealtime()
      showSongPicker.value = false
      closeMobileMenu()
    }
  }
)

watch(
  () => roomId.value,
  async (newRoomId, oldRoomId) => {
    if (newRoomId !== oldRoomId && props.show) {
      loadTogetherPos()
      await checkBlockStatus()
      await checkE2EEStatus()
      await loadChatFromSupabase()
      startRealtime()
    }
  }
)
</script>
<template>
  <Teleport to="body" v-if="show">
    <div class="modal-overlay" @click="close">
      <div class="modal-content" @click.stop>

        <header class="modal-header">
          <div class="header-left">
            <div class="chat-avatar">💬</div>
            <div class="header-titles">
              <h2 class="chat-title">Chat con {{ profileUsername }}</h2>
              <span class="chat-subtitle">
                Privado · Music App ·
                <span class="status-dot" :class="{ on: isProfileUserActive }"></span>
                {{ profileStatusText }}
                · <span class="e2ee-pill" :class="{ on: e2eeActive }">{{ e2eeStatusText }}</span>
              </span>
            </div>
          </div>

          <div class="header-actions">
            <!-- ✅ DESKTOP: botones normales -->
            <button
              v-if="!isUserBlocked && !hasBlockedMe"
              class="block-btn desktop-only"
              title="Bloquear usuario"
              @click="blockUser"
            >
              🚫 Bloquear
            </button>

            <button
              v-if="isUserBlocked"
              class="unblock-btn desktop-only"
              title="Desbloquear usuario"
              @click="unblockUser"
            >
              ✅ Desbloquear
            </button>

            <button class="back-btn desktop-only" title="Volver" @click="close">
              ← Volver
            </button>

            <!-- ✅ MÓVIL: solo menú de 3 puntos -->
            <div class="mobile-menu-container mobile-only">
              <button 
                class="mobile-menu-btn" 
                @click="toggleMobileMenu"
                title="Más opciones"
              >
                ⋮
              </button>

              <div v-if="showMobileMenu" class="mobile-dropdown" @click.stop>
                <button
                  v-if="!isUserBlocked && !hasBlockedMe"
                  class="dropdown-item"
                  @click="blockUser"
                >
                  🚫 Bloquear usuario
                </button>

                <button
                  v-if="isUserBlocked"
                  class="dropdown-item"
                  @click="unblockUser"
                >
                  ✅ Desbloquear usuario
                </button>

                <button
                  class="dropdown-item"
                  @click="close"
                >
                  ← Volver
                </button>
              </div>

              <div 
                v-if="showMobileMenu" 
                class="mobile-menu-backdrop"
                @click="closeMobileMenu"
              ></div>
            </div>
          </div>
        </header>

        <div v-if="blockStatusText" class="block-banner">
          <div class="block-icon">🚫</div>
          <div class="block-text">{{ blockStatusText }}</div>
        </div>

        <div
          v-if="togetherActive"
          ref="togetherBarEl"
          class="together-bar draggable"
          :style="togetherBarStyle"
        >
          <div
            class="together-drag-handle"
            @pointerdown.prevent="startDragTogether"
            title="Arrastra para mover"
          >
            <span class="dots"></span>
            <span class="dots"></span>
            <span class="dots"></span>
          </div>

          <div class="together-left">
            <div
              class="together-cover"
              :style="{
                backgroundImage: togetherSong?.image_url
                  ? `url(${togetherSong.image_url})`
                  : 'linear-gradient(135deg, #667eea, #764ba2)'
              }"
            ></div>

            <div class="together-info">
              <div class="together-title">{{ togetherSong?.title }}</div>
              <div class="together-artist">{{ togetherSong?.artist }}</div>
            </div>
          </div>

          <div class="together-actions">
            <button class="together-btn" @click="toggleTogetherPlay">
              {{ togetherIsPlaying ? '⏸' : '▶️' }}
            </button>

            <button class="together-btn danger" @click="leaveTogether">✕</button>
          </div>

          <div class="together-slider">
            <input
              type="range"
              min="0"
              :max="togetherAudioEl?.duration || 0"
              :value="togetherPosition"
              @input="onTogetherSeek"
            />
          </div>

          <audio
            ref="togetherAudioEl"
            @timeupdate="onTogetherTimeUpdate"
            style="display:none;"
          ></audio>
        </div>

        <main class="modal-body">
          <div class="e2ee-banner" :class="{ off: e2eeChecked && !e2eeActive }">
            <span v-if="!e2eeChecked">🔎 Comprobando cifrado…</span>
            <span v-else-if="e2eeActive">🔒 Este chat está cifrado de extremo a extremo. Solo tú y {{ profileUsername }} podéis leer los mensajes.</span>
            <span v-else>🔓 Cifrado no disponible aún. Asegúrate de que ambos tenéis la clave pública guardada (public_key) y vuelve a iniciar sesión.</span>
          </div>
          <div ref="messagesEl" class="chat-messages">
            <div v-if="!visibleChatMessages.length" class="empty-state">
              <div class="empty-icon">✨</div>
              <p class="empty-title">Empieza el chat</p>
            </div>

            <template v-for="(m, idx) in visibleChatMessages" :key="m.id">
              <div
                v-if="idx === 0 || !isSameDay(m.created_at, visibleChatMessages[idx - 1]?.created_at)"
                class="day-separator"
              >
                <span class="day-separator-pill">
                  {{ formatDayMonth(m.created_at) }}
                </span>
              </div>

              <div class="chat-row" :class="{ me: m.from_user === authUserId }">
                <div
                  v-if="!getSongObj(m)"
                  class="chat-bubble"
                  :class="{ me: m.from_user === authUserId }"
                >
                  <div class="bubble-top">
                    <span class="chat-text">{{ getPlainText(m) }}</span>
                    <button
                      v-if="m.from_user === authUserId"
                      class="msg-delete-btn"
                      title="Borrar mensaje"
                      @click="deleteMessage(m)"
                    >
                      🗑
                    </button>
                  </div>

                  <small class="chat-time">
                    {{ new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
                  </small>

                  <small
                    v-if="m.from_user === authUserId && m.id === lastMyMessageId && lastMyMessageReadAt"
                    class="seen-status"
                  >
                    Visto {{ formatDayMonthTime(lastMyMessageReadAt) }}
                  </small>
                </div>

                <div
                  v-else
                  class="chat-bubble song-bubble"
                  :class="{ me: m.from_user === authUserId }"
                >
                  <div class="song-card">
                    <div
                      class="song-cover"
                      :style="{
                        backgroundImage: getSongObj(m)?.image_url
                          ? `url(${getSongObj(m)?.image_url})`
                          : 'linear-gradient(135deg, #667eea, #764ba2)'
                      }"
                    >
                      <div class="song-play-icon">▶</div>
                    </div>

                    <div class="song-info">
                      <div class="song-title">{{ getSongObj(m)?.title || 'Sin título' }}</div>
                      <div class="song-artist">{{ getSongObj(m)?.artist || 'Artista desconocido' }}</div>

                      <button
                        class="listen-together-btn"
                        @click="listenTogether(getSongObj(m))"
                        title="Escuchar juntos"
                      >
                        🎧 Escuchar juntos
                      </button>
                    </div>

                    <button
                      v-if="m.from_user === authUserId"
                      class="msg-delete-btn"
                      title="Borrar mensaje"
                      @click="deleteMessage(m)"
                    >
                      🗑
                    </button>
                  </div>

                  <small class="chat-time">
                    {{ new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
                  </small>

                  <small
                    v-if="m.from_user === authUserId && m.id === lastMyMessageId && lastMyMessageReadAt"
                    class="seen-status"
                  >
                    Visto {{ formatDayMonthTime(lastMyMessageReadAt) }}
                  </small>
                </div>
              </div>
            </template>

            <div v-if="isProfileUserTyping" class="typing-indicator">
              <div class="typing-bubble">
                <div class="typing-dots">
                  <span></span><span></span><span></span>
                </div>
              </div>
            </div>
          </div>

          <div class="chat-input-row">
            <button 
              class="share-song-btn" 
              title="Compartir canción" 
              @click="openSongPicker"
              :disabled="isUserBlocked || hasBlockedMe"
            >
              🎵
            </button>
            <input
              ref="inputEl"
              v-model="chatText"
              class="input-field chat-input"
              :placeholder="isUserBlocked || hasBlockedMe ? 'No puedes enviar mensajes' : 'Escribe un mensaje…'"
              :disabled="isUserBlocked || hasBlockedMe"
              @input="onInputTyping"
              @keydown.enter.prevent="sendChatMessage"
            />
            <button 
              class="send-btn" 
              @click="sendChatMessage"
              :disabled="isUserBlocked || hasBlockedMe"
            >
              Enviar
            </button>
          </div>
        </main>
      </div>

      <div v-if="showSongPicker" class="song-picker-overlay" @click="closeSongPicker">
        <div class="song-picker-modal" @click.stop>
          <header class="song-picker-header">
            <h3 class="song-picker-title">🎵 Compartir Canción</h3>
            <button class="song-picker-close" @click="closeSongPicker">✕</button>
          </header>

          <div class="song-picker-search">
            <input
              v-model="songSearchQuery"
              type="text"
              class="song-search-input"
              placeholder="Buscar canción o artista..."
            />
          </div>

          <div class="song-picker-list">
            <div v-if="filteredSongs.length === 0" class="no-songs">
              <div class="no-songs-icon">🎵</div>
              <p>No hay canciones disponibles</p>
            </div>

            <div
              v-for="song in filteredSongs"
              :key="song.id"
              class="song-item"
              @click="shareSong(song)"
            >
              <div
                class="song-item-cover"
                :style="{
                  backgroundImage: song.image_url
                    ? `url(${song.image_url})`
                    : 'linear-gradient(135deg, #667eea, #764ba2)'
                }"
              >
                <div class="song-item-play">▶</div>
              </div>

              <div class="song-item-info">
                <div class="song-item-title">{{ song.title || 'Sin título' }}</div>
                <div class="song-item-artist">{{ song.artist || 'Artista desconocido' }}</div>
              </div>

              <div class="song-item-arrow">→</div>
            </div>
          </div>
        </div>
      </div>

    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay{
  position: fixed;
  inset: 0;
  z-index: 100000;
  background: rgba(0,0,0,.72);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  padding: 0;
}

.modal-content{
  width: 100vw;
  height: 100vh;
  height: 100svh;
  height: 100dvh;
  max-width: none;
  border-radius: 0;
  overflow: hidden;
  background: rgba(255,255,255,0.92);
  box-shadow: none;
  display: flex;
  flex-direction: column;
  position: relative;
}

.modal-content::before{
  content:"";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(900px 340px at 20% 0%, rgba(99,102,241,.18), transparent 60%),
    radial-gradient(700px 300px at 80% 0%, rgba(34,197,94,.16), transparent 60%),
    radial-gradient(1000px 420px at 50% 120%, rgba(124,58,237,.12), transparent 55%);
}

.modal-header{
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  position: relative;
  padding: calc(14px + env(safe-area-inset-top)) 16px 14px;
  background: rgba(255,255,255,0.78);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-bottom: 1px solid rgba(0,0,0,.08);
}

.header-left{
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  padding-right: clamp(170px, 34vw, 310px);
}

.chat-avatar{
  width: 46px;
  height: 46px;
  border-radius: 16px;
  display: grid;
  place-items: center;
  background: rgba(0,0,0,.05);
  border: 1px solid rgba(0,0,0,.06);
  box-shadow: 0 16px 32px rgba(0,0,0,.10), inset 0 1px 0 rgba(255,255,255,.7);
  font-size: 1.5rem;
  flex-shrink: 0;
}

.header-titles{
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  overflow: hidden;
}

.chat-title{
  margin: 0;
  font-size: 1.05rem;
  font-weight: 950;
  letter-spacing: .2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-subtitle{
  font-size: .78rem;
  font-weight: 700;
  opacity: .65;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.e2ee-pill{
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-weight: 900;
  font-size: .72rem;
  border: 1px solid rgba(0,0,0,.10);
  background: rgba(0,0,0,.06);
  opacity: .9;
}

.e2ee-pill.on{
  border-color: rgba(34,197,94,.25);
  background: rgba(34,197,94,.10);
}

.e2ee-banner{
  width: 100%;
  margin: 10px 0 6px;
  padding: 10px 12px;
  border-radius: 16px;
  border: 1px solid rgba(34,197,94,.18);
  background: rgba(34,197,94,.08);
  font-weight: 850;
  font-size: .82rem;
  color: rgba(0,0,0,.78);
  box-shadow: 0 10px 20px rgba(0,0,0,.06), inset 0 1px 0 rgba(255,255,255,.7);
}

.e2ee-banner.off{
  border-color: rgba(239,68,68,.18);
  background: rgba(239,68,68,.08);
}

:global(.p-dark) .e2ee-pill{
  border-color: rgba(255,255,255,.12);
  background: rgba(255,255,255,.08);
  color: rgba(255,255,255,.85);
}

:global(.p-dark) .e2ee-pill.on{
  border-color: rgba(34,197,94,.25);
  background: rgba(34,197,94,.14);
}

:global(.p-dark) .e2ee-banner{
  color: rgba(255,255,255,.85);
  border-color: rgba(34,197,94,.25);
  background: rgba(34,197,94,.14);
  box-shadow: 0 16px 34px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.06);
}

:global(.p-dark) .e2ee-banner.off{
  border-color: rgba(239,68,68,.25);
  background: rgba(239,68,68,.14);
}

.header-actions{
  position: absolute;
  right: 16px;
  top: calc(50% + (env(safe-area-inset-top) / 2));
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  white-space: nowrap;
  flex: 0 0 auto;
  z-index: 6;
}

.desktop-only{ display: flex; }
.mobile-only{ display: none; }

.block-btn,
.unblock-btn{
  height: 44px;
  padding: 0 16px;
  border-radius: 14px;
  border: 1px solid rgba(0,0,0,.10);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 950;
  font-size: .9rem;
  white-space: nowrap;
  box-shadow: 0 10px 22px rgba(0,0,0,.08), inset 0 1px 0 rgba(255,255,255,.7);
  transition: all .15s ease;
}

.block-btn{
  border-color: rgba(239,68,68,.25);
  background: rgba(239,68,68,.08);
  color: rgba(239,68,68,.90);
}

.block-btn:hover{
  background: rgba(239,68,68,.14);
  transform: translateY(-1px);
}

.block-btn:active{
  transform: translateY(0) scale(.98);
}

.unblock-btn{
  border-color: rgba(34,197,94,.25);
  background: rgba(34,197,94,.08);
  color: rgba(34,197,94,.90);
}

.unblock-btn:hover{
  background: rgba(34,197,94,.14);
  transform: translateY(-1px);
}

.unblock-btn:active{
  transform: translateY(0) scale(.98);
}

.mobile-menu-container{
  position: relative;
}

.mobile-menu-btn{
  width: 44px;
  height: 44px;
  border-radius: 14px;
  border: 1px solid rgba(0,0,0,.10);
  background: rgba(0,0,0,.05);
  cursor: pointer;
  display: grid;
  place-items: center;
  font-size: 1.6rem;
  font-weight: 900;
  color: rgba(0,0,0,.85);
  box-shadow: 0 10px 22px rgba(0,0,0,.08), inset 0 1px 0 rgba(255,255,255,.7);
  transition: all .15s ease;
  line-height: 1;
}

.mobile-menu-btn:hover{
  background: rgba(0,0,0,.08);
  transform: translateY(-1px);
}

.mobile-menu-btn:active{
  transform: scale(.98);
}

.mobile-dropdown{
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 200px;
  background: rgba(255,255,255,.95);
  border: 1px solid rgba(0,0,0,.10);
  border-radius: 16px;
  box-shadow: 0 20px 40px rgba(0,0,0,.15), inset 0 1px 0 rgba(255,255,255,.9);
  backdrop-filter: blur(14px);
  overflow: hidden;
  z-index: 10;
}

.dropdown-item{
  width: 100%;
  padding: 14px 16px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-weight: 900;
  font-size: .9rem;
  color: rgba(0,0,0,.85);
  transition: background .15s ease;
  display: flex;
  align-items: center;
  gap: 8px;
}

.dropdown-item:hover{
  background: rgba(0,0,0,.05);
}

.dropdown-item:active{
  background: rgba(0,0,0,.08);
}

.mobile-menu-backdrop{
  position: fixed;
  inset: 0;
  z-index: 5;
  background: transparent;
}


.back-btn{
  height: 44px;
  padding: 0 16px;
  border-radius: 14px;
  border: 1px solid rgba(0,0,0,.10);
  background: rgba(0,0,0,.05);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 950;
  font-size: .9rem;
  letter-spacing: .2px;
  color: rgba(0,0,0,.85);
  box-shadow: 0 10px 22px rgba(0,0,0,.08), inset 0 1px 0 rgba(255,255,255,.7);
  transition: transform .15s ease, background .15s ease;
  white-space: nowrap;
}

.back-btn:hover{
  background: rgba(0,0,0,.08);
  transform: translateY(-1px);
}

.back-btn:active{
  transform: translateY(0px) scale(.98);
}

.block-banner{
  padding: 14px 18px;
  background: rgba(239,68,68,.08);
  border-bottom: 1px solid rgba(239,68,68,.15);
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: center;
}

.block-icon{
  font-size: 1.4rem;
}

.block-text{
  font-weight: 900;
  font-size: .95rem;
  color: rgba(239,68,68,.9);
  letter-spacing: .2px;
}

.modal-body{
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 18px;
  overflow: hidden;
  padding-bottom: calc(18px + 86px + env(safe-area-inset-bottom));
}

.chat-messages{
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 6px 4px 14px;
  scroll-behavior: smooth;
}

.chat-messages::-webkit-scrollbar {
  width: 10px;
}

.chat-messages::-webkit-scrollbar-track {
  background: rgba(0,0,0,.03);
  border-radius: 10px;
}

.chat-messages::-webkit-scrollbar-thumb {
  background: rgba(99,102,241,.25);
  border-radius: 10px;
  transition: background 0.2s ease;
}

.chat-messages::-webkit-scrollbar-thumb:hover {
  background: rgba(99,102,241,.4);
}

.empty-state{
  margin: auto;
  text-align: center;
  opacity: .75;
  max-width: 520px;
}

.empty-icon{
  font-size: 2.2rem;
  margin-bottom: 8px;
}

.empty-title{
  font-weight: 950;
  margin: 0;
}

.chat-row{
  display: flex;
  justify-content: flex-start;
}

.chat-row.me{
  justify-content: flex-end;
}

.chat-bubble{
  background: rgba(243,244,246,0.92);
  padding: 12px 14px;
  border-radius: 18px;
  max-width: min(74ch, 88%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-shadow: 0 10px 22px rgba(0,0,0,.08), inset 0 1px 0 rgba(255,255,255,.7);
  position: relative;
}

.chat-bubble.me{
  color: #fff;
  background: linear-gradient(135deg, #7c3aed, #4f46e5);
  box-shadow: 0 14px 28px rgba(79,70,229,.22), inset 0 1px 0 rgba(255,255,255,.2);
}

.song-bubble{
  max-width: min(400px, 88%);
  padding: 10px;
}

.song-card{
  display: flex;
  align-items: center;
  gap: 12px;
  position: relative;
}

.song-cover{
  width: 60px;
  height: 60px;
  border-radius: 12px;
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
}

.song-play-icon{
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(255,255,255,.9);
  display: grid;
  place-items: center;
  font-size: .7rem;
  color: #7c3aed;
  font-weight: 900;
  box-shadow: 0 4px 12px rgba(0,0,0,.2);
}

.song-info{
  flex: 1;
  min-width: 0;
}

.song-title{
  font-weight: 950;
  font-size: .95rem;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.song-artist{
  font-size: .8rem;
  opacity: .75;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bubble-top{
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.msg-delete-btn{
  width: 34px;
  height: 34px;
  border-radius: 12px;
  border: none;
  cursor: pointer;
  flex: 0 0 auto;
  background: rgba(0,0,0,.08);
  color: rgba(0,0,0,.75);
  display: grid;
  place-items: center;
  opacity: 0.25;
  transform: scale(.95);
  transition: opacity .15s ease, transform .15s ease, background .15s ease;
}

.chat-bubble:hover .msg-delete-btn{
  opacity: 1;
  transform: scale(1);
}

.chat-bubble.me .msg-delete-btn{
  background: rgba(255,255,255,.16);
  color: rgba(255,255,255,.95);
}

.msg-delete-btn:hover{
  opacity: 1;
  transform: scale(1.04);
  background: rgba(239,68,68,.18);
}

.chat-bubble.me .msg-delete-btn:hover{
  background: rgba(239,68,68,.25);
}

.msg-delete-btn:active{
  transform: scale(.97);
}

.chat-text{
  font-weight: 800;
  line-height: 1.25;
  word-break: break-word;
}

.chat-time{
  font-size: .72rem;
  opacity: .72;
  font-weight: 650;
  display: block;
  margin-top: 2px;
}

.seen-status{
  font-size: .75rem;
  font-weight: 900;
  opacity: .85;
  display: block;
  margin-top: 4px;
  text-align: left;
  letter-spacing: .2px;
}

.chat-bubble.me .seen-status{
  opacity: .95;
  text-align: right;
}

.chat-input-row{
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 999999;
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 12px 14px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom));
  border-top: 1px solid rgba(0,0,0,.07);
  background: rgba(255,255,255,0.75);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.share-song-btn{
  width: 48px;
  height: 48px;
  border-radius: 16px;
  border: 1px solid rgba(124,58,237,.25);
  background: linear-gradient(135deg, rgba(124,58,237,.12), rgba(99,102,241,.12));
  cursor: pointer;
  display: grid;
  place-items: center;
  font-size: 1.4rem;
  transition: all .15s ease;
  box-shadow: 0 10px 22px rgba(124,58,237,.15), inset 0 1px 0 rgba(255,255,255,.7);
}

.share-song-btn:hover{
  background: linear-gradient(135deg, rgba(124,58,237,.18), rgba(99,102,241,.18));
  transform: translateY(-1px) scale(1.02);
}

.share-song-btn:active{
  transform: scale(.98);
}

.input-field:disabled,
.send-btn:disabled,
.share-song-btn:disabled{
  opacity: .4;
  cursor: not-allowed;
  pointer-events: none;
}

.input-field{
  flex: 1;
  height: 48px;
  padding: 0 14px;
  border-radius: 16px;
  border: 1px solid rgba(0,0,0,.12);
  background: rgba(255,255,255,.9);
  outline: none;
  font-weight: 800;
  box-shadow: 0 10px 24px rgba(0,0,0,.08), inset 0 1px 0 rgba(255,255,255,.7);
  transition: box-shadow .15s ease, border-color .15s ease;
}

.input-field:focus{
  border-color: rgba(99,102,241,.55);
  box-shadow: 0 14px 32px rgba(0,0,0,.12), 0 0 0 8px rgba(99,102,241,.10), inset 0 1px 0 rgba(255,255,255,.7);
}

.send-btn{
  height: 48px;
  padding: 0 18px;
  border-radius: 16px;
  border: none;
  cursor: pointer;
  white-space: nowrap;
  font-weight: 950;
  letter-spacing: .2px;
  background: linear-gradient(135deg, #22c55e, #16a34a);
  color: white;
  box-shadow: 0 16px 34px rgba(34,197,94,.26);
  transition: transform .15s ease, filter .15s ease;
}

.send-btn:hover{
  filter: brightness(1.05);
  transform: translateY(-1px);
}

.send-btn:active{
  transform: translateY(0px) scale(.98);
}

.status-dot{
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  margin: 0 6px;
  background: rgba(0,0,0,.25);
  box-shadow: 0 0 0 4px rgba(0,0,0,.06);
  vertical-align: middle;
}

.status-dot.on{
  background: #22c55e;
  box-shadow: 0 0 0 4px rgba(34,197,94,.18);
}

.day-separator{
  width: 100%;
  display: flex;
  justify-content: center;
  margin: 10px 0 2px;
}

.day-separator-pill{
  font-size: .72rem;
  font-weight: 900;
  opacity: .72;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(0,0,0,.06);
  border: 1px solid rgba(0,0,0,.08);
  box-shadow: 0 8px 18px rgba(0,0,0,.08), inset 0 1px 0 rgba(255,255,255,.7);
  backdrop-filter: blur(10px);
}

.typing-indicator{
  display: flex;
  justify-content: flex-start;
  padding: 0 4px;
  margin-bottom: 12px;
}

.typing-bubble{
  background: rgba(243,244,246,0.92);
  padding: 14px 18px;
  border-radius: 18px;
  box-shadow: 0 10px 22px rgba(0,0,0,.08), inset 0 1px 0 rgba(255,255,255,.7);
  display: flex;
  align-items: center;
  gap: 6px;
}

.typing-dots{
  display: flex;
  gap: 4px;
  align-items: center;
}

.typing-dots span{
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(0,0,0,.35);
  animation: typing-bounce 1.4s infinite ease-in-out;
}

.typing-dots span:nth-child(1){ animation-delay: 0s; }
.typing-dots span:nth-child(2){ animation-delay: 0.2s; }
.typing-dots span:nth-child(3){ animation-delay: 0.4s; }

@keyframes typing-bounce {
  0%, 60%, 100% {
    transform: translateY(0);
    opacity: 0.35;
  }
  30% {
    transform: translateY(-8px);
    opacity: 1;
  }
}

.listen-together-btn{
  margin-top: 8px;
  height: 34px;
  padding: 0 12px;
  border-radius: 12px;
  border: 1px solid rgba(124,58,237,.22);
  background: linear-gradient(135deg, rgba(124,58,237,.14), rgba(99,102,241,.14));
  color: rgba(0,0,0,.82);
  font-weight: 950;
  font-size: .82rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 10px 20px rgba(124,58,237,.12), inset 0 1px 0 rgba(255,255,255,.7);
  transition: transform .14s ease, background .14s ease, border-color .14s ease;
}

.listen-together-btn:hover{
  transform: translateY(-1px);
  background: linear-gradient(135deg, rgba(124,58,237,.18), rgba(99,102,241,.18));
  border-color: rgba(124,58,237,.32);
}

.listen-together-btn:active{
  transform: translateY(0) scale(.98);
}

.together-bar{
  position: fixed;
  z-index: 999998;
  width: min(560px, calc(100vw - 28px));
  border-radius: 18px;
  padding: 10px 12px 12px;
  background: rgba(255,255,255,.78);
  border: 1px solid rgba(0,0,0,.10);
  box-shadow: 0 20px 44px rgba(0,0,0,.12), inset 0 1px 0 rgba(255,255,255,.75);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  user-select: none;
  touch-action: none;
}

.together-bar.draggable{
  cursor: grab;
}

.together-bar.draggable:active{
  cursor: grabbing;
}

.together-drag-handle{
  height: 18px;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
  opacity: .6;
  cursor: grab;
}

.together-drag-handle:active{
  cursor: grabbing;
}

.together-drag-handle .dots{
  width: 18px;
  height: 4px;
  border-radius: 999px;
  background: rgba(0,0,0,.20);
  margin: 0 2px;
}

.together-left{
  display: flex;
  align-items: center;
  gap: 12px;
}

.together-cover{
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background-size: cover;
  background-position: center;
  flex-shrink: 0;
  box-shadow: 0 10px 18px rgba(0,0,0,.14);
}

.together-info{
  flex: 1;
  min-width: 0;
}

.together-title{
  font-weight: 950;
  font-size: .95rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.together-artist{
  font-size: .82rem;
  opacity: .7;
  font-weight: 800;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.together-actions{
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.together-btn{
  height: 38px;
  width: 46px;
  border-radius: 14px;
  border: 1px solid rgba(0,0,0,.10);
  background: rgba(0,0,0,.05);
  cursor: pointer;
  font-weight: 950;
  box-shadow: 0 10px 20px rgba(0,0,0,.08), inset 0 1px 0 rgba(255,255,255,.7);
  transition: transform .14s ease, background .14s ease;
}

.together-btn:hover{
  transform: translateY(-1px);
  background: rgba(0,0,0,.08);
}

.together-btn:active{
  transform: translateY(0) scale(.98);
}

.together-btn.danger{
  background: rgba(239,68,68,.12);
  border-color: rgba(239,68,68,.20);
}

.together-btn.danger:hover{
  background: rgba(239,68,68,.18);
}

.together-slider{
  margin-top: 10px;
}

.together-slider input[type="range"]{
  width: 100%;
  accent-color: #7c3aed;
}

.song-picker-overlay{
  position: fixed;
  inset: 0;
  z-index: 100001;
  background: rgba(0,0,0,.5);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.song-picker-modal{
  background: rgba(255,255,255,.95);
  border-radius: 24px;
  width: 100%;
  max-width: 500px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 48px rgba(0,0,0,.2), inset 0 1px 0 rgba(255,255,255,.9);
  overflow: hidden;
}

.song-picker-header{
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  border-bottom: 1px solid rgba(0,0,0,.08);
  background: rgba(255,255,255,.8);
  backdrop-filter: blur(12px);
}

.song-picker-title{
  margin: 0;
  font-size: 1.15rem;
  font-weight: 950;
  letter-spacing: .3px;
}

.song-picker-close{
  width: 36px;
  height: 36px;
  border-radius: 12px;
  border: none;
  background: rgba(0,0,0,.06);
  cursor: pointer;
  font-size: 1.2rem;
  font-weight: 900;
  color: rgba(0,0,0,.7);
  display: grid;
  place-items: center;
  transition: all .15s ease;
}

.song-picker-close:hover{
  background: rgba(0,0,0,.1);
  transform: scale(1.05);
}

.song-picker-search{
  padding: 16px 20px;
  background: rgba(255,255,255,.6);
  backdrop-filter: blur(12px);
}

.song-search-input{
  width: 100%;
  height: 44px;
  padding: 0 14px;
  border-radius: 14px;
  border: 1px solid rgba(0,0,0,.12);
  background: rgba(255,255,255,.9);
  outline: none;
  font-weight: 800;
  font-size: .9rem;
  box-shadow: 0 8px 16px rgba(0,0,0,.06), inset 0 1px 0 rgba(255,255,255,.7);
  transition: all .15s ease;
}

.song-search-input:focus{
  border-color: rgba(99,102,241,.4);
  box-shadow: 0 12px 24px rgba(0,0,0,.08), 0 0 0 4px rgba(99,102,241,.08);
}

.song-picker-list{
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.song-picker-list::-webkit-scrollbar {
  width: 8px;
}

.song-picker-list::-webkit-scrollbar-track {
  background: rgba(0,0,0,.03);
  border-radius: 10px;
}

.song-picker-list::-webkit-scrollbar-thumb {
  background: rgba(99,102,241,.25);
  border-radius: 10px;
}

.no-songs{
  text-align: center;
  padding: 40px 20px;
  opacity: .6;
}

.no-songs-icon{
  font-size: 3rem;
  margin-bottom: 12px;
}

.song-item{
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px;
  border-radius: 16px;
  cursor: pointer;
  transition: all .15s ease;
  margin-bottom: 6px;
}

.song-item:hover{
  background: rgba(124,58,237,.08);
  transform: translateX(4px);
}

.song-item-cover{
  width: 56px;
  height: 56px;
  border-radius: 12px;
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 8px 16px rgba(0,0,0,.15);
}

.song-item-play{
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(255,255,255,.9);
  display: grid;
  place-items: center;
  font-size: .6rem;
  color: #7c3aed;
  font-weight: 900;
}

.song-item-info{
  flex: 1;
  min-width: 0;
}

.song-item-title{
  font-weight: 950;
  font-size: .95rem;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.song-item-artist{
  font-size: .82rem;
  opacity: .65;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.song-item-arrow{
  font-size: 1.2rem;
  font-weight: 900;
  opacity: .4;
  transition: opacity .15s ease;
}

.song-item:hover .song-item-arrow{
  opacity: .8;
}

/* ✅ DARK MODE */
:global(.p-dark) .modal-content{ background: rgba(16,16,18,0.92); }
:global(.p-dark) .modal-header{ background: rgba(16,16,18,0.72); border-bottom: 1px solid rgba(255,255,255,.10); }
:global(.p-dark) .chat-title{ color: rgba(255,255,255,.92); }
:global(.p-dark) .chat-subtitle{ color: rgba(255,255,255,.65); }
:global(.p-dark) .back-btn{ border-color: rgba(255,255,255,.10); background: rgba(255,255,255,.06); color: rgba(255,255,255,.92); }
:global(.p-dark) .back-btn:hover{ background: rgba(255,255,255,.10); }
:global(.p-dark) .block-btn,
:global(.p-dark) .unblock-btn{
  background: rgba(239,68,68,.15);
  border-color: rgba(239,68,68,.30);
  color: rgba(239,68,68,.95);
}
:global(.p-dark) .unblock-btn{
  background: rgba(34,197,94,.15);
  border-color: rgba(34,197,94,.30);
  color: rgba(34,197,94,.95);
}
:global(.p-dark) .mobile-menu-btn{
  border-color: rgba(255,255,255,.10);
  background: rgba(255,255,255,.06);
  color: rgba(255,255,255,.92);
}
:global(.p-dark) .mobile-menu-btn:hover{
  background: rgba(255,255,255,.10);
}
:global(.p-dark) .mobile-dropdown{
  background: rgba(30,30,34,.95);
  border-color: rgba(255,255,255,.10);
}
:global(.p-dark) .dropdown-item{
  color: rgba(255,255,255,.92);
}
:global(.p-dark) .dropdown-item:hover{
  background: rgba(255,255,255,.08);
}
:global(.p-dark) .block-banner{
  background: rgba(239,68,68,.15);
  border-bottom: 1px solid rgba(239,68,68,.25);
}
:global(.p-dark) .block-text{
  color: rgba(239,68,68,.95);
}
:global(.p-dark) .chat-messages::-webkit-scrollbar-track { background: rgba(255,255,255,.03); }
:global(.p-dark) .chat-messages::-webkit-scrollbar-thumb { background: rgba(99,102,241,.3); }
:global(.p-dark) .chat-messages::-webkit-scrollbar-thumb:hover { background: rgba(99,102,241,.45); }
:global(.p-dark) .chat-bubble{ background: rgba(39,39,42,0.9); box-shadow: 0 10px 22px rgba(0,0,0,.40), inset 0 1px 0 rgba(255,255,255,.05); }
:global(.p-dark) .song-title, :global(.p-dark) .song-artist{ color: rgba(255,255,255,.92); }
:global(.p-dark) .song-artist{ opacity: .65; }
:global(.p-dark) .chat-input-row{ background: rgba(16,16,18,0.68); border-top: 1px solid rgba(255,255,255,.10); }
:global(.p-dark) .input-field{ background: rgba(39,39,42,.92); border-color: rgba(255,255,255,.12); color: rgba(255,255,255,.92); }
:global(.p-dark) .msg-delete-btn{ background: rgba(255,255,255,.10); color: rgba(255,255,255,.90); }
:global(.p-dark) .msg-delete-btn:hover{ background: rgba(239,68,68,.25); }
:global(.p-dark) .status-dot{ background: rgba(255,255,255,.25); box-shadow: 0 0 0 4px rgba(255,255,255,.06); }
:global(.p-dark) .status-dot.on{ background: #22c55e; box-shadow: 0 0 0 4px rgba(34,197,94,.22); }
:global(.p-dark) .day-separator-pill{ background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.10); opacity: .80; box-shadow: 0 10px 22px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.06); }
:global(.p-dark) .typing-bubble{ background: rgba(39,39,42,0.9); box-shadow: 0 10px 22px rgba(0,0,0,.40), inset 0 1px 0 rgba(255,255,255,.05); }
:global(.p-dark) .typing-dots span{ background: rgba(255,255,255,.5); }
:global(.p-dark) .listen-together-btn{ color: rgba(255,255,255,.92); background: linear-gradient(135deg, rgba(124,58,237,.20), rgba(99,102,241,.20)); border-color: rgba(255,255,255,.12); }
:global(.p-dark) .together-bar{ background: rgba(16,16,18,.72); border: 1px solid rgba(255,255,255,.10); box-shadow: 0 24px 48px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.06); }
:global(.p-dark) .together-title{ color: rgba(255,255,255,.92); }
:global(.p-dark) .together-artist{ color: rgba(255,255,255,.68); }
:global(.p-dark) .together-drag-handle .dots{ background: rgba(255,255,255,.22); }
:global(.p-dark) .together-btn{ background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.10); color: rgba(255,255,255,.92); }
:global(.p-dark) .together-btn:hover{ background: rgba(255,255,255,.10); }
:global(.p-dark) .together-btn.danger{ background: rgba(239,68,68,.18); border-color: rgba(239,68,68,.25); }
:global(.p-dark) .song-picker-modal{ background: rgba(30,30,34,.95); }
:global(.p-dark) .song-picker-header{ background: rgba(30,30,34,.8); border-bottom: 1px solid rgba(255,255,255,.10); }
:global(.p-dark) .song-picker-title{ color: rgba(255,255,255,.92); }
:global(.p-dark) .song-picker-close{ background: rgba(255,255,255,.08); color: rgba(255,255,255,.9); }
:global(.p-dark) .song-picker-search{ background: rgba(30,30,34,.6); }
:global(.p-dark) .song-search-input{ background: rgba(39,39,42,.92); border-color: rgba(255,255,255,.12); color: rgba(255,255,255,.92); }
:global(.p-dark) .song-item:hover{ background: rgba(124,58,237,.15); }
:global(.p-dark) .song-item-title{ color: rgba(255,255,255,.92); }
:global(.p-dark) .song-item-artist{ color: rgba(255,255,255,.65); }

/* ✅ MÓVIL */
@media (max-width: 720px){
  .desktop-only{ display: none !important; }
  .mobile-only{ display: flex !important; }

  .modal-header{
    padding: calc(12px + env(safe-area-inset-top)) 12px 12px;
  }

  .chat-avatar{
    width: 42px;
    height: 42px;
    border-radius: 14px;
    font-size: 1.35rem;
  }

  .chat-title{ font-size: 1rem; }
  .chat-subtitle{ font-size: .74rem; }

  .header-actions{
    right: 12px;
    gap: 8px;
  }

  .header-left{
    padding-right: clamp(60px, 18vw, 90px);
  }

  .mobile-menu-btn{
    width: 42px;
    height: 42px;
  }

  .block-banner{
    padding: 12px 14px;
  }

  .block-text{
    font-size: .9rem;
  }

  .modal-body{
    padding: 14px;
    padding-bottom: calc(14px + 86px + env(safe-area-inset-bottom));
  }

  .chat-bubble{
    max-width: 92%;
    padding: 11px 12px;
    border-radius: 18px;
  }

  .chat-input-row{
    gap: 8px;
    padding: 10px 12px;
    padding-bottom: calc(10px + env(safe-area-inset-bottom));
  }

  .share-song-btn{
    width: 46px;
    height: 46px;
    border-radius: 16px;
    font-size: 1.25rem;
  }

  .input-field{
    height: 46px;
    border-radius: 16px;
    padding: 0 12px;
    font-size: 16px;
  }

  .send-btn{
    height: 46px;
    border-radius: 16px;
    padding: 0 14px;
    font-size: .92rem;
  }

  .together-bar{
    width: calc(100vw - 24px);
    border-radius: 18px;
  }
}

@media (hover: none) and (pointer: coarse){
  .msg-delete-btn{ opacity: .55; }
}

@supports (-webkit-touch-callout: none){
  .chat-messages,
  .song-picker-list{
    -webkit-overflow-scrolling: touch;
  }
}
</style>