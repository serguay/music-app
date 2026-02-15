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
// ✅ MOBILE: drawer de grupos (solo móvil)
const showGroupsDrawer = ref(false)
// ✅ Crear grupo (UI)
const showCreateGroup = ref(false)
// ✅ MOBILE: menú (3 puntitos) en header del chat de grupos
const showGroupsMobileMenu = ref(false)

// ✅ INVITE LINK (share/join)
const buildGroupInviteLink = (groupId) => {
  if (!groupId) return ''
  try {
    const url = new URL(window.location.href)
    url.searchParams.set('joinGroup', String(groupId))
    return url.toString()
  } catch {
    // fallback
    const base = `${window.location.origin}${window.location.pathname}${window.location.hash || '#/app'}`
    const sep = base.includes('?') ? '&' : '?'
    return `${base}${sep}joinGroup=${encodeURIComponent(String(groupId))}`
  }
}

const shareActiveGroupInvite = async () => {
  if (!activeGroupId.value) return
  const link = buildGroupInviteLink(activeGroupId.value)
  const title = `Invitación a ${activeGroupName.value || 'un grupo'}`

  try {
    // Prefer native share on mobile
    if (navigator.share) {
      await navigator.share({ title, text: title, url: link })
      alert('Link de invitación compartido ✅')
      return
    }
  } catch {
    // ignore and fallback to clipboard
  }

  try {
    await navigator.clipboard.writeText(link)
    alert('Link copiado ✅')
  } catch {
    // last-resort fallback
    window.prompt('Copia este link:', link)
  }
}

const tryJoinGroupFromInvite = async () => {
  if (!userId.value) return

  let joinId = null
  try {
    const url = new URL(window.location.href)
    joinId = url.searchParams.get('joinGroup')
  } catch {
    // ignore
  }

  if (!joinId) return

  // Limpia el param para que no reintente siempre
  try {
    const url = new URL(window.location.href)
    url.searchParams.delete('joinGroup')
    window.history.replaceState({}, '', url.toString())
  } catch {
    // ignore
  }

  const groupId = String(joinId).trim()
  if (!groupId) return

  try {
    // ✅ upsert evita error si ya eres miembro (requiere unique(group_id,user_id))
    const { error } = await supabase
      .from('group_members')
      .upsert(
        { group_id: groupId, user_id: userId.value, role: 'member' },
        { onConflict: 'group_id,user_id', ignoreDuplicates: true }
      )

    if (error) {
      console.warn('[group_members] join via invite error:', error)
      alert('No se pudo unir al grupo (RLS/policies).')
      return
    }

    // abre el panel de grupos, recarga y selecciona
    showGroups.value = true
    await loadMyGroups()
    const g = (groups.value || []).find((x) => x?.id === groupId)
    if (g) await selectGroup(g)

    alert('Te has unido al grupo ✅')
  } catch (e) {
    console.warn('[group_members] join via invite exception:', e)
    alert('No se pudo unir al grupo.')
  }
}
const creatingGroup = ref(false)
const createGroupName = ref('')
const createSelectedUserIds = ref([])
// ✅ Crear grupo: buscador de usuarios
const createUserSearch = ref('')

const filteredCreateUsers = computed(() => {
  const q = (createUserSearch.value || '').trim().toLowerCase()
  const list = Array.isArray(users.value) ? users.value : []

  // excluye al propio usuario
  const base = list.filter((x) => x?.id && x.id !== userId.value)

  if (!q) return base

  return base.filter((u) => {
    const uname = (u?.username ?? '').toString().toLowerCase()
    // también permite buscar por prefijo de id para casos sin username
    const sid = (u?.id ?? '').toString().toLowerCase()
    return uname.includes(q) || sid.includes(q)
  })
})
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


// ✅ evita que un grupo borrado (optimistic) reaparezca si hay refresh/reload
const deletingGroupIds = ref([])
const isDeletingGroup = (gid) => (deletingGroupIds.value || []).includes(gid)

// ✅ grupos ocultos tras borrar (evita que reaparezcan al reabrir mientras el backend se sincroniza)
const hiddenGroupIds = ref([])
const hideGroupId = (gid) => {
  if (!gid) return
  const set = new Set(hiddenGroupIds.value || [])
  set.add(gid)
  hiddenGroupIds.value = Array.from(set)
}
const unhideGroupId = (gid) => {
  if (!gid) return
  hiddenGroupIds.value = (hiddenGroupIds.value || []).filter((x) => x !== gid)
}

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

    // ✅ filtra los que están en proceso de borrado (evita que “reaparezcan”)
    const list = gs || []
    const del = new Set(deletingGroupIds.value || [])
    const hidden = new Set(hiddenGroupIds.value || [])
    groups.value = list.filter((g) => {
      const id = g?.id
      if (!id) return false
      if (del.has(id)) return false
      if (hidden.has(id)) return false
      return true
    })

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
  createUserSearch.value = ''

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
  createUserSearch.value = ''
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

const clearActiveGroupMessages = async () => {
  const gid = activeGroupId.value
  if (!gid) return

  const ok = confirm('¿Borrar todos los mensajes de este grupo?')
  if (!ok) return

  // Optimistic UI
  const prev = [...(groupMessages.value || [])]
  const hadMessages = prev.length > 0
  groupMessages.value = []

  // ⚠️ Con RLS, un DELETE puede “no hacer nada” y tampoco dar error.
  // Por eso pedimos RETURNING con `.select('id')` y comprobamos cuántas filas se borraron.
  const { data: deletedRows, error } = await supabase
    .from('group_messages')
    .delete()
    .eq('group_id', gid)
    .select('id')

  if (error) {
    console.warn('[group_messages] delete error:', error)
    alert('No se pudieron borrar los mensajes (RLS/policies).')
    groupMessages.value = prev
    await loadGroupMessages(gid)
    return
  }

  // Si había mensajes pero Supabase dice que borró 0, es casi seguro RLS (o policy demasiado estricta)
  if (hadMessages && (!Array.isArray(deletedRows) || deletedRows.length === 0)) {
    console.warn('[group_messages] delete returned 0 rows (likely RLS)')
    alert('No se pudieron borrar los mensajes (RLS/policies).')
    groupMessages.value = prev
    await loadGroupMessages(gid)
    return
  }

  // ✅ borrado OK, refresca por si quedaba algo por realtime/cache
  await loadGroupMessages(gid)
}

const deleteActiveGroup = async () => {
  const gid = activeGroupId.value
  if (!gid) return

  const gname = (activeGroupName.value || 'Grupo').trim()
  const ok = confirm(`¿Eliminar el grupo "${gname}"?\n\nSi no eres el creador, saldrás del grupo.`)
  if (!ok) return

  // ✅ ocultamos YA el grupo en UI para que no "reaparezca" al cerrar/abrir el modal
  hideGroupId(gid)

  // marca como deleting para que un refresh no lo vuelva a meter
  if (!isDeletingGroup(gid)) {
    deletingGroupIds.value = [...(deletingGroupIds.value || []), gid]
  }

  // cierra realtime del grupo
  if (groupMessagesChannel) {
    supabase.removeChannel(groupMessagesChannel)
    groupMessagesChannel = null
  }

  // Optimistic UI
  const prevGroups = [...(groups.value || [])]
  groups.value = prevGroups.filter((g) => g?.id !== gid)

  activeGroupId.value = null
  activeGroupName.value = ''
  groupMembers.value = []
  groupMessages.value = []
  groupMessageText.value = ''

  try {
    // 1) borrar mensajes (puede fallar por RLS)
    const { error: msgErr } = await supabase
      .from('group_messages')
      .delete()
      .eq('group_id', gid)
    if (msgErr) throw msgErr

    // 2) borrar miembros del grupo (solo funcionará si tienes policy)
    const { data: memDel, error: memErr } = await supabase
      .from('group_members')
      .delete()
      .eq('group_id', gid)
      .select('user_id')
    if (memErr) throw memErr

    // si no borró nada, seguramente RLS (no owner)
    if (!Array.isArray(memDel) || memDel.length === 0) {
      throw new Error('No se pudo borrar membership (0 rows).')
    }

    // 3) borrar grupo (solo owner con policy)
    const { data: gDel, error: gErr } = await supabase
      .from('groups')
      .delete()
      .eq('id', gid)
      .select('id')
    if (gErr) throw gErr

    if (!Array.isArray(gDel) || gDel.length === 0) {
      throw new Error('No se pudo borrar el grupo (0 rows).')
    }

    await loadMyGroups()
  } catch (e) {
    console.warn('[groups] delete group error (will try leave-group fallback):', e)

    // ✅ Fallback: si no puedes eliminar (RLS), al menos SAL del grupo
    try {
      const { data: leftRows, error: leaveErr } = await supabase
        .from('group_members')
        .delete()
        .eq('group_id', gid)
        .eq('user_id', userId.value)
        .select('user_id')

      if (leaveErr) throw leaveErr

      if (Array.isArray(leftRows) && leftRows.length > 0) {
        // te has salido: recarga y mantén oculto
        await loadMyGroups()
        alert('Has salido del grupo.')
      } else {
        // no se pudo ni salir: rollback
        unhideGroupId(gid)
        groups.value = prevGroups
        await loadMyGroups()
        alert('No se pudo eliminar ni salir del grupo (RLS/policies).')
      }
    } catch (leaveE) {
      console.warn('[groups] leave group fallback failed:', leaveE)
      unhideGroupId(gid)
      groups.value = prevGroups
      await loadMyGroups()
      alert('No se pudo eliminar ni salir del grupo (RLS/policies).')
    }
  } finally {
    deletingGroupIds.value = (deletingGroupIds.value || []).filter((id) => id !== gid)
    showGroupsDrawer.value = false
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

// ✅ NOW PLAYING (Realtime Presence)
const nowPlayingMap = ref({})

const updateNowPlayingState = () => {
  if (!presenceChannel) return
  const state = presenceChannel.presenceState?.() || {}

  const map = {}
  for (const [uid, arr] of Object.entries(state)) {
    const payload = Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null
    const title = (payload?.now_playing_title ?? '').toString().trim()
    const artist = (payload?.now_playing_artist ?? '').toString().trim()
    const songId = payload?.now_playing_id ?? null

    if (title) map[uid] = { id: songId, title, artist }
  }

  nowPlayingMap.value = map
}

const getNowPlaying = (uid) => nowPlayingMap.value?.[uid] || null

const activeGroupNowPlayingText = computed(() => {
  if (!activeGroupId.value) return ''
  const list = Array.isArray(groupMembers.value) ? groupMembers.value : []

  const rows = list
    .map((m) => {
      const np = getNowPlaying(m?.id)
      if (!np?.title) return null
      const who = (m?.username ?? '').toString().trim() || (m?.id ? `Usuario ${String(m.id).slice(0, 6)}` : 'Usuario')
      const what = np.artist ? `${np.title} — ${np.artist}` : np.title
      return `🎧 ${who}: ${what}`
    })
    .filter(Boolean)

  if (!rows.length) return ''
  return rows.slice(0, 3).join(' · ') + (rows.length > 3 ? ` · +${rows.length - 3} más…` : '')
})

// ✅ NOW PLAYING publish (debounce)
let nowPlayingTimer = null

const publishNowPlaying = async (song) => {
  if (!presenceChannel || !userId.value) return

  const title = (song?.title ?? song?.name ?? '').toString().trim()
  const artist = (song?.artist ?? '').toString().trim()

  try {
    await presenceChannel.track({
      online_at: new Date().toISOString(),
      now_playing_id: song?.id ?? null,
      now_playing_title: title,
      now_playing_artist: artist,
      now_playing_at: new Date().toISOString()
    })
  } catch {}
}

watch(
  () => currentSong.value,
  (song) => {
    if (nowPlayingTimer) clearTimeout(nowPlayingTimer)
    nowPlayingTimer = setTimeout(() => publishNowPlaying(song), 350)
  }
)



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
  updateNowPlayingState()
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
    // al abrir el panel, refrescamos y cerramos drawer móvil
    showGroupsDrawer.value = false
    showGroupsMobileMenu.value = false
    await loadMyGroups()
  } else {
    showGroupsDrawer.value = false
    showGroupsMobileMenu.value = false
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
          online_at: new Date().toISOString(),
          now_playing_id: currentSong.value?.id ?? null,
          now_playing_title: (currentSong.value?.title ?? currentSong.value?.name ?? '').toString().trim(),
          now_playing_artist: (currentSong.value?.artist ?? '').toString().trim(),
          now_playing_at: new Date().toISOString()
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
  // ✅ si vienes con un link de invitación, intenta unirte
  await tryJoinGroupFromInvite()

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
  if (nowPlayingTimer) {
    clearTimeout(nowPlayingTimer)
    nowPlayingTimer = null
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


const goToCreateSong = () => router.push('/create-song')

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

// ✅ MINI PLAYER (para usar dentro de Grupos sin mostrar el PlayerBar grande)
const isPlaying = computed(() => {
  // soporta varias versiones del store
  const v = player?.isPlaying ?? player?.playing ?? player?.is_playing
  return !!v
})

const togglePlayPause = () => {
  // 1) método directo si existe
  if (typeof player?.togglePlay === 'function') return player.togglePlay()
  if (typeof player?.togglePlayback === 'function') return player.togglePlayback()

  // 2) pausa / resume si existen
  if (isPlaying.value) {
    if (typeof player?.pause === 'function') return player.pause()
    if (typeof player?.pauseSong === 'function') return player.pauseSong()
    if (typeof player?.setPlaying === 'function') return player.setPlaying(false)
  } else {
    if (typeof player?.resume === 'function') return player.resume()
    if (typeof player?.resumeSong === 'function') return player.resumeSong()

    // fallback: vuelve a reproducir la canción actual
    if (currentSong.value) callPlayerPlay(currentSong.value)
  }
}

const stopPlayback = () => {
  if (typeof player?.stopSong === 'function') return player.stopSong()
  if (typeof player?.stop === 'function') return player.stop()
  // fallback: intenta pausar
  if (typeof player?.pause === 'function') return player.pause()
  if (typeof player?.pauseSong === 'function') return player.pauseSong()
}

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
    <div v-if="!showProfileModal" class="side-card">
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
        title="Crear canción"
        @click="goToCreateSong"
      >
        🎼
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
      v-if="!showGroups && !showProfileModal"
      class="mobile-sidebar-btn"
      @click="showMobileSidebar = !showMobileSidebar"
      aria-label="Menú"
      title="Menú"
    >
      ☰
    </button>

    <!-- ✅ DRAWER MÓVIL -->
    <div
      v-if="showMobileSidebar && !showProfileModal"
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
            @click="goToCreateSong(); showMobileSidebar = false"
            title="Crear canción"
          >
            🎼
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
    <div v-if="showSearch && !showProfileModal" class="search-panel">
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
    <div v-if="showGroups" class="groups-overlay" @click.self="showGroups = false; showGroupsMobileMenu = false">
      <div class="groups-shell">
        <!-- ✅ MOBILE: backdrop cuando el drawer está abierto -->
        <div
          v-if="showGroupsDrawer"
          class="groups-mobile-backdrop"
          @click="showGroupsDrawer = false"
        ></div>

        <aside class="groups-list" :class="{ 'is-drawer-open': showGroupsDrawer }">
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
              @click="selectGroup(g); showGroupsDrawer = false"
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
            <!-- ✅ MOBILE ONLY: botones header (drawer + crear) -->
            <div class="groups-chat__mobile-actions groups-chat__mobile-actions--left">
              <button
                class="groups-mobile-btn"
                type="button"
                aria-label="Abrir lista de grupos"
                title="Grupos"
                @click="showGroupsDrawer = true"
              >
                ☰
              </button>
            </div>

            <div class="groups-chat__center">
              <div class="groups-chat__title">
                <span class="groups-chat__title-text">{{ activeGroupName || 'Selecciona un grupo' }}</span>

                <div v-if="activeGroupId" class="groups-chat__title-actions">
                  <button
                    class="groups-title-btn"
                    type="button"
                    title="Borrar mensajes"
                    aria-label="Borrar mensajes"
                    @click="clearActiveGroupMessages"
                  >
                    🗑
                  </button>

                  <button
                    class="groups-title-btn groups-title-btn--danger"
                    type="button"
                    title="Eliminar grupo"
                    aria-label="Eliminar grupo"
                    @click="deleteActiveGroup"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div class="groups-chat__members" v-if="activeGroupId">
                {{ activeGroupMembersText }}
              </div>
              <div class="groups-nowplaying" v-if="activeGroupId && activeGroupNowPlayingText">
                {{ activeGroupNowPlayingText }}
              </div>
              <!-- ✅ Mini player en el HEADER: SOLO controles (sin barra larga) -->
              <div v-if="activeGroupId && currentSong" class="groups-mini-player-header">
                <button
                  class="gmp-btn"
                  type="button"
                  @click="togglePlayPause"
                  :title="isPlaying ? 'Pausar' : 'Reproducir'"
                  aria-label="Play/Pause"
                >
                  {{ isPlaying ? '⏸' : '▶' }}
                </button>
                <button
                  class="gmp-btn"
                  type="button"
                  @click="playNext"
                  title="Siguiente"
                  aria-label="Siguiente"
                >
                  ⏭
                </button>
                <button
                  class="gmp-btn gmp-btn--danger"
                  type="button"
                  @click="stopPlayback"
                  title="Parar"
                  aria-label="Parar"
                >
                  ✕
                </button>
              </div>

              <div class="groups-chat__hint" v-if="activeGroupId">(chat de grupo)</div>
              <div class="groups-chat__hint" v-else>(elige uno a la izquierda)</div>
            </div>

            <div class="groups-chat__mobile-actions groups-chat__mobile-actions--right">
              <div class="groups-menu-wrap" @click.stop>
                <button
                  class="groups-mobile-btn groups-mobile-btn--kebab"
                  type="button"
                  aria-label="Menú"
                  title="Menú"
                  @click="showGroupsMobileMenu = !showGroupsMobileMenu"
                >
                  ⋯
                </button>

                <div
                  v-if="showGroupsMobileMenu"
                  class="groups-menu-popover"
                  role="menu"
                >
                  <button
                    class="groups-menu-item"
                    type="button"
                    role="menuitem"
                    @click="openCreateGroup(); showGroupsMobileMenu = false"
                  >
                    ＋ Crear grupo
                  </button>
                  <button
                    class="groups-menu-item"
                    type="button"
                    role="menuitem"
                    :disabled="!activeGroupId"
                    @click="shareActiveGroupInvite(); showGroupsMobileMenu = false"
                  >
                    🔗 Compartir invitación
                  </button>

                  <button
                    class="groups-menu-item"
                    type="button"
                    role="menuitem"
                    :disabled="!activeGroupId"
                    @click="clearActiveGroupMessages(); showGroupsMobileMenu = false"
                  >
                    🗑 Borrar mensajes
                  </button>

                  <button
                    class="groups-menu-item groups-menu-item--danger"
                    type="button"
                    role="menuitem"
                    :disabled="!activeGroupId"
                    @click="deleteActiveGroup(); showGroupsMobileMenu = false"
                  >
                    ✕ Eliminar grupo
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="groups-chat__body">
            <div v-if="!activeGroupId" class="groups-empty">Selecciona un grupo para ver los mensajes.</div>
            <div v-else-if="messagesLoading" class="groups-empty">Cargando mensajes…</div>
            <div v-else-if="!groupMessages.length" class="groups-empty">No hay mensajes aún.</div>

            <div
              v-for="m in groupMessages"
              :key="m.id"
              class="msg"
              :class="{ 'msg--right': m.user_id === userId, 'msg--left': m.user_id !== userId }"
            >
              <div class="msg-bubble">
                <div class="msg-text">{{ m.content }}</div>
                <div class="msg-time">{{ formatGroupTime(m.created_at) }}</div>
              </div>
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

            <div class="create-group-search">
              <span class="cgs-icon">🔎</span>
              <input
                v-model="createUserSearch"
                class="create-group-search-input"
                type="text"
                placeholder="Buscar usuario…"
                autocomplete="off"
              />
              <button
                v-if="createUserSearch"
                class="cgs-clear"
                type="button"
                @click="createUserSearch = ''"
                aria-label="Limpiar búsqueda"
                title="Limpiar"
              >
                ✕
              </button>
            </div>

            <div class="create-group-users">
              <div v-if="!filteredCreateUsers.length" class="create-group-empty">
                No se encontraron usuarios.
              </div>
              <button
                v-for="u in filteredCreateUsers"
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
    <button v-if="!showGroups && !showProfileModal" class="logout-fab" @click="logout">⏻</button>

    <!-- HEADER -->
    <header v-if="!showProfileModal" class="header">
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
    <div v-if="!showProfileModal" class="m-search">
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
    <div v-if="!showProfileModal" class="playlist-wrap">
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
      v-if="currentSong && !showGroups && !showUsers && !showProfileModal"
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
   TABLET: Ajustes para tablets (portrait/landscape)
   Rango: 768px - 1023px
   ========================================= */
@media (min-width: 768px) and (max-width: 1023px) {
  .home {
    max-width: 980px;
    padding-top: 1rem;
    padding-left: 18px;
    padding-right: 18px;
    align-items: flex-start;
    display: grid;
    grid-template-columns: 72px 1fr;
    gap: 18px;
  }

  /* Mostrar barra lateral compacta en tabletas */
  .side-card {
    display: flex;
    flex-direction: column;
    position: fixed;
    left: 12px;
    top: 84px;
    width: 64px;
    height: calc(100vh - 140px);
    align-items: center;
    padding-top: 12px;
    background: rgba(255,255,255,0.60);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border: 1px solid rgba(255,255,255,0.28);
    border-radius: 18px;
    gap: 10px;
    z-index: 100;
    box-shadow: 0 18px 40px rgba(0,0,0,0.08);
  }

  /* Deja espacio a la izquierda para la sidebar */
  .playlist-wrap {
    margin-top: 6px;
    margin-left: 86px;
    width: auto;
    max-width: none;
    padding-right: 12px;
  }

  /* Forzar que logo y acciones principales ocupen la columna principal */
  .logo-wrapper, .modern-actions, .m-search, .search-panel {
    grid-column: 2 / -1;
  }

  /* Oculta el FAB de menú móvil en tablets */
  .mobile-sidebar-btn { display: none !important; }
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
   10. MINI PLAYER EN GRUPOS: SOLO BOTONES, SIN BARRA LARGA
   ========================================= */

/* ✅ Mini player en grupos: solo botones, sin barra larga */
.groups-mini-player-header {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  justify-content: center;
  background: transparent;
  padding: 0;
}

.gmp-btn {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,0.08);
  background: rgba(255,255,255,0.85);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 10px 24px rgba(0,0,0,0.10);
  font-size: 16px;
  font-weight: 800;
  display: grid;
  place-items: center;
  cursor: pointer;
}

.gmp-btn:active {
  transform: scale(0.96);
}

.gmp-btn--danger {
  background: rgba(239,68,68,0.12);
  border-color: rgba(239,68,68,0.22);
}

:global(.p-dark) .gmp-btn {
  border-color: rgba(255,255,255,0.14);
  background: rgba(30,30,34,0.55);
  color: rgba(255,255,255,0.92);
}

:global(.p-dark) .gmp-btn--danger {
  background: rgba(239,68,68,0.18);
  border-color: rgba(239,68,68,0.30);
}

/* ✅ MOBILE: el panel de grupos debe ocupar toda la pantalla (sin bordes/redondeos) */
@media (max-width: 1023px) {
  .groups-overlay {
    padding: 0 !important;
  }

  .groups-shell {
    width: 100vw !important;
    height: 100dvh !important;
    max-width: none !important;
    max-height: none !important;
    margin: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
  }

  /* por si alguno de los paneles internos también tiene bordes redondeados */
  .groups-list,
  .groups-chat {
    border-radius: 0 !important;
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

/* ✅ MINI PLAYER dentro de Grupos */
.groups-mini-player-header{
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  margin-bottom: 10px;
  border-radius: 16px;
  background: rgba(255,255,255,.72);
  border: 1px solid rgba(255,255,255,.55);
  box-shadow: 0 14px 30px rgba(0,0,0,.10);
}

:global(.p-dark) .groups-mini-player-header{
  background: rgba(30,30,34,.62);
  border-color: rgba(255,255,255,.14);
  box-shadow: 0 18px 45px rgba(0,0,0,.35);
}

.gmp-left{
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.gmp-dot{
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: rgba(0,0,0,0.06);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.7);
  flex: 0 0 auto;
}

:global(.p-dark) .gmp-dot{
  background: rgba(255,255,255,0.08);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.10);
}

.gmp-title{
  font-weight: 800;
  font-size: 0.92rem;
  opacity: .9;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: min(360px, 46vw);
}

@media (max-width: 520px){
  .gmp-title{ max-width: 54vw; }
}

.gmp-actions{
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.gmp-btn{
  width: 38px;
  height: 38px;
  border-radius: 14px;
  border: 1px solid rgba(0,0,0,0.08);
  background: rgba(255,255,255,0.75);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 10px 22px rgba(0,0,0,0.10);
  cursor: pointer;
  font-size: 16px;
  font-weight: 900;
  display: grid;
  place-items: center;
  transition: transform .12s ease, filter .12s ease;
}

.gmp-btn:active{ transform: scale(.96); }

:global(.p-dark) .gmp-btn{
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.12);
  color: rgba(255,255,255,0.92);
  box-shadow: 0 12px 28px rgba(0,0,0,0.40);
}

.gmp-btn--danger{
  background: rgba(239,68,68,0.14);
  border-color: rgba(239,68,68,0.20);
}

:global(.p-dark) .gmp-btn--danger{
  background: rgba(239,68,68,0.22);
  border-color: rgba(239,68,68,0.28);
}

/* =========================================
   🫂 GROUPS PANEL (nuevo diseño)
   ========================================= */

.groups-nowplaying{
  margin-top:8px;
  padding:10px 12px;
  border-radius:14px;
  background:rgba(255,255,255,.70);
  border:1px solid rgba(0,0,0,.08);
  box-shadow:0 10px 26px rgba(0,0,0,.10);
  font-weight:750;
  font-size:.88rem;
  line-height:1.2;
  color:rgba(0,0,0,.78);
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
:global(.p-dark) .groups-nowplaying{
  background:rgba(30,30,34,.55);
  border-color:rgba(255,255,255,.12);
  color:rgba(255,255,255,.86);
}
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

/* ✅ FULLSCREEN en móvil */
@media (max-width: 768px) {
  .groups-overlay {
    padding: 0;
    place-items: stretch;
    background: rgba(0,0,0,.18);
  }
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

/* ✅ En móvil ocupa TODA la pantalla */
@media (max-width: 768px) {
  .groups-shell {
    width: 100vw;
    height: 100vh;
    border-radius: 0;
    padding: 0;
    gap: 0;
    grid-template-columns: 1fr;
    background: rgba(255,255,255,0.78);
    border: none;
    box-shadow: none;
  }
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

/* ✅ Backdrop para drawer móvil */
.groups-mobile-backdrop {
  display: none;
}

@media (max-width: 768px) {
  .groups-mobile-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 99991;
    background: rgba(0,0,0,0.28);
  }

  /* Drawer: la lista de grupos se oculta a la izquierda */
  .groups-list {
    position: fixed;
    top: 0;
    left: 0;
    height: 100vh;
    width: min(320px, 86vw);
    z-index: 99992;
    transform: translateX(-110%);
    transition: transform .22s ease;
    border-radius: 0 22px 22px 0;
  }

  .groups-list.is-drawer-open {
    transform: translateX(0);
  }
}

@media (max-width: 768px) {
  .groups-chat {
    width: 100vw;
    height: 100vh;
    border-radius: 0;
  }
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

/* ✅ Header title actions (borrar mensajes / eliminar grupo) */
.groups-chat__title {
  position: relative;
  width: 100%;
  text-align: center;
  font-weight: 950;
  letter-spacing: .01em;
  padding: 0 92px; /* deja espacio para los botones a la derecha */
}

.groups-chat__title-text {
  display: inline-block;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.groups-chat__title-actions {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.groups-title-btn {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,0.08);
  background: rgba(0,0,0,0.06);
  display: grid;
  place-items: center;
  cursor: pointer;
  font-weight: 900;
  transition: transform .12s ease, background .12s ease;
}

.groups-title-btn:hover {
  background: rgba(0,0,0,0.10);
}

.groups-title-btn:active {
  transform: scale(.96);
}

.groups-title-btn--danger {
  background: rgba(239,68,68,0.12);
  border-color: rgba(239,68,68,0.18);
}

.groups-title-btn--danger:hover {
  background: rgba(239,68,68,0.18);
}

:global(.p-dark) .groups-title-btn {
  border-color: rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.92);
}

:global(.p-dark) .groups-title-btn--danger {
  background: rgba(239,68,68,0.22);
  border-color: rgba(239,68,68,0.26);
}

@media (max-width: 640px) {
  .groups-chat__title {
    padding: 0 80px;
  }
}

/* =============================
   🫂 MENSAJES (burbujas)
   ============================= */
.groups-chat__body {
  padding: 14px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.msg {
  display: flex;
  width: 100%;
}

.msg--left {
  justify-content: flex-start;
}

.msg--right {
  justify-content: flex-end;
}

.msg-bubble {
  max-width: min(560px, 78%);
  padding: 10px 12px;
  border-radius: 16px;
  border: 1px solid rgba(0,0,0,0.06);
  background: rgba(255,255,255,0.78);
  box-shadow:
    0 10px 26px rgba(0,0,0,0.08),
    inset 0 1px 0 rgba(255,255,255,0.85);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.msg--left .msg-bubble {
  border-top-left-radius: 10px;
}

.msg--right .msg-bubble {
  border-top-right-radius: 10px;
  background: linear-gradient(135deg, rgba(99,102,241,0.18), rgba(34,197,94,0.14));
  border-color: rgba(99,102,241,0.16);
}

.msg-text {
  font-weight: 750;
  font-size: 0.98rem;
  line-height: 1.25rem;
  color: rgba(0,0,0,0.86);
  white-space: pre-wrap;
  word-break: break-word;
}

.msg-time {
  margin-top: 4px;
  font-size: 0.78rem;
  font-weight: 850;
  opacity: 0.60;
}

.msg--right .msg-time {
  text-align: right;
}

:global(.p-dark) .msg-bubble {
  background: rgba(20,20,22,0.70);
  border-color: rgba(255,255,255,0.12);
  box-shadow:
    0 14px 34px rgba(0,0,0,0.35),
    inset 0 1px 0 rgba(255,255,255,0.06);
}

:global(.p-dark) .msg-text {
  color: rgba(255,255,255,0.92);
}

:global(.p-dark) .msg--right .msg-bubble {
  background: linear-gradient(135deg, rgba(99,102,241,0.28), rgba(34,197,94,0.18));
  border-color: rgba(99,102,241,0.22);
}

/* =============================
   🫂 COMPOSER (input + botones)
   ============================= */
.groups-chat__composer {
  display: grid;
  grid-template-columns: 44px 1fr 92px;
  gap: 10px;
  align-items: center;
  padding: 12px;
  border-top: 1px solid rgba(0,0,0,0.06);
  background: rgba(255,255,255,0.72);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  position: relative;
}

.composer-btn {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  border: 1px solid rgba(0,0,0,0.08);
  background: rgba(0,0,0,0.05);
  cursor: pointer;
  display: grid;
  place-items: center;
  box-shadow:
    0 10px 24px rgba(0,0,0,0.10),
    inset 0 1px 0 rgba(255,255,255,0.75);
  transition: transform .15s ease, background .15s ease;
}

.composer-btn:hover {
  background: rgba(0,0,0,0.07);
}

.composer-btn:active {
  transform: scale(.97);
}

.composer-input {
  height: 44px;
  width: 100%;
  border-radius: 999px;
  border: 1px solid rgba(0,0,0,0.10);
  padding: 0 14px;
  font-size: 15px;
  font-weight: 800;
  outline: none;
  background: rgba(255,255,255,0.85);
  color: rgba(0,0,0,0.84);
  box-shadow:
    0 12px 28px rgba(0,0,0,0.10),
    inset 0 1px 0 rgba(255,255,255,0.85);
  transition: box-shadow .18s ease, background .18s ease, transform .18s ease;
}

.composer-input::placeholder {
  color: rgba(0,0,0,0.42);
  font-weight: 750;
}

.composer-input:focus {
  background: rgba(255,255,255,0.92);
  box-shadow:
    0 18px 44px rgba(0,0,0,0.14),
    0 0 0 6px rgba(99,102,241,0.12),
    inset 0 1px 0 rgba(255,255,255,0.92);
  transform: translateY(-1px);
}

.composer-input:disabled {
  opacity: .55;
  cursor: not-allowed;
}

.composer-send {
  height: 44px;
  border-radius: 999px;
  border: none;
  cursor: pointer;
  font-weight: 950;
  color: white;
  background: linear-gradient(135deg, #22c55e, #16a34a);
  box-shadow: 0 14px 30px rgba(34,197,94,.25);
  transition: transform .15s ease, filter .15s ease, box-shadow .15s ease;
}

.composer-send:hover {
  filter: brightness(1.05);
  box-shadow: 0 18px 40px rgba(34,197,94,.28);
}

.composer-send:active {
  transform: scale(.98);
}

.composer-send:disabled {
  opacity: .5;
  cursor: not-allowed;
  box-shadow: none;
}

@media (max-width: 420px) {
  .groups-chat__composer {
    grid-template-columns: 44px 1fr 82px;
    gap: 8px;
    padding: 10px;
  }
  .composer-input { font-size: 14px; }
  .composer-send { font-size: 14px; }
}

:global(.p-dark) .groups-chat__composer {
  border-top-color: rgba(255,255,255,0.12);
  background: rgba(20,20,22,0.70);
}

:global(.p-dark) .composer-btn {
  border-color: rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.92);
  box-shadow: 0 14px 30px rgba(0,0,0,0.35);
}

:global(.p-dark) .composer-input {
  border-color: rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.92);
  box-shadow: 0 14px 30px rgba(0,0,0,0.35);
}

:global(.p-dark) .composer-input::placeholder {
  color: rgba(255,255,255,0.40);
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

/* =============================
   🫂 GROUPS — MOBILE DRAWER UX
   ============================= */
.groups-chat__mobile-actions {
  display: none; /* desktop: oculto */
}

.groups-chat__center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.groups-mobile-btn {
  width: 40px;
  height: 40px;
  border-radius: 14px;
  border: 1px solid rgba(0,0,0,0.08);
  background: rgba(255,255,255,0.60);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  cursor: pointer;
  font-weight: 950;
  display: grid;
  place-items: center;
  box-shadow: 0 10px 26px rgba(0,0,0,0.10);
}

.groups-mobile-btn:active { transform: scale(.96); }

.groups-mobile-btn--plus {
  background: rgba(99,102,241,0.14);
}

.groups-mobile-backdrop {
  display: none; /* desktop */
}

@media (max-width: 1023px) {
  .groups-shell {
    grid-template-columns: 1fr; /* chat full */
    height: calc(100vh - 36px);
    width: calc(100% - 18px);
  }

  /* header en 3 columnas: izq btn / centro / der btn */
  .groups-chat__header {
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .groups-chat__center {
    align-items: center;
    text-align: center;
  }

  .groups-chat__title {
    width: 100%;
    font-size: 1.05rem;
    line-height: 1.15;
  }

  .groups-chat__members {
    width: 100%;
    margin: 0;
    max-width: 100%;
  }

  /* ✅ Ahora SÍ: muestra los 2 botones en móvil */
  .groups-chat__mobile-actions {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
  }

  .groups-chat__mobile-actions--left {
    justify-content: flex-start;
  }

  .groups-chat__mobile-actions--right {
    justify-content: flex-end;
  }

  /* ✅ Drawer de grupos: lista deslizante desde la izquierda */
  .groups-list {
    position: fixed;
    left: 10px;
    top: 10px;
    bottom: 10px;
    width: min(320px, 84vw);
    max-width: 92vw;
    z-index: 99992;

    transform: translateX(-115%);
    transition: transform 0.22s ease;
  }

  .groups-list.is-drawer-open {
    transform: translateX(0);
  }

  .groups-mobile-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 99991;
    background: rgba(0, 0, 0, 0.30);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }

  /* Cuando el drawer está cerrado, que no tape clicks */
  .groups-list:not(.is-drawer-open) {
    pointer-events: none;
  }

  .groups-list.is-drawer-open {
    pointer-events: auto;
  }
}

/* ✅ Móvil: quitamos el + del header de la lista (porque ya está arriba en el chat) */
@media (max-width: 1023px) {
  .groups-list__header-actions .groups-add {
    display: none;
  }
}
/* ✅ MOBILE: menú 3 puntitos en header de grupos */
.groups-menu-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
}

.groups-mobile-btn--kebab {
  font-size: 22px;
  line-height: 1;
  letter-spacing: 2px;
}

.groups-menu-popover {
  position: absolute;
  top: 52px;
  right: 0;
  min-width: 180px;
  background: rgba(255,255,255,0.96);
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 16px;
  box-shadow: 0 18px 50px rgba(0,0,0,0.18);
  padding: 8px;
  z-index: 2147483647;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

.groups-menu-item {
  width: 100%;
  border: none;
  background: transparent;
  padding: 12px 12px;
  border-radius: 12px;
  font-weight: 800;
  font-size: 0.92rem;
  text-align: left;
  cursor: pointer;
  color: rgba(0,0,0,0.86);
  display: flex;
  align-items: center;
  gap: 10px;
}

.groups-menu-item:hover {
  background: rgba(0,0,0,0.06);
}

.groups-menu-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.groups-menu-item--danger {
  color: rgba(220,38,38,0.92);
}

:global(.p-dark) .groups-menu-popover {
  background: rgba(22,22,26,0.92);
  border-color: rgba(255,255,255,0.12);
}

:global(.p-dark) .groups-menu-item {
  color: rgba(255,255,255,0.92);
}

:global(.p-dark) .groups-menu-item:hover {
  background: rgba(255,255,255,0.08);
}

/* En móvil, esconde los botones inline del título (los movemos al menú) */
@media (max-width: 1023px) {
  .groups-chat__title-actions {
    display: none !important;
  }
}
/* ==== CREATE GROUP: SEARCH FIELD ==== */
.create-group-search {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0 10px;
  padding: 10px 12px;
  border-radius: 999px;
  background: rgba(255,255,255,0.75);
  border: 1px solid rgba(0,0,0,0.06);
}

.cgs-icon {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: rgba(0,0,0,0.06);
  flex: 0 0 auto;
  opacity: 0.8;
}

.create-group-search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  font-weight: 700;
  color: rgba(0,0,0,0.82);
}

.create-group-search-input::placeholder {
  color: rgba(0,0,0,0.42);
  font-weight: 650;
}

.cgs-clear {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  border: 1px solid rgba(0,0,0,0.08);
  background: rgba(0,0,0,0.55);
  color: rgba(255,255,255,0.95);
  display: grid;
  place-items: center;
  cursor: pointer;
  flex: 0 0 auto;
}

.create-group-empty {
  padding: 10px 6px;
  font-size: 0.9rem;
  opacity: 0.7;
}

</style>

