<script setup>
import { ref, onMounted, watch, computed, onUnmounted, onActivated } from 'vue'
import { supabase } from '../lib/supabase'
import { useRoute, useRouter } from 'vue-router'
import { useFavorites } from '../stores/favorites'
import { useFollows } from '../stores/follows'
import ThemeToggle from '../components/ThemeToggle.vue'
import { useThemeStore } from '../stores/theme'
import ChatModal from '../components/ChatModal.vue'

const loadingImg = new URL('../assets/circu-Photoroom.png', import.meta.url).href

const route = useRoute()
const router = useRouter()
const favorites = useFavorites()
const follows = useFollows()
const theme = useThemeStore()

const syncThemeClass = () => {
  try {
    const isDark = !!theme.dark
    document.documentElement.classList.toggle('p-dark', isDark)
    document.body.classList.toggle('p-dark', isDark)
  } catch (e) {}
}

const profile = ref(null)
const history = ref([])
const uploadedAudios = ref([])
const ownedFeatAudios = ref([])
const featAudios = ref([])
const loading = ref(true)
const savingSocials = ref(false)
const showEditSocials = ref(false)
const lastLoadedAt = ref(0)

let savedAudiosChannel = null

let savedAudiosLoading = false
let savedAudiosQueued = false
let savedAudiosTimer = null

const scheduleLoadSavedAudios = (delay = 250) => {
  if (savedAudiosTimer) clearTimeout(savedAudiosTimer)
  savedAudiosTimer = setTimeout(async () => {
    if (savedAudiosLoading) {
      savedAudiosQueued = true
      return
    }

    savedAudiosLoading = true
    try {
      await loadSavedAudios()
    } finally {
      savedAudiosLoading = false
      if (savedAudiosQueued) {
        savedAudiosQueued = false
        scheduleLoadSavedAudios(250)
      }
    }
  }, delay)
}

let favoritesRefreshTimer = null
const scheduleFavoritesRefresh = (force = false, delay = 250) => {
  if (favoritesRefreshTimer) clearTimeout(favoritesRefreshTimer)
  favoritesRefreshTimer = setTimeout(async () => {
    try {
      if (authUserId.value && authUserId.value === profileUserId.value) {
        await favorites.refresh(!!force)
      }
    } catch (e) {}
  }, delay)
}

const stopSavedAudiosRealtime = () => {
  if (savedAudiosChannel) {
    supabase.removeChannel(savedAudiosChannel)
    savedAudiosChannel = null
  }
}

const loadSavedAudios = async () => {
  if (!profileUserId.value) {
    history.value = []
    return
  }

  const { data: rows, error } = await supabase
    .from('saved_audios')
    .select('audio_id, audios:audio_id ( id, title, artist )')
    .eq('user_id', profileUserId.value)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('❌ Error cargando saved_audios + audios:', error)
    history.value = []
    return
  }

  const list = Array.isArray(rows) ? rows : []

  history.value = list
    .map((r) => {
      const a = r?.audios
      return {
        id: a?.id || r?.audio_id,
        song_title: a?.title || 'Sin título',
        artist: a?.artist || 'Tú'
      }
    })
    .filter((s) => s?.id)

  lastLoadedAt.value = Date.now()
}

const startSavedAudiosRealtime = () => {
  stopSavedAudiosRealtime()
  if (!profileUserId.value) return

  savedAudiosChannel = supabase
    .channel(`saved-audios-${profileUserId.value}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'saved_audios',
        filter: `user_id=eq.${profileUserId.value}`
      },
      () => {
        scheduleLoadSavedAudios(250)
        scheduleFavoritesRefresh(true, 250)
      }
    )
    .subscribe()
}

const toggleSavedFromProfile = async (audioId) => {
  if (!authUserId.value) return
  if (authUserId.value !== profileUserId.value) return
  if (!audioId) return

  const isSaved = history.value.some((s) => s.id === audioId)

  if (isSaved) {
    history.value = history.value.filter((s) => s.id !== audioId)

    const { error } = await supabase
      .from('saved_audios')
      .delete()
      .eq('user_id', authUserId.value)
      .eq('audio_id', audioId)

    if (error) {
      console.error('❌ Error quitando favorito:', error)
      scheduleLoadSavedAudios(250)
      return
    }
  } else {
    const { error } = await supabase
      .from('saved_audios')
      .upsert(
        { user_id: authUserId.value, audio_id: audioId },
        { onConflict: 'user_id,audio_id' }
      )

    if (error && String(error?.code || '') !== '23505') {
      console.error('❌ Error guardando favorito:', error)
      scheduleLoadSavedAudios(250)
      return
    }
  }

  scheduleLoadSavedAudios(250)
  scheduleFavoritesRefresh(true, 250)
}

const profileUserId = ref(null)
const authUserId = ref(null)
const authEmail = ref('')
const instagramUrl = ref('')
const tiktokUrl = ref('')
const avatarUploading = ref(false)
const avatarFileInput = ref(null)

const normalizeAvatarUrl = (url) => {
  if (!url) return null
  try {
    return String(url).replace('/storage/v1/object/avatars/', '/storage/v1/object/public/avatars/')
  } catch {
    return url
  }
}

const avatarSrc = computed(() => normalizeAvatarUrl(profile.value?.avatar_url) || null)

const pickAvatarFile = () => {
  if (authUserId.value !== profileUserId.value) return
  avatarFileInput.value?.click?.()
}

const onAvatarSelected = async (e) => {
  const file = e?.target?.files?.[0]
  if (!file) return
  if (!authUserId.value || authUserId.value !== profileUserId.value) return

  avatarUploading.value = true
  try {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const filePath = `${authUserId.value}/${Date.now()}.${ext}`

    const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, file, {
      upsert: true,
      cacheControl: '3600'
    })

    if (uploadError) throw uploadError

    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(filePath)
    const publicUrl = normalizeAvatarUrl(pub?.publicUrl)
    if (!publicUrl) throw new Error('No se pudo obtener la URL pública del avatar')

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('id', authUserId.value)

    if (updateError) throw updateError

    if (profile.value) profile.value.avatar_url = publicUrl
  } catch (err) {
    console.error('❌ Error subiendo avatar:', err)
    alert('No se pudo subir la foto de perfil.')
  } finally {
    avatarUploading.value = false
    try {
      if (e?.target) e.target.value = ''
    } catch {}
  }
}

const showChatModal = ref(false)
const unreadCount = ref(0)
let chatBadgeChannel = null

const roomId = computed(() => {
  if (!authUserId.value || !profileUserId.value) return null
  const ids = [authUserId.value, profileUserId.value].sort()
  return `${ids[0]}_${ids[1]}`
})

const lastSeenKey = computed(() => {
  if (!roomId.value || !authUserId.value) return null
  return `chat_last_seen_${roomId.value}_${authUserId.value}`
})

const getLastSeen = () => {
  try {
    if (!lastSeenKey.value) return null
    return localStorage.getItem(lastSeenKey.value)
  } catch {
    return null
  }
}

const setLastSeenNow = () => {
  try {
    if (!lastSeenKey.value) return
    localStorage.setItem(lastSeenKey.value, new Date().toISOString())
  } catch {}
}

const loadUnreadCount = async () => {
  unreadCount.value = 0
  if (!authUserId.value || !profileUserId.value) return
  if (authUserId.value === profileUserId.value) return
  if (!roomId.value) return

  const lastSeen = getLastSeen()

  let query = supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('room_id', roomId.value)
    .eq('to_user', authUserId.value)

  if (lastSeen) query = query.gt('created_at', lastSeen)

  const { count, error } = await query
  if (error) {
    console.error('❌ Error cargando unreadCount:', error)
    return
  }

  unreadCount.value = count || 0
}

const stopChatBadgeRealtime = () => {
  if (chatBadgeChannel) {
    supabase.removeChannel(chatBadgeChannel)
    chatBadgeChannel = null
  }
}

const startChatBadgeRealtime = () => {
  stopChatBadgeRealtime()

  if (!authUserId.value || !profileUserId.value) return
  if (authUserId.value === profileUserId.value) return
  if (!roomId.value) return

  chatBadgeChannel = supabase
    .channel(`chat-badge-${roomId.value}-${authUserId.value}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `room_id=eq.${roomId.value}`
      },
      (payload) => {
        const msg = payload.new
        if (msg?.to_user === authUserId.value) {
          unreadCount.value = (unreadCount.value || 0) + 1
        }
      }
    )
    .subscribe()
}

const markChatAsRead = async () => {
  setLastSeenNow()
  unreadCount.value = 0
}


const openChat = async () => {
  if (!authUserId.value || authUserId.value === profileUserId.value) return
  await markChatAsRead()
  showChatModal.value = true
}


const listenersCount = ref(0)
const listenersByCity = ref([])

const RGB_KEY = 'rgb_mode'
const rgbEnabled = ref(false)

const applyRgbClass = (on) => {
  try {
    document.documentElement.classList.toggle('rgb-mode', on)
    document.body.classList.toggle('rgb-mode', on)
  } catch (_) {}
}

const loadRgbFromStorage = () => {
  try {
    const saved = localStorage.getItem(RGB_KEY)
    const on = saved === '1'
    rgbEnabled.value = on
    applyRgbClass(on)
  } catch (_) {
    rgbEnabled.value = false
    applyRgbClass(false)
  }
}

const saveRgbToStorage = (on) => {
  try {
    localStorage.setItem(RGB_KEY, on ? '1' : '0')
  } catch (_) {}
}

// ✅ Verificación (pública) + CAPTCHA (privado)
const showVerificationModal = ref(false)

// ✅ Verificado público: lo podemos enseñar en cualquier perfil (depende de columnas públicas)
const isVerified = computed(() => {
  const p = profile.value || {}
  const s = (p.verification_status || '').toString().trim().toLowerCase()
  return s === 'verified'
})

// ✅ Estado público (para badge)
const verificationStatus = computed(() => {
  const p = profile.value || {}
  const s = (p.verification_status || '').toString().trim().toLowerCase()
  if (s === 'pending' || s === 'verified' || s === 'rejected') return s
  return 'none'
})

// 🔒 CAPTCHA/Turnstile: mostramos estado usando campos disponibles
const captchaVerified = computed(() => {
  const p = profile.value || {}
  return (
    p.captcha_verified === true ||
    !!p.captcha_verified_at ||
    p.turnstile_verified === true ||
    !!p.turnstile_verified_at
  )
})

const getCaptchaStatusText = () => (captchaVerified.value ? 'CAPTCHA completado' : 'CAPTCHA pendiente')

const verificationData = ref({
  fullName: '',
  artistName: '',
  email: '',
  socialProof: '',
  message: '',
  submittedAt: null
})

const loadProfile = async () => {
  loading.value = true
  profile.value = null
  authEmail.value = ''

  profileUserId.value = route.params.id
  if (!profileUserId.value) {
    loading.value = false
    return
  }

  try {
    const { data: authRes } = await supabase.auth.getUser()
    authUserId.value = authRes?.user?.id || null
    authEmail.value = authRes?.user?.email || ''

    // ⚠️ Seguridad: nunca traigas columnas privadas en perfiles ajenos.
    // Solo pedimos campos públicos. (Así NO aparecen en Network.)
    const publicSelect =
      'id, username, avatar_url, bio, genres, instagram_url, tiktok_url, verification_status, captcha_verified'

    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select(publicSelect)
      .eq('id', profileUserId.value)
      .maybeSingle()

    if (profileError || !profileData) {
      console.error('❌ Error loading profile:', profileError)
      loading.value = false
      return
    }

    // ✅ Si estás viendo TU perfil, traemos extra campos de verificación/CAPTCHA
    // (solo para ti; no se piden cuando ves perfiles ajenos)
    if (authUserId.value && authUserId.value === profileUserId.value) {
      try {
        const privateSelect =
          'captcha_verified, captcha_verified_at, turnstile_verified, turnstile_verified_at'

        const { data: privateData, error: privateErr } = await supabase
          .from('profiles')
          .select(privateSelect)
          .eq('id', authUserId.value)
          .maybeSingle()

        if (!privateErr && privateData) {
          Object.assign(profileData, privateData)
        }
      } catch (e) {
        // no rompas la vista si no existen columnas
      }
    }

    profile.value = profileData
    instagramUrl.value = profileData.instagram_url || ''
    tiktokUrl.value = profileData.tiktok_url || ''


    if (!profileData.instagram_url && !profileData.tiktok_url) {
      showEditSocials.value = true
    }

    if (authUserId.value && authUserId.value === profileUserId.value) {
      try {
        await favorites.init(profileUserId.value)
        scheduleFavoritesRefresh(true, 0)
      } catch (e) {}
    }

    if (authUserId.value) {
      await follows.loadFollowing(authUserId.value)
      await follows.loadFollowers(profileUserId.value)
    }

    await loadSavedAudios()

    const { data: uploaded } = await supabase
      .from('audios')
      .select('id, title, created_at')
      .eq('user_id', profileUserId.value)
      .order('created_at', { ascending: false })

    uploadedAudios.value = Array.isArray(uploaded) ? uploaded : []

    const { data: ownedFeats, error: ownedFeatsErr } = await supabase
      .from('audios')
      .select('id, title, created_at, feat_username, feat_user_id')
      .eq('user_id', profileUserId.value)
      .not('feat_user_id', 'is', null)
      .order('created_at', { ascending: false })

    if (ownedFeatsErr) console.error('❌ Error cargando tus canciones con FT:', ownedFeatsErr)
    ownedFeatAudios.value = Array.isArray(ownedFeats) ? ownedFeats : []

    const { data: featRows, error: featErr } = await supabase
      .from('audios')
      .select('id, title, created_at, user_id, feat_username')
      .eq('feat_user_id', profileUserId.value)
      .order('created_at', { ascending: false })

    if (featErr) console.error('❌ Error cargando feats:', featErr)

    const featList = Array.isArray(featRows) ? featRows : []
    const ownerIds = [...new Set(featList.map((r) => r.user_id).filter(Boolean))]

    let usernamesById = {}
    if (ownerIds.length) {
      const { data: profRows, error: profErr } = await supabase
        .from('profiles')
        .select('id, username')
        .in('id', ownerIds)

      if (profErr) {
        console.error('❌ Error cargando usernames de feats:', profErr)
      } else {
        usernamesById = Object.fromEntries((profRows || []).map((p) => [p.id, p.username]))
      }
    }

    featAudios.value = featList.map((r) => ({
      id: r.id,
      title: r.title,
      created_at: r.created_at,
      owner_username: usernamesById[r.user_id] || 'Usuario',
      feat_username: r.feat_username || null
    }))

    await loadListeners()
  } catch (err) {
    console.error('❌ Error in loadProfile:', err?.message || err, err)
  } finally {
    loading.value = false
  }
}

const loadListeners = async () => {
  const { data, error } = await supabase
    .from('listeners_by_user')
    .select('listeners_count')
    .eq('profile_id', profileUserId.value)
    .maybeSingle()

  if (error) console.error('listeners_by_user error:', error)
  listenersCount.value = data?.listeners_count ?? 0

  const { data: cityData, error: cityError } = await supabase
    .from('listeners_by_city')
    .select('city, count')
    .eq('profile_id', profileUserId.value)
    .order('count', { ascending: false })

  if (cityError) console.error('listeners_by_city error:', cityError)
  listenersByCity.value = cityData || []
}

const toggleRGB = () => {
  rgbEnabled.value = !rgbEnabled.value
  const on = rgbEnabled.value
  saveRgbToStorage(on)
  applyRgbClass(on)
}

const canRequestVerification = () => false

const submitVerificationRequest = async () => {
  alert('La verificación está desactivada por ahora.')
}

const getVerificationStatusText = () => {
  switch (verificationStatus.value) {
    case 'pending':
      return 'Verificación pendiente'
    case 'verified':
      return 'Cuenta verificada'
    case 'rejected':
      return 'Verificación rechazada'
    default:
      return 'No verificado'
  }
}

const saveSocialLinks = async () => {
  if (authUserId.value !== profileUserId.value) return
  savingSocials.value = true

  const { error } = await supabase
    .from('profiles')
    .update({
      instagram_url: instagramUrl.value,
      tiktok_url: tiktokUrl.value
    })
    .eq('id', authUserId.value)

  if (!error && profile.value) {
    profile.value.instagram_url = instagramUrl.value
    profile.value.tiktok_url = tiktokUrl.value
  }

  showEditSocials.value = false
  savingSocials.value = false
}

const deleteAudio = async (audioId) => {
  if (authUserId.value !== profileUserId.value) return
  if (!confirm('¿Eliminar este audio?')) return

  await supabase.from('audios').delete().eq('id', audioId)
  uploadedAudios.value = uploadedAudios.value.filter((a) => a.id !== audioId)
}

const toggleFollow = async () => {
  if (!authUserId.value || authUserId.value === profileUserId.value) return

  follows.isFollowing(profileUserId.value)
    ? await follows.unfollow(authUserId.value, profileUserId.value)
    : await follows.follow(authUserId.value, profileUserId.value)
}

const goBack = () => router.push('/app')

const handleFavoritesChanged = () => {
  if (authUserId.value && authUserId.value === profileUserId.value) {
    scheduleLoadSavedAudios(250)
    scheduleFavoritesRefresh(false, 250)
  }
}

const checkForFavoritesChanges = async () => {
  if (!authUserId.value || authUserId.value !== profileUserId.value) return

  if (favorites.hasChangedSince(lastLoadedAt.value)) {
    scheduleLoadSavedAudios(250)
    scheduleFavoritesRefresh(false, 250)
  }
}

onMounted(() => {
  theme.init()
  syncThemeClass()
  loadRgbFromStorage()
  loadProfile()
  window.addEventListener('favorites-changed', handleFavoritesChanged)
})

onActivated(async () => {
  await checkForFavoritesChanges()
})

watch(() => route.params.id, loadProfile)

watch(() => theme.dark, () => {
  syncThemeClass()
})

watch(
  () => rgbEnabled.value,
  (on) => {
    saveRgbToStorage(on)
    applyRgbClass(on)
  }
)

watch([authUserId, profileUserId], async () => {
  await loadUnreadCount()
  startChatBadgeRealtime()
  startSavedAudiosRealtime()
})

watch(() => showChatModal.value, async (v) => {
  if (!v) await loadUnreadCount()
})

watch(
  () => favorites.version,
  () => {
    if (authUserId.value && authUserId.value === profileUserId.value) {
      if (Array.isArray(history.value) && history.value.length) {
        history.value = history.value.filter((s) => favorites.isFav(s.id))
      }
      scheduleLoadSavedAudios(300)
    }
  }
)

onUnmounted(() => {
  stopChatBadgeRealtime()
  stopSavedAudiosRealtime()
  window.removeEventListener('favorites-changed', handleFavoritesChanged)
})
</script>

<template>
  <div class="profile-main-wrapper" :class="{ 'rgb-mode': rgbEnabled }">
    <div class="profile-bg" aria-hidden="true"></div>
    <div v-if="loading" class="loading-state">
      <img :src="loadingImg" alt="Cargando..." class="loading-spinner" />
    </div>

    <template v-else-if="profile">
      <button class="fixed-back-button" @click="goBack">← Volver</button>

      <div class="scrollable-content">
        <div class="grid-layout">
          <div class="col-side">
            <div class="card profile-header-card">
              <div class="user-avatar" :class="{ hasPhoto: !!avatarSrc }">
                <img v-if="avatarSrc" :src="avatarSrc" alt="Foto de perfil" />
                <span v-else>👤</span>
              </div>

              <input
                v-if="authUserId === profileUserId"
                ref="avatarFileInput"
                class="avatar-file-input"
                type="file"
                accept="image/*"
                @change="onAvatarSelected"
              />

              <button
                v-if="authUserId === profileUserId"
                class="avatar-upload-btn"
                :disabled="avatarUploading"
                @click="pickAvatarFile"
              >
                {{ avatarUploading ? 'Subiendo…' : '📷 Añadir foto' }}
              </button>

              <h1 class="username-title">
                {{ profile.username }}
                <span v-if="isVerified" class="verified-badge" title="Verificado">✓</span>
              </h1>

              <div v-if="authUserId && authUserId !== profileUserId" class="follow-chat-row">
                <button class="follow-action-btn" @click="toggleFollow">
                  {{ follows.isFollowing(profileUserId) ? 'Siguiendo' : 'Seguir' }}
                </button>

                <button class="chat-action-btn" @click="openChat" title="Chatear">
                  💬 Chat
                  <span v-if="unreadCount > 0" class="chat-badge">
                    {{ unreadCount > 9 ? '9+' : unreadCount }}
                  </span>
                </button>
              </div>

              <p v-if="authUserId === profileUserId && authEmail" class="user-email">{{ authEmail }}</p>

              <div class="theme-rgb-row">
                <ThemeToggle />
                <button
                  class="rgb-animated-btn"
                  :class="{ active: rgbEnabled }"
                  @click.stop="toggleRGB"
                >
                  <span>🌈 RGB {{ rgbEnabled ? 'ON' : 'OFF' }}</span>
                  <div class="rgb-glow"></div>
                </button>
              </div>
            </div>

            <div v-if="profile.bio" class="card">
              <h3 class="section-title">📝 Bio</h3>
              <p class="bio-text">{{ profile.bio }}</p>
            </div>

            <div class="card hover-flow">
              <h3 class="section-title">👂 Oyentes</h3>
              <p class="listeners-number">{{ listenersCount }}</p>
              <small class="listeners-sub">oyentes únicos</small>

              <div v-if="listenersByCity.length" class="listeners-countries">
                <div v-for="c in listenersByCity" :key="c.city" class="country-row">
                  <span>📍 {{ c.city }}</span>
                  <span>{{ c.count }}</span>
                </div>
              </div>
              <p v-else class="empty-msg">No hay datos de ciudades aún</p>
            </div>

            <div class="card hover-flow">
              <div class="social-header">
                <h3 class="section-title">📱 Redes Sociales</h3>
                <button
                  v-if="authUserId === profileUserId && !showEditSocials"
                  @click="showEditSocials = true"
                  class="edit-btn"
                >✏️</button>
              </div>

              <div v-if="authUserId === profileUserId && showEditSocials">
                <input v-model="instagramUrl" class="input-field" placeholder="URL Instagram" />
                <input v-model="tiktokUrl" class="input-field" placeholder="URL TikTok" />
                <button class="save-action-btn" @click="saveSocialLinks">Guardar</button>
              </div>

              <div v-else>
                <a v-if="profile.instagram_url" :href="profile.instagram_url" target="_blank" class="link-btn">
                  Instagram 📸
                </a>
                <a v-if="profile.tiktok_url" :href="profile.tiktok_url" target="_blank" class="link-btn">
                  TikTok 🎬
                </a>
                <p v-if="!profile.instagram_url && !profile.tiktok_url" class="empty-msg">
                  No hay redes sociales vinculadas
                </p>
              </div>
            </div>
          </div>

          <div class="col-main">
            <div v-if="profile.genres?.length" class="card">
              <h3 class="section-title">🎵 Géneros</h3>
              <div class="genres-wrap">
                <span v-for="g in profile.genres" :key="g" class="genre-tag">{{ g }}</span>
              </div>
            </div>

            <div class="card">
              <h3 class="section-title">🎶 Audios subidos</h3>
              <div v-for="audio in uploadedAudios" :key="audio.id" class="list-row-item">
                <strong>{{ audio.title }}</strong>
                <button
                  v-if="authUserId === profileUserId"
                  class="delete-icon"
                  @click="deleteAudio(audio.id)"
                >🗑</button>
              </div>
              <p v-if="!uploadedAudios.length" class="empty-msg">
                Este usuario no tiene audios subidos
              </p>
            </div>

            <div class="card">
              <h3 class="section-title">🎤 Canciones con FT</h3>

              <div class="subsection-title">Tus canciones con FT</div>
              <div v-for="audio in ownedFeatAudios" :key="audio.id" class="list-row-item">
                <div>
                  <strong>{{ audio.title }}</strong>
                  <small v-if="audio.feat_username">ft {{ audio.feat_username }}</small>
                </div>
                <button
                  v-if="authUserId === profileUserId"
                  class="delete-icon"
                  @click="deleteAudio(audio.id)"
                >🗑</button>
              </div>
              <p v-if="!ownedFeatAudios.length" class="empty-msg">
                No tienes canciones con FT aún
              </p>

              <div class="subsection-title" style="margin-top:14px;">Canciones donde sales de FT</div>
              <div v-for="audio in featAudios" :key="audio.id" class="list-row-item">
                <div>
                  <strong>{{ audio.title }}</strong>
                  <small>de {{ audio.owner_username }}</small>
                </div>
                <button
                  v-if="authUserId === profileUserId"
                  class="delete-icon"
                  @click="deleteAudio(audio.id)"
                >🗑</button>
              </div>
              <p v-if="!featAudios.length" class="empty-msg">
                No hay canciones donde salgas de FT aún
              </p>
            </div>

            <div class="card">
              <h3 class="section-title">❤️ Gustados</h3>
              <div v-for="song in history" :key="song.id" class="list-row-item">
                <div>
                  <strong>{{ song.song_title }}</strong>
                  <small>{{ song.artist }}</small>
                </div>

                <button
                  v-if="authUserId === profileUserId"
                  class="heart-btn"
                  title="Quitar de gustados"
                  @click="toggleSavedFromProfile(song.id)"
                >❤️</button>

                <span v-else>❤️</span>
              </div>
              <p v-if="!history.length" class="empty-msg">No hay audios guardados</p>
            </div>

            <div class="card verification-card">
              <h3 class="section-title">✅ Verificación</h3>

              <!-- Estado del CAPTCHA (anti-bots): visible en todos los perfiles -->
              <div class="status-badge captcha" :class="captchaVerified ? 'verified' : 'none'">
                <span class="status-icon">{{ captchaVerified ? '🛡️' : '🧩' }}</span>
                <span>{{ getCaptchaStatusText() }}</span>
              </div>

              <div class="captcha-note" v-if="authUserId === profileUserId && !captchaVerified">
                Completa el CAPTCHA en el registro/login para marcar esta verificación como completa.
              </div>

              <!-- Estado público de verificación -->
              <div class="status-badge" :class="verificationStatus">
                <span class="status-icon">
                  {{
                    verificationStatus === 'verified'
                      ? '✓'
                      : verificationStatus === 'pending'
                        ? '⏳'
                        : verificationStatus === 'rejected'
                          ? '✗'
                          : '○'
                  }}
                </span>
                <span>{{ getVerificationStatusText() }}</span>
              </div>

              <!-- Solo tú puedes solicitar verificación (si algún día se activa) -->
              <button
                v-if="authUserId === profileUserId && !isVerified && verificationStatus === 'none'"
                class="verify-btn"
                :class="{ disabled: !canRequestVerification() }"
                :disabled="!canRequestVerification()"
                @click="showVerificationModal = true"
              >
                {{ canRequestVerification() ? '🎖️ Solicitar Verificación' : '🔒 Requisitos incompletos' }}
              </button>
            </div>
          </div>
        </div>
        <div class="ios-safe-bottom-padding"></div>
      </div>

      <ChatModal
        :show="showChatModal"
        :authUserId="authUserId"
        :profileUserId="profileUserId"
        :profileUsername="profile?.username"
        @close="showChatModal = false"
      />

      <div v-if="authUserId === profileUserId && showVerificationModal" class="modal-overlay" @click="showVerificationModal = false">
        <div class="modal-content" @click.stop>
          <div class="modal-header">
            <h2>✅ Solicitar Verificación</h2>
            <button class="modal-close" @click="showVerificationModal = false">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>Nombre completo *</label>
              <input v-model="verificationData.fullName" class="input-field" placeholder="Tu nombre" />
            </div>
            <div class="form-group">
              <label>Nombre artístico *</label>
              <input v-model="verificationData.artistName" class="input-field" placeholder="Tu nombre artístico" />
            </div>
            <div class="form-group">
              <label>Email *</label>
              <input v-model="verificationData.email" type="email" class="input-field" placeholder="email@ejemplo.com" />
            </div>
            <button
              class="submit-btn"
              :disabled="!verificationData.fullName || !verificationData.artistName || !verificationData.email"
              @click="submitVerificationRequest"
            >
              Enviar Solicitud
            </button>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="loading-state">Perfil no encontrado</div>
  </div>
</template>

<style scoped>
.profile-main-wrapper{
  --page-bg: #f6f7f9;
  --page-fg: #111111;
  --card-bg: #ffffff;
  --card-fg: #111111;
  --muted-bg: #f3f4f6;
  --muted-fg: #6b7280;
  --border: rgba(17,17,17,0.08);
  width: 100%;
  min-height: 100vh;
  display: block;
  position: relative;
  isolation: isolate;
  background: transparent;
  color: var(--page-fg);
}

.profile-bg{
  position: fixed;
  inset: 0;
  z-index: -1;
  background: var(--page-bg);
  background-attachment: fixed;
  background-repeat: no-repeat;
}

:global(.p-dark) .profile-main-wrapper{
  --page-bg:
    radial-gradient(900px 500px at 20% 10%, rgba(99,102,241,0.22), transparent 60%),
    radial-gradient(900px 500px at 80% 15%, rgba(34,197,94,0.16), transparent 60%),
    radial-gradient(900px 500px at 50% 90%, rgba(239,68,68,0.10), transparent 55%),
    linear-gradient(180deg, #050507 0%, #0b0b0c 100%);
  --page-fg: #f4f4f5;
  --card-bg: rgba(255,255,255,0.92);
  --card-fg: #111111;
  --muted-bg: rgba(0,0,0,0.06);
  --muted-fg: rgba(17,17,17,0.60);
  --border: rgba(17,17,17,0.10);
}

.fixed-back-button {
  position: fixed;
  top: env(safe-area-inset-top, 20px);
  left: 16px;
  z-index: 1000;
  background: var(--card-bg);
  color: var(--card-fg);
  padding: 10px 18px;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-weight: 700;
  box-shadow: 0 4px 12px rgba(0,0,0,0.18);
  font-size: 0.9rem;
  cursor: pointer;
}

@media (min-width: 900px) {
  .fixed-back-button { top: 24px; left: 24px; }
}

.scrollable-content {
  width: 100%;
  max-width: 1000px;
  margin: 0 auto;
  padding: 0 16px;
  padding-top: calc(env(safe-area-inset-top, 20px) + 60px);
}

.grid-layout {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

@media (min-width: 900px) {
  .grid-layout { grid-template-columns: 350px 1fr; gap: 32px; }
}

.card {
  background: var(--card-bg);
  color: var(--card-fg);
  padding: 1.5rem;
  border-radius: 18px;
  border: 1px solid var(--border);
  box-shadow: 0 4px 15px rgba(0,0,0,0.05);
  margin-bottom: 12px;
}

.profile-header-card { text-align: center; }

.user-avatar {
  width: 96px;
  height: 96px;
  border-radius: 22px;
  background: rgba(99,102,241,0.15);
  display: grid;
  place-items: center;
  overflow: hidden;
  margin: 0 auto 8px;
  box-shadow: 0 10px 24px rgba(0,0,0,0.08);
}

.user-avatar span { font-size: 3rem; line-height: 1; }
.user-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.avatar-file-input { display: none; }

.avatar-upload-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 10px auto 0;
  padding: 10px 14px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--muted-bg);
  color: var(--card-fg);
  font-weight: 900;
  cursor: pointer;
}

.avatar-upload-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.list-row-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: var(--muted-bg);
  border-radius: 12px;
  margin-top: 8px;
}

.list-row-item small { color: var(--muted-fg); }

.link-btn {
  display: block;
  padding: 12px;
  background: var(--muted-bg);
  border-radius: 10px;
  text-decoration: none;
  color: var(--card-fg);
  font-weight: 800;
  text-align: center;
  margin-top: 10px;
}

.input-field {
  width: 100%;
  padding: 12px;
  margin-top: 8px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--muted-bg);
  color: var(--card-fg);
}

.save-action-btn {
  width: 100%;
  margin-top: 10px;
  padding: 12px;
  background: #7c3aed;
  color: white;
  border: none;
  border-radius: 10px;
  font-weight: 800;
  cursor: pointer;
}

.ios-safe-bottom-padding { height: 120px; }

.genre-tag {
  background: var(--muted-bg);
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 0.8rem;
  margin-right: 5px;
  color: var(--card-fg);
}

@media (max-width: 899px) {
  .scrollable-content { padding-top: env(safe-area-inset-top, 20px); }
}

.hover-flow { position: relative; }

@media (hover: hover) and (pointer: fine) {
  .hover-flow::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 18px;
    pointer-events: none;
    border: 1.5px solid transparent;
    transition: border-color 0.25s ease, box-shadow 0.25s ease;
  }
  .hover-flow:hover::after {
    border-color: #3b82f6;
    box-shadow: 0 0 0 1px rgba(59,130,246,0.35);
  }
}

.listeners-countries {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.country-row {
  background: var(--muted-bg);
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 0.9rem;
  display: flex;
  justify-content: space-between;
  font-weight: 800;
  color: var(--card-fg);
}

.profile-main-wrapper :global(.theme-toggle),
.profile-main-wrapper :global(.theme-switch) {
  position: relative;
  width: 46px;
  height: 26px;
  border-radius: 999px;
  background: #e5e7eb;
  transition: background 0.25s ease;
}

:global(.p-dark) .profile-main-wrapper :global(.theme-toggle),
:global(.p-dark) .profile-main-wrapper :global(.theme-switch) {
  background: #27272a;
}

.profile-main-wrapper :global(.theme-toggle input),
.profile-main-wrapper :global(.theme-switch input) {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.profile-main-wrapper :global(.theme-toggle span),
.profile-main-wrapper :global(.theme-switch span) {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #6b7280;
  transition: transform 0.25s ease, background 0.25s ease;
}

.profile-main-wrapper :global(.theme-toggle input:checked + span),
.profile-main-wrapper :global(.theme-switch input:checked + span) {
  transform: translateX(20px);
  background: #f4f4f5;
}

.profile-main-wrapper.rgb-mode{
  --page-bg: linear-gradient(135deg, #ff0080, #ff4ecd, #7928ca, #4f46e5, #2afadf, #00ffcc, #ffdd00, #ff0080);
}

.profile-main-wrapper.rgb-mode .profile-bg{
  background-size: 700% 700% !important;
  animation: rgbMove 16s ease-in-out infinite, rgbHue 18s linear infinite !important;
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

.profile-main-wrapper.rgb-mode .card {
  background: rgba(255,255,255,0.92) !important;
  color: #111 !important;
  border: 1px solid rgba(17,17,17,0.10) !important;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

.theme-rgb-row {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: center;
  margin-top: 12px;
}

.rgb-animated-btn {
  appearance: none;
  border: none;
  cursor: pointer;
  margin: 0;
  padding: 0;
  height: 36px;
  display: inline-flex;
  align-items: center;
  background: linear-gradient(to bottom right, #3FFC6A, #591B98, #432366);
  color: white;
  border-radius: 14px;
  position: relative;
  overflow: hidden;
  box-shadow: 0 0 0.5px 0.5px rgba(0,0,0,0.3) inset, 0 4px 12px -3px rgba(9,24,85,0.9), 0 8px 20px rgba(9,24,85,0.25);
  transition: transform 0.2s ease;
}

.rgb-animated-btn:active { transform: scale(0.96); }

.rgb-animated-btn span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 18px;
  height: 100%;
  position: relative;
  z-index: 2;
  font-weight: 800;
  border-radius: 14px;
  white-space: nowrap;
  background: linear-gradient(to bottom, rgba(255,255,255,0.15), rgba(0,0,0,0.15));
}

.rgb-animated-btn .rgb-glow {
  position: absolute;
  inset: 0;
  z-index: 1;
  opacity: 0;
  background: linear-gradient(120deg, #ff0080, #7928ca, #2afadf, #00ffcc, #ffdd00, #ff0080);
  background-size: 400% 400%;
  animation: rgbBtnFlow 6s linear infinite;
  transition: opacity 0.35s ease;
}

.rgb-animated-btn.active .rgb-glow { opacity: 0.85; }

@keyframes rgbBtnFlow {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

.verified-badge {
  display: inline-block;
  width: 20px;
  height: 20px;
  background: #22c55e;
  color: white;
  border-radius: 50%;
  font-size: 12px;
  line-height: 20px;
  margin-left: 6px;
  vertical-align: middle;
}

.verification-card {
  background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
}

:global(.p-dark) .profile-main-wrapper .verification-card {
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
}

.status-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 10px;
  font-weight: 800;
  margin-bottom: 16px;
  font-size: 0.9rem;
}

.status-badge.none { background: var(--muted-bg); color: var(--muted-fg); }
.status-badge.pending { background: #fef3c7; color: #92400e; }
.status-badge.verified { background: #d1fae5; color: #065f46; }

:global(.p-dark) .status-badge.pending { background: #451a03; color: #fbbf24; }
:global(.p-dark) .status-badge.verified { background: #064e3b; color: #6ee7b7; }

/* ✅ Badge de CAPTCHA (Turnstile) */
.status-badge.captcha {
  margin-bottom: 10px;
}

.captcha-note {
  margin-top: -6px;
  margin-bottom: 14px;
  font-size: 0.85rem;
  color: var(--muted-fg);
}

.verify-btn {
  width: 100%;
  padding: 12px;
  border-radius: 10px;
  border: none;
  font-weight: 900;
  cursor: pointer;
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: white;
  transition: transform 0.2s;
}

.verify-btn:hover:not(.disabled) { transform: translateY(-1px); }
.verify-btn.disabled { background: #d1d5db; color: #9ca3af; cursor: not-allowed; }

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 20px;
}

.modal-content {
  background: var(--card-bg);
  color: var(--card-fg);
  border-radius: 20px;
  max-width: 500px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  border: 1px solid var(--border);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid var(--border);
}

.modal-header h2 { font-size: 1.3rem; margin: 0; }

.modal-close {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  color: inherit;
}

.modal-body { padding: 20px; }
.form-group { margin-bottom: 14px; }

.form-group label {
  display: block;
  font-weight: 800;
  margin-bottom: 6px;
  font-size: 0.9rem;
}

.submit-btn {
  width: 100%;
  padding: 12px;
  border-radius: 10px;
  border: none;
  font-weight: 900;
  cursor: pointer;
  background: linear-gradient(135deg, #22c55e, #16a34a);
  color: white;
  margin-top: 10px;
}

.submit-btn:disabled { background: #d1d5db; color: #9ca3af; cursor: not-allowed; }

.section-title { font-size: 1.05rem; font-weight: 900; margin-bottom: 12px; }
.subsection-title { font-weight: 900; font-size: 0.9rem; color: var(--muted-fg); margin-top: 2px; margin-bottom: 6px; }
.username-title { font-size: 1.5rem; font-weight: 900; margin: 8px 0; }
.user-email { color: var(--muted-fg); font-size: 0.9rem; margin-bottom: 8px; }

.follow-action-btn {
  padding: 10px 24px;
  background: #7c3aed;
  color: white;
  border: none;
  border-radius: 999px;
  font-weight: 900;
  cursor: pointer;
  margin: 10px 0;
}

.listeners-number { font-size: 2rem; font-weight: 900; text-align: center; margin: 8px 0; }
.listeners-sub { display: block; text-align: center; color: var(--muted-fg); font-size: 0.85rem; }
.bio-text { line-height: 1.6; }

.empty-msg {
  text-align: center;
  color: var(--muted-fg);
  font-style: italic;
  padding: 16px;
}

.genres-wrap { display: flex; flex-wrap: wrap; gap: 6px; }

.delete-icon {
  background: none;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  opacity: 0.7;
  color: inherit;
}
.delete-icon:hover { opacity: 1; }

.heart-btn {
  background: none;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  padding: 0 6px;
  line-height: 1;
  opacity: 0.9;
  color: inherit;
  transition: transform 0.15s ease, opacity 0.15s ease;
}
.heart-btn:hover { opacity: 1; transform: scale(1.06); }

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  font-size: 1.2rem;
  font-weight: 900;
}

.loading-spinner {
  width: 180px;
  height: 180px;
  object-fit: contain;
  animation: spin 2s linear infinite;
  filter: drop-shadow(0 8px 20px rgba(0, 0, 0, 0.15));
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.social-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.edit-btn {
  background: var(--muted-bg);
  border: 1px solid var(--border);
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1rem;
  color: inherit;
}

.follow-chat-row {
  display: flex;
  gap: 10px;
  justify-content: center;
  align-items: center;
  margin: 10px 0;
}

.chat-action-btn {
  padding: 10px 18px;
  background: #111;
  color: #fff;
  border: none;
  border-radius: 999px;
  font-weight: 900;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: transform .15s ease, opacity .15s ease;
  position: relative;
}

:global(.p-dark) .profile-main-wrapper .chat-action-btn { background: #374151; }
.chat-action-btn:hover { transform: translateY(-1px); opacity: .95; }

.chat-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: #ef4444;
  color: #fff;
  font-size: 0.72rem;
  font-weight: 900;
  display: grid;
  place-items: center;
  box-shadow: 0 10px 24px rgba(239,68,68,.35);
}
</style>