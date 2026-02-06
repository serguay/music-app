<script setup>
import { ref, onMounted, watch, computed, onUnmounted } from 'vue'
import { supabase } from '../lib/supabase'
import { useRouter } from 'vue-router'
import { usePlayer } from '../stores/player'
import PlayerBar from '../components/PlayerBar.vue'

import UploadButton from '../components/UploadButton.vue'
import Playlist from '../components/Playlist.vue'
import CompleteProfileModal from '../components/CompleteProfileModal.vue'
import logoImg from '../assets/home.png'

/* ======================
   VERSION
====================== */
const appVersion =
  (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) ||
  import.meta.env.VITE_APP_VERSION ||
  'dev'

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
const showGroups = ref(false)
// ✅ Crear grupo (UI)
const showCreateGroup = ref(false)
const creatingGroup = ref(false)
const createGroupName = ref('')
const createSelectedUserIds = ref([])
const userId = ref(null)

/* =====================
   🫂 GROUP CHAT (Supabase)
====================== */
const groups = ref([])
const activeGroupId = ref(null)
const activeGroupName = ref('')
const groupMembers = ref([]) // [{ id, username }]
const groupMessages = ref([])
const groupMessageText = ref('')
const groupsLoading = ref(false)
const messagesLoading = ref(false)
let groupMessagesChannel = null

const activeGroupMembersText = computed(() => {
  const list = Array.isArray(groupMembers.value) ? groupMembers.value : []
  const names = list
    .map((m) => (m?.username ?? '').trim())
    .filter(Boolean)

  // ✅ Nunca dejes el header vacío (si no, parece “una línea blanca”)
  if (!names.length) return 'Miembros: —'

  // muestra hasta 6 para no romper el header
  const head = names.slice(0, 6)
  const rest = names.length - head.length
  const s = rest > 0 ? `${head.join(', ')} +${rest}` : head.join(', ')
  return `Miembros: ${s}`
})

const formatGroupTime = (iso) => {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

const subscribeGroupMessages = async (groupId) => {
  if (groupMessagesChannel) {
    supabase.removeChannel(groupMessagesChannel)
    groupMessagesChannel = null
  }
  if (!groupId) return

  groupMessagesChannel = supabase
    .channel(`group-messages:${groupId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` },
      (payload) => {
        const msg = payload?.new
        if (!msg) return
        if (groupMessages.value.some((m) => m.id === msg.id)) return
        groupMessages.value.push(msg)
      }
    )
    .subscribe()
}

const loadGroupMessages = async (groupId) => {
  if (!groupId) return
  messagesLoading.value = true
  try {
    const { data, error } = await supabase
      .from('group_messages')
      .select('id, group_id, user_id, content, created_at')
      .eq('group_id', groupId)
      .order('created_at', { ascending: true })
      .limit(200)

    if (error) {
      console.warn('[group_messages] select error:', error)
      groupMessages.value = []
      return
    }

    groupMessages.value = data || []
  } finally {
    messagesLoading.value = false
  }
}

const loadGroupMembers = async (groupId) => {
  if (!groupId) {
    groupMembers.value = []
    return
  }

  try {
    // 1) Pillamos todos los user_ids del grupo
    const { data: mem, error: memErr } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId)

    if (memErr) {
      console.warn('[group_members] select members error:', memErr)
      groupMembers.value = []
      return
    }

    const memberIds = (mem || []).map((r) => r?.user_id).filter(Boolean)
    console.log('[group_members] memberIds:', memberIds)
    if (!memberIds.length) {
      groupMembers.value = []
      return
    }

    // 2) Traemos usernames desde profiles (más estable que join)
    const { data: profs, error: pErr } = await supabase
      .from('profiles')
      .select('id, username')
      .in('id', memberIds)

    if (pErr) {
      console.warn('[profiles] select for members error:', pErr)
      // aunque falle profiles, seguimos con fallback por id
      groupMembers.value = memberIds.map((id) => ({
        id,
        username: id ? `Usuario ${String(id).slice(0, 6)}` : 'Usuario'
      }))
      return
    }

    const map = new Map((profs || []).map((p) => [p.id, (p?.username ?? '').trim()]))
    console.log('[profiles] fetched:', (profs || []).map((p) => ({ id: p.id, username: p.username })))

    // Mantén el orden de memberIds (y mete fallback si falta username)
    groupMembers.value = memberIds.map((id) => {
      const uname = (map.get(id) || '').trim()
      return {
        id,
        username: uname || (id ? `Usuario ${String(id).slice(0, 6)}` : 'Usuario')
      }
    })
  } catch (e) {
    console.warn('[group_members] select members exception:', e)
    groupMembers.value = []
  }
}

const selectGroup = async (g) => {
  if (!g?.id) return
  activeGroupId.value = g.id
  activeGroupName.value = g.name || 'Grupo'
  groupMessageText.value = ''
  await loadGroupMessages(g.id)
  await loadGroupMembers(g.id)
  await subscribeGroupMessages(g.id)
}

const loadMyGroups = async () => {
  if (!userId.value) return
  groupsLoading.value = true

  try {
    const { data: mem, error: memErr } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', userId.value)

    if (memErr) {
      console.warn('[group_members] select error:', memErr)
      groups.value = []
      activeGroupId.value = null
      activeGroupName.value = ''
      groupMembers.value = []
      groupMessages.value = []
      return
    }

    const groupIds = (mem || []).map((m) => m?.group_id).filter(Boolean)

    // ✅ Si no estás en ningún grupo, limpia estado
    if (!groupIds.length) {
      groups.value = []
      activeGroupId.value = null
      activeGroupName.value = ''
      groupMembers.value = []
      groupMessages.value = []
      return
    }

    const { data: gs, error: gErr } = await supabase
      .from('groups')
      .select('id, name, created_at')
      .in('id', groupIds)
      .order('created_at', { ascending: false })

    if (gErr) {
      console.warn('[groups] select error:', gErr)
      // ✅ si no podemos leer groups (RLS), limpiamos estado para no dejar UI "stale"
      groups.value = []
      activeGroupId.value = null
      activeGroupName.value = ''
      groupMembers.value = []
      groupMessages.value = []
      return
    }

    groups.value = gs || []

    // ✅ Si el grupo activo ya no existe, abre el primero
    if (!activeGroupId.value && groups.value.length) {
      await selectGroup(groups.value[0])
      return
    }

    const active = groups.value.find((x) => x?.id === activeGroupId.value)

    if (!active) {
      // ✅ Si el activo no está en la lista, selecciona el primero
      await selectGroup(groups.value[0])
      return
    }

    // ✅ Mantén el nombre sincronizado
    activeGroupName.value = active.name || 'Grupo'

    // ✅ Refresca miembros si hay grupo activo (por si se añadieron desde otro lado)
    await loadGroupMembers(active.id)
  } finally {
    groupsLoading.value = false
  }
}

const toggleCreateUser = (id) => {
  if (!id) return
  const arr = Array.isArray(createSelectedUserIds.value) ? createSelectedUserIds.value : []
  if (arr.includes(id)) {
    createSelectedUserIds.value = arr.filter((x) => x !== id)
  } else {
    createSelectedUserIds.value = [...arr, id]
  }
}

const openCreateGroup = async () => {
  showCreateGroup.value = true
  createGroupName.value = ''
  createSelectedUserIds.value = []

  // Asegura lista de usuarios cargada
  if (!users.value?.length) {
    await loadUsers()
  }
}

const closeCreateGroup = () => {
  showCreateGroup.value = false
  creatingGroup.value = false
  createGroupName.value = ''
  createSelectedUserIds.value = []
}

const createGroup = async () => {
  if (!userId.value) return

  const name = (createGroupName.value || '').trim()
  const memberIds = Array.from(
    new Set([userId.value, ...(createSelectedUserIds.value || [])].filter(Boolean))
  )

  if (!name) {
    alert('Pon un nombre al grupo')
    return
  }

  if (memberIds.length < 2) {
    alert('Selecciona al menos 1 persona')
    return
  }

  creatingGroup.value = true
  try {
    // 1) Crear grupo
    const { data: g, error: gErr } = await supabase
      .from('groups')
      .insert({ name, created_by: userId.value })
      .select('id, name')
      .single()

    if (gErr || !g?.id) {
      console.warn('[groups] insert error:', gErr)

      const code = gErr?.code || ''
      const msg = String(gErr?.message || 'No se pudo crear el grupo')

      // ✅ Mensaje claro cuando es RLS (muy común en Supabase)
      if (code === '42501' || /row-level security/i.test(msg)) {
        alert('No se pudo crear el grupo (RLS). En Supabase necesitas policies que permitan INSERT en "groups" y también SELECT del grupo recién creado (por ejemplo, permitir SELECT si created_by = auth.uid()).')
      } else {
        alert(msg)
      }
      return
    }

    // 2) Añadir miembros (incluye al creador)
    const rows = memberIds.map((uid) => ({
      group_id: g.id,
      user_id: uid,
      role: uid === userId.value ? 'owner' : 'member'
    }))
    const { error: mErr } = await supabase.from('group_members').insert(rows)

    if (mErr) {
      console.warn('[group_members] insert error:', mErr)
      alert('El grupo se creó, pero no se pudieron añadir miembros')
    }

    // 3) Recargar y abrir
    await loadMyGroups()
    const justCreated = groups.value.find((x) => x.id === g.id) || g
    await selectGroup(justCreated)

    closeCreateGroup()
  } finally {
    creatingGroup.value = false
  }
}

const sendGroupMessage = async () => {
  const text = (groupMessageText.value || '').trim()
  if (!text || !activeGroupId.value || !userId.value) return

  const optimistic = {
    id: `optimistic-${Date.now()}`,
    group_id: activeGroupId.value,
    user_id: userId.value,
    content: text,
    created_at: new Date().toISOString()
  }
  groupMessages.value.push(optimistic)
  groupMessageText.value = ''

  const { error } = await supabase
    .from('group_messages')
    .insert({ group_id: activeGroupId.value, user_id: userId.value, content: text })

  if (error) {
    console.warn('[group_messages] insert error:', error)
    groupMessages.value = groupMessages.value.filter((m) => m.id !== optimistic.id)
    groupMessageText.value = text
  }
}

const isAdmin = ref(false)

// ✅ Carga perfil + flag admin (robusto ante RLS/errores)
const loadProfileFlags = async (uid) => {
  if (!uid) {
    showProfileModal.value = false
    isAdmin.value = false
    return
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('username, is_admin')
    .eq('id', uid)
    .maybeSingle()

  if (error) {
    console.warn('[profiles] select error:', error)
    // si no podemos leer el perfil, por defecto NO mostramos admin
    isAdmin.value = false
    // y evitamos bloquear la app con el modal
    showProfileModal.value = false
    return
  }

  showProfileModal.value = !(data?.username && String(data.username).trim().length)
  isAdmin.value = !!data?.is_admin
}

const selectedSong = ref(null) // último click (fallback)
const currentSong = computed(() => player.currentSong || selectedSong.value)

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

// ✅ Avatar URL helper (supports full URL or storage path)
const getAvatarUrl = (u) => {
  const raw = (u?.avatar_url ?? '').trim()
  if (!raw) return ''

  // If already a full URL, use it.
  if (/^https?:\/\//i.test(raw)) return raw

  // Otherwise treat as a path in the `avatars` bucket.
  try {
    const { data } = supabase.storage.from('avatars').getPublicUrl(raw)
    return data?.publicUrl || ''
  } catch (e) {
    return ''
  }
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
    .select('id, username, avatar_url, created_at')
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
// ✅ Sync global page locks (overflow + hidden controls) from a single source of truth
const syncPageLocks = () => {
  // Mantén la marca de vista (por si algún navegador la pierde tras navegación)
  document.body.classList.add('home-page')

  // Cuando el modal de completar perfil está abierto, ocultamos controles del Home

  // Bloquea scroll cuando hay drawer o modal
  const lockScroll = !!showProfileModal.value || !!showMobileSidebar.value || !!showGroups.value
  document.body.style.overflow = lockScroll ? 'hidden' : 'auto'

  // Extra safety: si en algún momento quedó pointer-events bloqueado, lo recuperamos
  document.body.style.pointerEvents = 'auto'
  document.documentElement.style.pointerEvents = 'auto'
}

// Reacciona a modal + drawer y sincroniza siempre
watch([showProfileModal, showMobileSidebar, showGroups], syncPageLocks, { immediate: true })

// ✅ Refresca grupos cada vez que se abre el panel (evita datos "stale")
watch(showGroups, async (open) => {
  if (open) {
    await loadMyGroups()
  } else {
    if (showCreateGroup.value) closeCreateGroup()
  }
})

// ✅ Si por RLS/policies nos quedamos sin lista, no dejes el grupo activo "colgado"
watch([groups, activeGroupId], () => {
  const gid = activeGroupId.value
  if (!gid) return

  const list = Array.isArray(groups.value) ? groups.value : []
  const stillExists = list.some((g) => g?.id === gid)

  if (!stillExists) {
    activeGroupId.value = null
    activeGroupName.value = ''
    groupMembers.value = []
    groupMessages.value = []
  }
})


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
  // ✅ por si vienes de otra ruta y quedó pegado
  document.body.style.overflow = 'auto'

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
    // ✅ re-evalúa perfil/admin al cambiar sesión
    loadProfileFlags(userId.value)
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

  await loadProfileFlags(userId.value)
  // ✅ asegura que body locks/clases reflejan el estado real
  syncPageLocks()

  await loadStats()
  await loadGlobalStats()
  await loadUsers()
  await loadMyGroups()

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

  // Group messages channel cleanup
  if (groupMessagesChannel) {
    supabase.removeChannel(groupMessagesChannel)
    groupMessagesChannel = null
  }

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



/* ======================
   NAV
====================== */
const goToNotifications = () => router.push('/notifications')
const goToProfile = () => {
  if (!userId.value) return
  router.push('/profile/' + userId.value)
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

const normalizeAudio = (a) => {
  if (!a) return a

  const src =
    a?.url ||
    a?.audio_url ||
    a?.audioUrl ||
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
    audio_url: a?.audio_url || src,
    audioUrl: a?.audioUrl || src
  }
}
const onUploaded = () => {
  playlistKey.value++
  songs.value = []

  // ✅ evita romper el PlayerBar: solo resetea cola si NO hay canción sonando
  if (!player.currentSong && typeof player.setQueue === 'function') {
    player.setQueue([])
  }
}
// Llama al método correcto del store (según la versión)
const callPlayerPlay = (songObj) => {
  if (!songObj) return

  // intenta varias firmas comunes
  if (typeof player.playSong === 'function') return player.playSong(songObj)
  if (typeof player.play === 'function') return player.play(songObj)
  if (typeof player.setSong === 'function') return player.setSong(songObj)
  if (typeof player.setCurrentSong === 'function') return player.setCurrentSong(songObj)

  console.error('❌ Player store: no play method found. Available keys:', Object.keys(player || {}))
}

const playSong = (song) => {
  const normalized = normalizeAudio(song)

  // debug rápido para saber si llega el click + qué campos trae
  console.log('🎵 Home playSong()', {
    id: normalized?.id,
    title: normalized?.title,
    url: normalized?.url,
    audio_url: normalized?.audio_url,
    audioUrl: normalized?.audioUrl
  })

  // Si por lo que sea no hay URL reproducible, evitamos romper el store
  if (!normalized?.url && !normalized?.audio_url && !normalized?.audioUrl) {
    console.warn('⚠️ Esta canción no tiene url/audio_url/audioUrl:', song)
    return
  }

  // ✅ Guardamos el click como fallback para que el PlayerBar aparezca siempre
  selectedSong.value = normalized

  // ✅ Llama al store (método compatible)
  callPlayerPlay(normalized)
}

const goToUserProfile = (id) => {
  if (!id) return
  router.push('/profile/' + id)
}

const playNext = () => safePlayNext()

// ✅ Recibimos la lista real que pinta el Home y se la pasamos al player
const onSongsLoaded = (list) => {
  const arr = Array.isArray(list) ? list : []

  // ✅ Normaliza para que siempre exista `url || audio_url`
  const normalized = arr
    .map(normalizeAudio)
    .filter((a) => a?.id && (a?.url || a?.audio_url))

  songs.value = normalized

  // guardamos la cola en el store para que el "ended" y el ⏭ usen la misma fuente
  if (typeof player.setQueue === 'function') {
    player.setQueue(songs.value)
  }
}

</script>

<template>
  <section class="home" :class="{ 'complete-open': showProfileModal }">
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
        title="Grupos"
        @click="showGroups = true"
      >
        🫂
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
            @click="showGroups = true; showMobileSidebar = false"
            title="Grupos"
          >
            🫂
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
            @click="goToAdmin(); showMobileSidebar = false"
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
            <div class="user-avatar">
              <img
                v-if="getAvatarUrl(u)"
                :src="getAvatarUrl(u)"
                :alt="displayUserName(u)"
                class="user-avatar-img"
                loading="lazy"
                referrerpolicy="no-referrer"
              />
              <span v-else>👤</span>
            </div>

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


    <!-- 🫂 GROUPS PANEL (funcional) -->
    <div v-if="showGroups" class="groups-overlay" @click.self="showGroups = false">
      <div class="groups-shell">
        <aside class="groups-list">
          <div class="groups-list__header">
            <div class="groups-list__title">🫂 Grupos</div>

            <div class="groups-list__header-actions">
              <button
                class="groups-add"
                type="button"
                @click="openCreateGroup"
                aria-label="Crear grupo"
                title="Crear grupo"
              >
                ＋
              </button>

              <button
                class="groups-close"
                @click="showGroups = false"
                aria-label="Cerrar grupos"
                title="Cerrar"
              >
                ✕
              </button>
            </div>
          </div>

          <div class="groups-items">
            <div v-if="groupsLoading" class="groups-empty">Cargando grupos…</div>
            <div v-else-if="!groups.length" class="groups-empty">
              <div>Aún no estás en ningún grupo.</div>
              <button class="groups-empty-cta" type="button" @click="openCreateGroup">＋ Crear grupo</button>
            </div>

            <button
              v-for="g in groups"
              :key="g.id"
              class="group-row"
              :class="{ 'is-active': g.id === activeGroupId }"
              type="button"
              @click="selectGroup(g)"
            >
              <span class="group-avatar">👥</span>
              <span class="group-meta">
                <span class="group-name">{{ g.name || 'Grupo' }}</span>
                <span class="group-sub">{{ g.id === activeGroupId ? 'Abierto' : 'Toca para abrir' }}</span>
              </span>
            </button>
          </div>
        </aside>

        <main class="groups-chat">
          <div class="groups-chat__header">
            <div class="groups-chat__title">{{ activeGroupName || 'Selecciona un grupo' }}</div>

            <div class="groups-chat__members" v-if="activeGroupId">
              {{ activeGroupMembersText }}
            </div>

            <div class="groups-chat__hint" v-if="activeGroupId">(chat de grupo)</div>
            <div class="groups-chat__hint" v-else>(elige uno a la izquierda)</div>
          </div>

          <div class="groups-chat__body">
            <div v-if="!activeGroupId" class="groups-empty">Selecciona un grupo para ver los mensajes.</div>
            <div v-else-if="messagesLoading" class="groups-empty">Cargando mensajes…</div>
            <div v-else-if="!groupMessages.length" class="groups-empty">No hay mensajes aún.</div>

            <div
              v-for="m in groupMessages"
              :key="m.id"
              class="msg"
              :class="m.user_id === userId ? 'msg--right' : 'msg--left'"
            >
              <div class="msg-text">{{ m.content }}</div>
              <div class="msg-time">{{ formatGroupTime(m.created_at) }}</div>
            </div>
          </div>

          <div class="groups-chat__composer">
            <button class="composer-btn" type="button" aria-label="Adjuntar" title="Adjuntar">🎵</button>
            <input
              v-model="groupMessageText"
              class="composer-input"
              placeholder="Escribe un mensaje… (Enter para enviar)"
              :disabled="!activeGroupId"
              @keydown.enter.prevent="sendGroupMessage"
            />
            <button
              class="composer-send"
              type="button"
              :disabled="!activeGroupId || !groupMessageText.trim()"
              @click="sendGroupMessage"
            >
              Enviar
            </button>
          </div>
        </main>

        <!-- ✅ CREATE GROUP MODAL (UI + Supabase) -->
        <div v-if="showCreateGroup" class="create-group-overlay" @click.self="closeCreateGroup">
          <div class="create-group-card">
            <div class="create-group-header">
              <div class="create-group-title">＋ Nuevo grupo</div>
              <button class="create-group-x" type="button" @click="closeCreateGroup" aria-label="Cerrar">✕</button>
            </div>

            <label class="create-group-label">Nombre del grupo</label>
            <input
              v-model="createGroupName"
              class="create-group-input"
              placeholder="Ej: Mis colegas"
              maxlength="50"
            />

            <label class="create-group-label" style="margin-top:10px">Añadir personas</label>
            <div class="create-group-users">
              <button
                v-for="u in users.filter(x => x.id !== userId)"
                :key="u.id"
                type="button"
                class="create-user"
                :class="{ selected: createSelectedUserIds.includes(u.id) }"
                @click="toggleCreateUser(u.id)"
              >
                <span class="cu-avatar">
                  <img
                    v-if="getAvatarUrl(u)"
                    :src="getAvatarUrl(u)"
                    :alt="displayUserName(u)"
                    class="cu-avatar-img"
                    loading="lazy"
                    referrerpolicy="no-referrer"
                  />
                  <span v-else>👤</span>
                </span>
                <span class="cu-name">{{ displayUserName(u) }}</span>
                <span class="cu-check">{{ createSelectedUserIds.includes(u.id) ? '✓' : '' }}</span>
              </button>
            </div>

            <div class="create-group-actions">
              <button class="create-group-cancel" type="button" @click="closeCreateGroup">Cancelar</button>
              <button
                class="create-group-create"
                type="button"
                :disabled="creatingGroup || !createGroupName.trim() || createSelectedUserIds.length === 0"
                @click="createGroup"
              >
                {{ creatingGroup ? 'Creando…' : 'Crear' }}
              </button>
            </div>
          </div>
        </div>
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

        <div class="upload-wrap">
          <UploadButton class="action-btn action-btn--secondary" @uploaded="onUploaded" />
        </div>

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
      v-if="currentSong"
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

:global(body.home-page) {
  height: auto;
  min-height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  margin: 0;

  position: relative;
  z-index: 0;

  /* ✅ FIX RGB stacking (evita bugs de z-index / iOS) */
  isolation: isolate;

  background:
    radial-gradient(900px 500px at 20% 10%, rgba(99,102,241,0.35), transparent 60%),
    radial-gradient(900px 500px at 80% 15%, rgba(34,197,94,0.22), transparent 60%),
    radial-gradient(900px 500px at 50% 90%, rgba(239,68,68,0.10), transparent 55%),
    linear-gradient(180deg, #f8fafc 0%, #eef2ff 45%, #f8fafc 100%);
}

/* =========================================
   🌈 RGB MODE (GLOBAL) — ANIMADO DE VERDAD
========================================= */

/* fallback base cuando RGB está ON */
:global(html.rgb-mode) {
  background: #0b0b0c !important;
}

/* El Home debe dejar ver el fondo */
:global(html.rgb-mode body.home-page) {
  background: transparent !important;
}

/* Capa de fondo animada DETRÁS del contenido (sin bloquear clicks) */
:global(html.rgb-mode body.home-page::before) {
  content: "";
  position: fixed;
  inset: 0;

  /* ✅ FIX: no usar -1 (puede desaparecer / congelarse en algunos navegadores) */
  z-index: 0;

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
  animation: rgbMove 10s ease-in-out infinite;
  will-change: background-position;
}

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

  overflow-x: hidden;
  overflow-y: visible !important;

  min-height: 100vh;
  background: transparent;

  /* ✅ FIX RGB: el contenido por encima del ::before */
  position: relative;
  z-index: 1;
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
   3. HEADER Y LOGO
   ========================================= */
.header {
  text-align: center;
  width: 100%;
  padding: 10px 16px 0;
  position: relative;
  z-index: 10000;
  overflow: visible;
}

@media (max-width: 1023px) {
  .header { padding-top: 8px; }
}

.logo-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  margin: 0 0 8px;
  min-height: 84px;
  position: relative;
  z-index: 2;
  overflow: visible;
}

@media (max-width: 1023px) {
  .logo-wrapper {
    min-height: 68px;
    margin-bottom: 6px;
    padding-top: 12px;
  }
}

.app-logo {
  width: min(300px, 86vw);
  height: auto;
  display: block;
  margin: -90px;
  transition: none !important;
  transform: translateY(12px);
}

.version {
  display: block;
  margin-top: 0px;
  margin-bottom: 6px;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: .12em;
  text-transform: uppercase;
  opacity: .55;
  color: rgba(0,0,0,.65);
}

.modern-actions {
  margin-top: 0 !important;
  padding-top: 0;
  position: relative;
  z-index: 3;
}

/* =========================================
   4. BOTONES DE ACCIÓN
   ========================================= */
.modern-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-top: 6px;
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
  isolation: isolate;
  contain: paint;
  transition: transform .18s ease, filter .18s ease, box-shadow .18s ease;
  background-size: 220% 220%;
  background-position: 0% 50%;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  transform: translateZ(0);
}

.action-btn__emoji {
  font-size: 1.1rem;
  line-height: 1;
}

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

/* ✅ UploadButton viene de un componente y NO hereda class cuando renderiza fragment.
   Lo envolvemos con `.upload-wrap` y forzamos estilos SOLO a su <button> interno. */
.upload-wrap {
  display: inline-flex;
}

.upload-wrap :deep(button) {
  /* misma pinta que .action-btn--secondary */
  padding: 14px 22px !important;
  border-radius: 999px !important;
  background: rgba(255,255,255,0.75) !important;
  background-image: none !important;
  backdrop-filter: blur(12px) !important;
  -webkit-backdrop-filter: blur(12px) !important;
  border: 1px solid rgba(255,255,255,0.5) !important;
  color: rgba(0,0,0,0.85) !important;
  box-shadow:
    0 8px 24px rgba(0,0,0,0.10),
    inset 0 1px 0 rgba(255,255,255,0.8) !important;

  font-weight: 700 !important;
  font-size: 0.92rem !important;
  line-height: 1 !important;

  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 8px !important;

  cursor: pointer !important;
  position: relative !important;
  overflow: hidden !important;
  isolation: isolate !important;
  contain: paint !important;
  transition: transform .18s ease, filter .18s ease, box-shadow .18s ease !important;
  -webkit-tap-highlight-color: transparent !important;
}

.upload-wrap :deep(button:hover) {
  transform: translateY(-3px) !important;
  box-shadow:
    0 14px 35px rgba(0,0,0,0.15),
    inset 0 1px 0 rgba(255,255,255,0.9) !important;
  background: rgba(255,255,255,0.92) !important;
}

.upload-wrap :deep(button:active) {
  transform: translateY(1px) scale(0.98) !important;
}

:global(.p-dark) .upload-wrap :deep(button) {
  background: rgba(30,30,34,0.65) !important;
  border-color: rgba(255,255,255,0.15) !important;
  color: rgba(255,255,255,0.92) !important;
}

/* Gradient overlay */
.action-btn::after {
  border-radius: inherit;
  inset: 0;
  opacity: 0;
  background: linear-gradient(96deg, rgba(242,203,254,1), rgba(87,195,249,1), rgba(63,252,106,1));
  background-size: 240% 240%;
  background-position: 0% 50%;
  box-shadow: 0px 0px 0.5px 0.5px rgba(0, 0, 0, 0.3) inset;
  filter: blur(.0px);
  transition: opacity .18s ease;
  content: "";
  position: absolute;
  z-index: 2;
  pointer-events: none;
}

/* aplica overlay también al botón interno del UploadButton */
.upload-wrap :deep(button)::after {
  border-radius: inherit;
  inset: 0;
  opacity: 0;
  background: linear-gradient(96deg, rgba(242,203,254,1), rgba(87,195,249,1), rgba(63,252,106,1));
  background-size: 240% 240%;
  background-position: 0% 50%;
  box-shadow: 0px 0px 0.5px 0.5px rgba(0, 0, 0, 0.3) inset;
  transition: opacity .18s ease;
  content: "";
  position: absolute;
  z-index: 2;
  pointer-events: none;
}

/* Click / press burst (gradient pop) */
.action-btn::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  z-index: 1;

  /* burst solo dentro del botón (sin afectar el fondo) */
  background:
    radial-gradient(circle at 30% 30%, rgba(242,203,254,.75), transparent 55%),
    radial-gradient(circle at 70% 40%, rgba(87,195,249,.60), transparent 58%),
    radial-gradient(circle at 55% 80%, rgba(63,252,106,.45), transparent 62%);

  opacity: 0;
  transform: scale(.86);
}

.upload-wrap :deep(button)::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  z-index: 1;
  background:
    radial-gradient(circle at 30% 30%, rgba(242,203,254,.75), transparent 55%),
    radial-gradient(circle at 70% 40%, rgba(87,195,249,.60), transparent 58%),
    radial-gradient(circle at 55% 80%, rgba(63,252,106,.45), transparent 62%);
  opacity: 0;
  transform: scale(.86);
}

/* Keep button content above overlays */
.action-btn > * {
  position: relative;
  z-index: 3;
}

.upload-wrap :deep(button) > * {
  position: relative;
  z-index: 3;
}

.action-btn:active::before {
  opacity: .95;
  transform: scale(1);
  animation: btnBurst .55s ease-out both;
}

.upload-wrap :deep(button:active)::before {
  opacity: .95;
  transform: scale(1);
  animation: btnBurst .55s ease-out both;
}

/* Keyboard accessibility */
.action-btn:focus-visible::before {
  opacity: .65;
  transform: scale(1);
  animation: btnBurst .65s ease-out both;
}

.upload-wrap :deep(button:focus-visible)::before {
  opacity: .65;
  transform: scale(1);
  animation: btnBurst .65s ease-out both;
}

@keyframes btnBurst {
  0%   { opacity: 0; transform: scale(.72); }
  35%  { opacity: .95; transform: scale(1.02); }
  100% { opacity: 0; transform: scale(1.08); }
}


.action-btn:hover {
  transform: translateY(-3px) scale(1.02);
  filter: brightness(1.05) saturate(1.1);
}

.action-btn:hover::after {
  opacity: .85;
  animation: btnGradientSlide 1.4s ease-in-out infinite;
}

.upload-wrap :deep(button:hover)::after {
  opacity: .85;
  animation: btnGradientSlide 1.4s ease-in-out infinite;
}


.action-btn:active {
  transform: translateY(1px) scale(0.98);
  filter: brightness(0.98);
}

@keyframes btnGradientSlide {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}


/* =========================================
   5. BUSCADOR MÓVIL
   ========================================= */
.m-search { display: none; }

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
    z-index: 10000;
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

  .m-search__clear:active { transform: scale(0.96); }

  .m-search:focus-within {
    transform: translateY(-1px);
    box-shadow:
      0 28px 80px rgba(0,0,0,0.18),
      0 0 0 8px rgba(99,102,241,0.10),
      inset 0 1px 0 rgba(255,255,255,0.78);
  }

  .m-search:focus-within::before { opacity: 0.95; }
}

/* =========================================
   7. SEARCH PANEL ESCRITORIO
   ========================================= */
.search-panel {
  width: min(420px, calc(100% - 32px));
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
    left: 96px;
    top: 162px;
    z-index: 1000;
  }
}

@media (max-width: 1023px) {
  .search-panel {
    display: none !important;
  }
}

.search-field {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 50px;
  padding: 0 12px;
  border-radius: 999px;
  position: relative;

  background: rgba(255, 255, 255, 0.60);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.45);

  box-shadow:
    0 18px 50px rgba(0, 0, 0, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.75);

  transition: transform .18s ease, box-shadow .18s ease, background .18s ease;
}

.search-field::before {
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
  opacity: .55;
  pointer-events: none;
  transition: opacity .2s ease;
}

.search-field:focus-within {
  transform: translateY(-1px);
  background: rgba(255, 255, 255, 0.72);
  box-shadow:
    0 26px 80px rgba(0, 0, 0, 0.16),
    0 0 0 8px rgba(99, 102, 241, 0.10),
    inset 0 1px 0 rgba(255, 255, 255, 0.82);
}

.search-field:focus-within::before { opacity: .95; }

.search-left-input {
  flex: 1;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  font-size: 15px;
  font-weight: 750;
  color: rgba(0,0,0,0.82);
}

.search-left-input::placeholder {
  color: rgba(0,0,0,0.42);
  font-weight: 700;
}

.search-close-inside {
  width: 34px;
  height: 34px;
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
  transition: transform .15s ease, background .15s ease, filter .15s ease;
  flex: 0 0 auto;
}

.search-close-inside:hover {
  filter: brightness(1.05);
}

.search-close-inside:active { transform: scale(0.96); }

:global(.p-dark) .search-field {
  background: rgba(20,20,22,0.55);
  border-color: rgba(255,255,255,0.14);
  box-shadow:
    0 22px 60px rgba(0,0,0,0.38),
    inset 0 1px 0 rgba(255,255,255,0.08);
}

:global(.p-dark) .search-left-input {
  color: rgba(255,255,255,0.88);
}

:global(.p-dark) .search-left-input::placeholder {
  color: rgba(255,255,255,0.40);
}

:global(.p-dark) .search-close-inside {
  border-color: rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.10);
  color: rgba(255,255,255,0.92);
  box-shadow:
    0 14px 28px rgba(0,0,0,0.35),
    inset 0 1px 0 rgba(255,255,255,0.10);
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

  /* ✅ nuevo: para recortar la imagen bien */
  overflow: hidden;
}

.user-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
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

.user-status.online { opacity: 1; }

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
.mobile-sidebar-btn { display: none; }

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

  .mobile-sidebar-btn:active { transform: scale(.96); }
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

.m-side-item span { display: none; }

.m-side-item:hover {
  transform: translateY(-1px) scale(1.02);
  background: rgba(255,255,255,0.28);
}

.m-side-item:active { transform: scale(.96); }

/* =========================================
   11. PLAYLIST WRAP
   ========================================= */
.playlist-wrap {
  width: 100%;
  margin-top: 6px;
  position: relative;
  z-index: 0;
}

@media (max-width: 1023px) {
  .playlist-wrap { margin-top: 6px; }
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

:global(.p-dark) .m-search__input { color: rgba(255,255,255,0.88); }

:global(.p-dark) .m-search__input::placeholder { color: rgba(255,255,255,0.40); }

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

:global(.p-dark) .version { color: rgba(255,255,255,0.5); }

:global(.p-dark) .stats-box,
:global(.p-dark) .users-box {
  background: #1a1a2e;
  color: white;
}

:global(.p-dark) .user-item { background: rgba(255,255,255,0.06); }

:global(.p-dark) .user-item:hover { background: rgba(255,255,255,0.12); }

/* =========================================
   🫂 GROUPS PANEL (nuevo diseño)
   ========================================= */
.groups-overlay {
  position: fixed;
  inset: 0;
  z-index: 99990;
  background: rgba(0,0,0,.25);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  display: grid;
  place-items: center;
  padding: 18px;
}

.groups-shell {
  width: min(1060px, calc(100% - 10px));
  height: min(720px, calc(100vh - 120px));
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 16px;
  padding: 16px;
  border-radius: 28px;
  background: rgba(255,255,255,0.70);
  border: 1px solid rgba(255,255,255,0.40);
  box-shadow: 0 30px 90px rgba(0,0,0,.25);
  backdrop-filter: blur(22px);
  -webkit-backdrop-filter: blur(22px);
}

.groups-list {
  border-radius: 22px;
  background: rgba(255,255,255,0.65);
  border: 1px solid rgba(255,255,255,0.45);
  box-shadow: 0 18px 50px rgba(0,0,0,0.10);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.groups-list__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 14px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
}

.groups-list__title {
  font-weight: 900;
  letter-spacing: .02em;
}

.groups-close {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,0.08);
  background: rgba(0,0,0,0.06);
  cursor: pointer;
  font-weight: 900;
}

.groups-close:active { transform: scale(.96); }

.groups-list__header-actions {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.groups-add {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,0.08);
  background: rgba(99,102,241,0.12);
  cursor: pointer;
  font-weight: 900;
  display: grid;
  place-items: center;
}

.groups-add:hover {
  background: rgba(99,102,241,0.18);
}

.groups-add:active {
  transform: scale(.96);
}

.groups-empty-cta {
  margin-top: 12px;
  width: 100%;
  padding: 12px;
  border-radius: 999px;
  border: none;
  cursor: pointer;
  font-weight: 900;
  color: white;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  box-shadow: 0 14px 30px rgba(99,102,241,.25);
}

.groups-empty-cta:active { transform: scale(.98); }

/* ✅ Create group overlay */
.create-group-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  background: rgba(0,0,0,0.25);
  display: grid;
  place-items: center;
  padding: 18px;
}

.create-group-card {
  width: min(520px, calc(100% - 10px));
  max-height: calc(100% - 10px);
  overflow: hidden;
  border-radius: 22px;
  background: rgba(255,255,255,0.92);
  border: 1px solid rgba(255,255,255,0.50);
  box-shadow: 0 30px 90px rgba(0,0,0,.25);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.create-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.create-group-title {
  font-weight: 950;
  letter-spacing: .01em;
}

.create-group-x {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,0.08);
  background: rgba(0,0,0,0.06);
  cursor: pointer;
  font-weight: 900;
}

.create-group-label {
  font-size: .86rem;
  font-weight: 900;
  opacity: .8;
}

.create-group-input {
  height: 44px;
  border-radius: 999px;
  border: 1px solid rgba(0,0,0,0.10);
  padding: 0 14px;
  font-weight: 800;
  outline: none;
  background: rgba(255,255,255,0.85);
}

.create-group-users {
  flex: 1;
  min-height: 180px;
  max-height: 320px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 6px 2px;
}

.create-user {
  width: 100%;
  display: grid;
  grid-template-columns: 44px 1fr 24px;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 16px;
  border: 1px solid rgba(0,0,0,0.06);
  background: rgba(255,255,255,0.75);
  cursor: pointer;
  text-align: left;
  transition: transform .15s ease, box-shadow .15s ease, background .15s ease;
}

.create-user:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 30px rgba(0,0,0,0.10);
}

.create-user.selected {
  background: linear-gradient(135deg, rgba(99,102,241,0.18), rgba(34,197,94,0.14));
  border-color: rgba(99,102,241,0.22);
}

.cu-avatar {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background: rgba(0,0,0,0.06);
  overflow: hidden;
}

.cu-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.cu-name {
  font-weight: 900;
}

.cu-check {
  font-weight: 950;
  color: rgba(0,0,0,0.65);
}

.create-group-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 6px;
}

.create-group-cancel {
  height: 44px;
  border-radius: 999px;
  border: 1px solid rgba(0,0,0,0.10);
  background: rgba(0,0,0,0.06);
  cursor: pointer;
  font-weight: 900;
}

.create-group-create {
  height: 44px;
  border-radius: 999px;
  border: none;
  cursor: pointer;
  font-weight: 950;
  color: white;
  background: linear-gradient(135deg, #22c55e, #16a34a);
  box-shadow: 0 14px 30px rgba(34,197,94,.25);
}

.create-group-create:disabled {
  opacity: .5;
  cursor: not-allowed;
  box-shadow: none;
}

:global(.p-dark) .groups-add {
  border-color: rgba(255,255,255,0.14);
  background: rgba(99,102,241,0.22);
  color: rgba(255,255,255,0.92);
}

:global(.p-dark) .create-group-card {
  background: rgba(20,20,22,0.92);
  border-color: rgba(255,255,255,0.14);
  color: rgba(255,255,255,0.92);
}

:global(.p-dark) .create-group-input {
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.12);
  color: rgba(255,255,255,0.92);
}

:global(.p-dark) .create-user {
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.10);
  color: rgba(255,255,255,0.92);
}

:global(.p-dark) .create-group-x,
:global(.p-dark) .create-group-cancel {
  border-color: rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.92);
}

.groups-items {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
}

.group-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-radius: 16px;
  border: 1px solid rgba(0,0,0,0.06);
  background: rgba(255,255,255,0.75);
  cursor: pointer;
  text-align: left;
  transition: transform .15s ease, background .15s ease, box-shadow .15s ease;
}

.group-row:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 30px rgba(0,0,0,0.10);
}

.group-row.is-active {
  background: linear-gradient(135deg, rgba(99,102,241,0.22), rgba(34,197,94,0.18));
  border-color: rgba(99,102,241,0.22);
}

.group-avatar {
  width: 42px;
  height: 42px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background: rgba(0,0,0,0.06);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.7);
  flex: 0 0 auto;
}

.group-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.group-name {
  font-weight: 900;
}

.group-sub {
  font-size: .8rem;
  opacity: .7;
  font-weight: 750;
}

.groups-chat {
  border-radius: 26px;
  background: rgba(255,255,255,0.78);
  border: 1px solid rgba(255,255,255,0.50);
  box-shadow: 0 18px 50px rgba(0,0,0,0.10);
  overflow: hidden;
  display: grid;
  grid-template-rows: auto 1fr auto;
}

.groups-chat__header {
  padding: 14px 16px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.groups-chat__title {
  font-weight: 900;
}

.groups-chat__hint {
  font-size: .82rem;
  opacity: .6;
  font-weight: 800;
}

.groups-chat__members {
  flex: 1;
  margin: 0 10px;
  padding: 6px 10px;
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,0.06);
  background: rgba(255,255,255,0.55);
  font-weight: 850;
  font-size: 0.86rem;
  opacity: 0.9;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
  color: rgba(0,0,0,0.82);
}

:global(.p-dark) .groups-chat__members {
  border-color: rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.92);
}

.groups-chat__body {
  padding: 16px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.msg {
  max-width: 70%;
  padding: 12px 14px;
  border-radius: 16px;
  font-weight: 750;
  box-shadow: 0 12px 26px rgba(0,0,0,0.08);
}

.msg--left {
  align-self: flex-start;
  background: rgba(255,255,255,0.88);
  border: 1px solid rgba(0,0,0,0.06);
}

.msg--right {
  align-self: flex-end;
  color: white;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
}

.msg-text {
  white-space: pre-wrap;
  word-break: break-word;
}

.msg-time {
  margin-top: 6px;
  font-size: 0.72rem;
  font-weight: 800;
  opacity: 0.75;
}

.groups-empty {
  padding: 18px;
  font-weight: 800;
  opacity: 0.75;
}

.groups-chat__composer button:disabled,
.groups-chat__composer input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.groups-chat__composer {
  padding: 12px;
  border-top: 1px solid rgba(0,0,0,0.06);
  display: grid;
  grid-template-columns: 44px 1fr 110px;
  gap: 10px;
  align-items: center;
}

.composer-btn {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  border: 1px solid rgba(0,0,0,0.08);
  background: rgba(0,0,0,0.05);
  cursor: pointer;
}

.composer-input {
  height: 44px;
  border-radius: 999px;
  border: 1px solid rgba(0,0,0,0.10);
  padding: 0 14px;
  font-weight: 750;
  outline: none;
  background: rgba(255,255,255,0.75);
}

.composer-send {
  height: 44px;
  border-radius: 999px;
  border: none;
  cursor: pointer;
  font-weight: 900;
  color: white;
  background: linear-gradient(135deg, #22c55e, #16a34a);
  box-shadow: 0 14px 30px rgba(34,197,94,.25);
}

@media (max-width: 900px) {
  .groups-shell {
    grid-template-columns: 1fr;
    grid-template-rows: 220px 1fr;
    height: calc(100vh - 120px);
  }
  .groups-chat__members {
    display: none;
  }
}

:global(.p-dark) .groups-shell {
  background: rgba(20,20,22,0.72);
  border-color: rgba(255,255,255,0.14);
}

:global(.p-dark) .groups-list,
:global(.p-dark) .groups-chat {
  background: rgba(30,30,34,0.65);
  border-color: rgba(255,255,255,0.14);
}

:global(.p-dark) .group-row {
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.10);
  color: rgba(255,255,255,0.92);
}

:global(.p-dark) .msg--left {
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.10);
  color: rgba(255,255,255,0.92);
}

:global(.p-dark) .msg-time {
  opacity: 0.7;
}

:global(.p-dark) .composer-input {
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.12);
  color: rgba(255,255,255,0.92);
}

/* =========================================
   ✅ COMPLETE PROFILE MODAL OPEN
   ========================================= */
.home.complete-open .header,
.home.complete-open .side-card,
.home.complete-open .mobile-sidebar-btn,
.home.complete-open .search-panel,
.home.complete-open .m-search,
.home.complete-open .mobile-sidebar-overlay,
.home.complete-open .mobile-sidebar-drawer {
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}

.home.complete-open .playlist-wrap {
  pointer-events: none !important;
}
</style>