<script setup>
import { ref, onMounted, watch, computed, onUnmounted } from 'vue'
import { supabase } from '../lib/supabase'
import { useRoute, useRouter } from 'vue-router'
import { useFavorites } from '../stores/favorites'
import { useFollows } from '../stores/follows'
import ThemeToggle from '../components/ThemeToggle.vue'
import { useThemeStore } from '../stores/theme'
import ChatModal from '../components/ChatModal.vue'

/* ======================
   ROUTER & STORES
====================== */
const route = useRoute()
const router = useRouter()
const favorites = useFavorites()
const follows = useFollows()
const theme = useThemeStore()

/* ======================
   STATE
====================== */
const profile = ref(null)
const history = ref([])
const uploadedAudios = ref([])
const loading = ref(true)
const savingSocials = ref(false)
const showEditSocials = ref(false)

const profileUserId = ref(null)
const authUserId = ref(null)

const instagramUrl = ref('')
const tiktokUrl = ref('')

/* 💬 CHAT MODAL */
const showChatModal = ref(false)

/* 🔔 CHAT NOTIFICATION (BADGE) */
const unreadCount = ref(0)
let chatBadgeChannel = null

// ✅ room_id estable (mismo que en ChatModal)
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

/* AVATAR */
const showAvatarPicker = ref(false)
const avatarGender = ref('male')

/* 👂 OYENTES */
const listenersCount = ref(0)
const listenersByCity = ref([])

/* 🌈 RGB MODE */
const rgbEnabled = ref(false)

/* ✅ VERIFICACIÓN (safe aunque no existan columnas) */
const showVerificationModal = ref(false)
const verificationStatus = ref('none')
const verificationData = ref({
  fullName: '',
  artistName: '',
  email: '',
  socialProof: '',
  message: '',
  submittedAt: null
})

/* ======================
   LOAD PROFILE ✅ FIX
====================== */
const loadProfile = async () => {
  loading.value = true
  profile.value = null

  profileUserId.value = route.params.id
  if (!profileUserId.value) {
    loading.value = false
    return
  }

  try {
    // ✅ 1) Pillamos auth primero (si existe)
    const { data: authRes } = await supabase.auth.getUser()
    authUserId.value = authRes?.user?.id || null

    // ✅ 2) PERFIL: usamos select('*') para evitar error 42703 (columnas que no existen)
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', profileUserId.value)
      .maybeSingle()

    if (profileError || !profileData) {
      console.error('❌ Error loading profile:', profileError)
      loading.value = false
      return
    }

    profile.value = profileData

    instagramUrl.value = profileData.instagram_url || ''
    tiktokUrl.value = profileData.tiktok_url || ''

    // ✅ Verificación (si no existen columnas, no peta)
    verificationStatus.value = profileData.verification_status || 'none'
    if (profileData.verification_data) {
      verificationData.value = { ...verificationData.value, ...profileData.verification_data }
    }

    // ✅ si no hay redes, sugiere editar
    if (!profileData.instagram_url && !profileData.tiktok_url) {
      showEditSocials.value = true
    }

    // ✅ Favorites SOLO si estoy viendo mi perfil
    if (authUserId.value && authUserId.value === profileUserId.value) {
      favorites.init(profileUserId.value)
    }

    // ✅ follows / followers
    if (authUserId.value) {
      await follows.loadFollowing(authUserId.value)
      await follows.loadFollowers(profileUserId.value)
    }

    // ✅ historial guardados
    const { data: saved } = await supabase
      .from('saved_audios')
      .select(`audios (id, title, artist)`)
      .eq('user_id', profileUserId.value)

    history.value =
      saved?.map(row => ({
        id: row.audios.id,
        song_title: row.audios.title,
        artist: row.audios.artist || 'Tú'
      })) || []

    // ✅ audios subidos
    const { data: uploaded } = await supabase
      .from('audios')
      .select('id, title, created_at')
      .eq('user_id', profileUserId.value)

    uploadedAudios.value = uploaded || []

    await loadListeners()
  } catch (err) {
    console.error('❌ Error in loadProfile:', err)
  } finally {
    loading.value = false
  }
}

/* ======================
   👂 LOAD LISTENERS
====================== */
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

/* ======================
   🌈 TOGGLE RGB
====================== */
const toggleRGB = () => {
  rgbEnabled.value = !rgbEnabled.value
  document.documentElement.classList.toggle('rgb-mode', rgbEnabled.value)
}

/* ======================
   ✅ VERIFICACIÓN
====================== */
const canRequestVerification = () => {
  return (
    uploadedAudios.value.length >= 3 &&
    listenersCount.value >= 100 &&
    profile.value?.instagram_url &&
    verificationStatus.value === 'none'
  )
}

const submitVerificationRequest = async () => {
  if (!canRequestVerification()) {
    alert('No cumples con los requisitos para solicitar verificación')
    return
  }

  verificationData.value.submittedAt = new Date().toISOString()

  // ✅ OJO: esto solo funcionará si tienes esas columnas creadas en profiles
  const { error } = await supabase
    .from('profiles')
    .update({
      verification_status: 'pending',
      verification_data: verificationData.value
    })
    .eq('id', authUserId.value)

  if (error) {
    console.error('Error submitting verification:', error)
    alert('Error al enviar solicitud de verificación')
    return
  }

  verificationStatus.value = 'pending'
  showVerificationModal.value = false
  alert('¡Solicitud enviada!')
}

const getVerificationStatusText = () => {
  switch (verificationStatus.value) {
    case 'pending': return 'Verificación pendiente'
    case 'verified': return 'Cuenta verificada'
    case 'rejected': return 'Verificación rechazada'
    default: return 'No verificado'
  }
}

/* ======================
   ACTIONS
====================== */
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
  uploadedAudios.value = uploadedAudios.value.filter(a => a.id !== audioId)
}

const toggleFollow = async () => {
  if (!authUserId.value || authUserId.value === profileUserId.value) return

  follows.isFollowing(profileUserId.value)
    ? await follows.unfollow(authUserId.value, profileUserId.value)
    : await follows.follow(authUserId.value, profileUserId.value)
}

const goBack = () => router.push('/app')
const goToApp = () => router.push('/app')

/* ======================
   LIFE
====================== */
onMounted(() => {
  theme.init()
  loadProfile()
})

watch(() => route.params.id, loadProfile)

// 🔔 badge realtime
watch([authUserId, profileUserId], async () => {
  await loadUnreadCount()
  startChatBadgeRealtime()
})

watch(() => showChatModal.value, async (v) => {
  if (!v) await loadUnreadCount()
})

onUnmounted(() => {
  stopChatBadgeRealtime()
})
</script>

<template>
  <div class="profile-main-wrapper">
    <div v-if="loading" class="loading-state">Cargando perfil…</div>

    <template v-else-if="profile">
      <button class="fixed-back-button" @click="goBack">← Volver</button>

      <div class="scrollable-content">
        <div class="grid-layout">

          <!-- COLUMNA IZQUIERDA -->
          <div class="col-side">
            <div class="card profile-header-card">
              <div class="user-avatar">👤</div>

              <h1 class="username-title">
                {{ profile.username }}
                <span v-if="profile.verified" class="verified-badge" title="Verificado">✓</span>
              </h1>

              <!-- ✅ FOLLOW + CHAT -->
              <div
                v-if="authUserId && authUserId !== profileUserId"
                class="follow-chat-row"
              >
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

              <p class="user-email">{{ profile.email }}</p>

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

            <!-- 👂 OYENTES -->
            <div class="card hover-flow">
              <h3 class="section-title">👂 Oyentes</h3>
              <p class="listeners-number">{{ listenersCount }}</p>
              <small class="listeners-sub">oyentes únicos</small>

              <div v-if="listenersByCity.length" class="listeners-countries">
                <div
                  v-for="c in listenersByCity"
                  :key="c.city"
                  class="country-row"
                >
                  <span>📍 {{ c.city }}</span>
                  <span>{{ c.count }}</span>
                </div>
              </div>

              <p v-else class="empty-msg">No hay datos de ciudades aún</p>
            </div>

            <!-- REDES -->
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

          <!-- COLUMNA DERECHA -->
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

            <div class="card clickable-card hover-flow" @click="goToApp">
              <h3 class="section-title">❤️ Gustados</h3>
              <div v-for="song in history" :key="song.id" class="list-row-item">
                <div>
                  <strong>{{ song.song_title }}</strong>
                  <small>{{ song.artist }}</small>
                </div>
                <span>❤️</span>
              </div>
              <p v-if="!history.length" class="empty-msg">No hay audios guardados</p>
            </div>

            <!-- ✅ VERIFICACIÓN -->
            <div v-if="authUserId === profileUserId" class="card verification-card">
              <h3 class="section-title">✅ Verificación</h3>

              <div class="status-badge" :class="verificationStatus">
                <span class="status-icon">
                  {{ verificationStatus === 'verified' ? '✓' :
                     verificationStatus === 'pending' ? '⏳' :
                     verificationStatus === 'rejected' ? '✗' : '○' }}
                </span>
                <span>{{ getVerificationStatusText() }}</span>
              </div>

              <button
                v-if="!profile.verified && verificationStatus === 'none'"
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

      <!-- ✅ CHAT MODAL -->
      <ChatModal
        :show="showChatModal"
        :authUserId="authUserId"
        :profileUserId="profileUserId"
        :profileUsername="profile?.username"
        @close="showChatModal = false"
      />

      <!-- MODAL VERIFICACIÓN -->
      <div v-if="showVerificationModal" class="modal-overlay" @click="showVerificationModal = false">
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
.profile-main-wrapper {
  width: 100%;
  min-height: 100vh;
  display: block;
  background: inherit;
}

.fixed-back-button {
  position: fixed;
  top: env(safe-area-inset-top, 20px);
  left: 16px;
  z-index: 1000;
  background: white;
  padding: 10px 18px;
  border-radius: 999px;
  border: none;
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(0,0,0,0.18);
  color: #111;
  font-size: 0.9rem;
  cursor: pointer;
  transition: box-shadow 0.25s ease, transform 0.2s ease, background 0.2s ease;
}

@media (min-width: 900px) {
  .fixed-back-button {
    top: 24px;
    left: 24px;
  }
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
  .grid-layout {
    grid-template-columns: 350px 1fr;
    gap: 32px;
  }
}

.card {
  background: white;
  padding: 1.5rem;
  border-radius: 18px;
  box-shadow: 0 4px 15px rgba(0,0,0,0.05);
  margin-bottom: 12px;
  color: #111;
}

.profile-header-card {
  text-align: center;
}

.user-avatar {
  font-size: 3rem;
  margin-bottom: 8px;
}

.list-row-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 12px;
  margin-top: 8px;
}

.link-btn {
  display: block;
  padding: 12px;
  background: #f1f1f1;
  border-radius: 10px;
  text-decoration: none;
  color: #111 !important;
  font-weight: bold;
  text-align: center;
  margin-top: 10px;
}

.input-field {
  width: 100%;
  padding: 12px;
  margin-top: 8px;
  border-radius: 10px;
  border: 1px solid #ddd;
  background: #f9f9f9;
}

.save-action-btn {
  width: 100%;
  margin-top: 10px;
  padding: 12px;
  background: #7c3aed;
  color: white;
  border: none;
  border-radius: 10px;
  font-weight: bold;
  cursor: pointer;
}

.ios-safe-bottom-padding {
  height: 120px;
}

:global(.p-dark) .card {
  background: #18181b;
  border: 1px solid #27272a;
}

:global(.p-dark) h1,
:global(.p-dark) h3,
:global(.p-dark) p,
:global(.p-dark) strong {
  color: white !important;
}

:global(.p-dark) .list-row-item,
:global(.p-dark) .link-btn {
  background: #27272a;
}

:global(.p-dark) .fixed-back-button {
  background: #27272a;
  color: white;
}

:global(.p-dark) .input-field {
  background: #18181b;
  color: white;
  border-color: #3f3f46;
}

.genre-tag {
  background: #eee;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 0.8rem;
  margin-right: 5px;
  color: #111;
}

:global(.p-dark) .genre-tag {
  background: #333;
  color: white;
}

@media (max-width: 899px) {
  html, body {
    height: auto;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  .profile-main-wrapper {
    min-height: auto;
    overflow-y: auto;
  }

  .scrollable-content {
    overflow-y: auto;
    padding-top: env(safe-area-inset-top, 20px);
  }
}

.hover-flow {
  position: relative;
}

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

/* ✅ NUEVO: LISTA CIUDADES */
.listeners-countries {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.country-row {
  background: #f3f4f6;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 0.9rem;
  display: flex;
  justify-content: space-between;
  font-weight: 600;
}

:global(.p-dark) .country-row {
  background: #27272a;
  color: white;
}

:global(.theme-toggle),
:global(.theme-switch) {
  position: relative;
  width: 46px;
  height: 26px;
  border-radius: 999px;
  background: #e5e7eb;
  transition: background 0.25s ease;
}

:global(.theme-toggle input),
:global(.theme-switch input) {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

:global(.theme-toggle span),
:global(.theme-switch span) {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #6b7280;
  transition: transform 0.25s ease, background 0.25s ease;
}

:global(.theme-toggle input:checked + span),
:global(.theme-switch input:checked + span) {
  transform: translateX(20px);
  background: #f4f4f5;
}

:global(.p-dark) .theme-toggle,
:global(.p-dark) .theme-switch {
  background: #27272a;
}

:global(html) {
  min-height: 100%;
}

:global(html.rgb-mode) {
  min-height: 100vh;
  background: linear-gradient(135deg, #ff0080, #ff4ecd, #7928ca, #4f46e5, #2afadf, #00ffcc, #ffdd00, #ff0080) !important;
  background-size: 700% 700% !important;
  animation: rgbMove 16s ease-in-out infinite, rgbHue 18s linear infinite !important;
}

:global(html.rgb-mode body),
:global(html.rgb-mode .profile-main-wrapper) {
  background: transparent !important;
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

:global(html.rgb-mode) .card {
  background: rgba(255, 255, 255, 0.95);
}

:global(html.rgb-mode.p-dark) .card {
  background: rgba(24, 24, 27, 0.95);
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

.rgb-animated-btn:active {
  transform: scale(0.96);
}

.rgb-animated-btn span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 18px;
  height: 100%;
  position: relative;
  z-index: 2;
  font-weight: 600;
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

.rgb-animated-btn.active .rgb-glow {
  opacity: 0.85;
}

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

:global(.p-dark) .verification-card {
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
}

.status-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 10px;
  font-weight: 600;
  margin-bottom: 16px;
  font-size: 0.9rem;
}

.status-badge.none { background: #f3f4f6; color: #6b7280; }
.status-badge.pending { background: #fef3c7; color: #92400e; }
.status-badge.verified { background: #d1fae5; color: #065f46; }

:global(.p-dark) .status-badge.none { background: #374151; color: #9ca3af; }
:global(.p-dark) .status-badge.pending { background: #451a03; color: #fbbf24; }
:global(.p-dark) .status-badge.verified { background: #064e3b; color: #6ee7b7; }

.requirements {
  margin: 12px 0;
}

.requirements-title {
  font-weight: 600;
  margin-bottom: 8px;
  font-size: 0.9rem;
}

.requirements-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.requirements-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  margin-bottom: 4px;
  font-size: 0.85rem;
  color: #6b7280;
}

.requirements-list li.met {
  color: #059669;
}

.verify-btn {
  width: 100%;
  padding: 12px;
  border-radius: 10px;
  border: none;
  font-weight: 700;
  cursor: pointer;
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: white;
  transition: transform 0.2s;
}

.verify-btn:hover:not(.disabled) {
  transform: translateY(-1px);
}

.verify-btn.disabled {
  background: #d1d5db;
  color: #9ca3af;
  cursor: not-allowed;
}

.pending-msg {
  text-align: center;
  padding: 10px;
  background: #fef3c7;
  color: #92400e;
  border-radius: 8px;
  font-size: 0.85rem;
}

.verified-msg {
  text-align: center;
  padding: 16px;
  background: #d1fae5;
  border-radius: 10px;
}

.verified-icon {
  font-size: 2rem;
  display: block;
  margin-bottom: 6px;
}

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
  background: white;
  border-radius: 20px;
  max-width: 500px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
}

:global(.p-dark) .modal-content {
  background: #1f2937;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid #e5e7eb;
}

:global(.p-dark) .modal-header {
  border-color: #374151;
}

.modal-header h2 {
  font-size: 1.3rem;
  margin: 0;
}

.modal-close {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
}

.modal-body {
  padding: 20px;
}

.form-group {
  margin-bottom: 14px;
}

.form-group label {
  display: block;
  font-weight: 600;
  margin-bottom: 6px;
  font-size: 0.9rem;
}

.textarea {
  min-height: 80px;
  resize: vertical;
  font-family: inherit;
}

.submit-btn {
  width: 100%;
  padding: 12px;
  border-radius: 10px;
  border: none;
  font-weight: 700;
  cursor: pointer;
  background: linear-gradient(135deg, #22c55e, #16a34a);
  color: white;
  margin-top: 10px;
}

.submit-btn:disabled {
  background: #d1d5db;
  color: #9ca3af;
  cursor: not-allowed;
}

.section-title {
  font-size: 1.05rem;
  font-weight: 700;
  margin-bottom: 12px;
}

.username-title {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 8px 0;
}

.user-email {
  color: #6b7280;
  font-size: 0.9rem;
  margin-bottom: 8px;
}

.follow-action-btn {
  padding: 10px 24px;
  background: #7c3aed;
  color: white;
  border: none;
  border-radius: 999px;
  font-weight: 600;
  cursor: pointer;
  margin: 10px 0;
}

.listeners-number {
  font-size: 2rem;
  font-weight: 700;
  text-align: center;
  margin: 8px 0;
}

.listeners-sub {
  display: block;
  text-align: center;
  color: #6b7280;
  font-size: 0.85rem;
}

.bio-text {
  line-height: 1.6;
}

.empty-msg {
  text-align: center;
  color: #6b7280;
  font-style: italic;
  padding: 16px;
}

.genres-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.delete-icon {
  background: none;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  opacity: 0.7;
}

.delete-icon:hover {
  opacity: 1;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  font-size: 1.2rem;
  font-weight: 600;
}

.social-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.edit-btn {
  background: #f3f4f6;
  border: none;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1rem;
}

:global(.p-dark) .edit-btn {
  background: #374151;
}
/* ============================
   💬 CHAT BUTTON + ROW
   ============================ */
.follow-chat-row{
  display: flex;
  gap: 10px;
  justify-content: center;
  align-items: center;
  margin: 10px 0;
}

.chat-action-btn{
  padding: 10px 18px;
  background: #111;
  color: #fff;
  border: none;
  border-radius: 999px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: transform .15s ease, opacity .15s ease;
}

.chat-action-btn:hover{
  transform: translateY(-1px);
  opacity: .95;
}

:global(.p-dark) .chat-action-btn{
  background: #374151;
}

/* ============================
   💬 CHAT UI
   ============================ */
.chat-messages{
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 2px;
}

.chat-bubble{
  align-self: flex-start;
  background: #f3f4f6;
  padding: 10px 12px;
  border-radius: 14px;
  max-width: 85%;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.chat-bubble.me{
  align-self: flex-end;
  background: #7c3aed;
  color: #fff;
}

.chat-time{
  font-size: 0.72rem;
  opacity: 0.7;
}

.chat-input-row{
  display: flex;
  gap: 10px;
  margin-top: 12px;
  align-items: center;
}

.send-btn{
  padding: 12px 16px;
  border-radius: 12px;
  border: none;
  background: linear-gradient(135deg, #22c55e, #16a34a);
  color: #fff;
  font-weight: 800;
  cursor: pointer;
  white-space: nowrap;
}

.send-btn:active{
  transform: scale(0.98);
}

:global(.p-dark) .chat-bubble{
  background: #27272a;
  color: #fff;
}
/* 🔔 CHAT BADGE */
.chat-action-btn{
  position: relative;
}

.chat-badge{
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
