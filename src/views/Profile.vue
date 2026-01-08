<script setup>
import { ref, onMounted, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { useRoute, useRouter } from 'vue-router'
import { useFavorites } from '../stores/favorites'
import { useFollows } from '../stores/follows'
import ThemeToggle from '../components/ThemeToggle.vue'
import { useThemeStore } from '../stores/theme'

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

const profileUserId = ref(null)
const authUserId = ref(null)

/* ======================
   LOAD PROFILE
====================== */
const loadProfile = async () => {
  loading.value = true

  profileUserId.value = route.params.id
  if (!profileUserId.value) return

  const { data: profileData } = await supabase
    .from('profiles')
    .select('id, username, email, bio, genres')
    .eq('id', profileUserId.value)
    .single()

  profile.value = profileData

  const { data: auth } = await supabase.auth.getUser()
  authUserId.value = auth?.user?.id || null

  if (authUserId.value === profileUserId.value) {
    favorites.init(profileUserId.value)
  }

  if (authUserId.value) {
    await follows.loadFollowing(authUserId.value)
    await follows.loadFollowers(profileUserId.value)
  }

  const { data: saved } = await supabase
    .from('saved_audios')
    .select(`
      audios (
        id,
        title,
        artist
      )
    `)
    .eq('user_id', profileUserId.value)
    .order('created_at', { ascending: false })

  history.value =
    saved?.map(row => ({
      id: row.audios.id,
      song_title: row.audios.title,
      artist: row.audios.artist || 'Tú'
    })) || []

  const { data } = await supabase
    .from('audios')
    .select('id, title, created_at')
    .eq('user_id', profileUserId.value)
    .order('created_at', { ascending: false })

  uploadedAudios.value = data || []
  loading.value = false
}

/* ======================
   DELETE AUDIO
====================== */
const deleteAudio = async (audioId) => {
  if (authUserId.value !== profileUserId.value) return
  if (!confirm('¿Eliminar este audio?')) return

  await supabase.from('saved_audios').delete().eq('audio_id', audioId)
  await supabase.from('listening_history').delete().eq('song_id', audioId)
  await supabase.from('audios').delete().eq('id', audioId)

  uploadedAudios.value = uploadedAudios.value.filter(a => a.id !== audioId)
}

/* ======================
   FOLLOW
====================== */
const toggleFollow = async () => {
  if (!authUserId.value || authUserId.value === profileUserId.value) return

  follows.isFollowing(profileUserId.value)
    ? await follows.unfollow(authUserId.value, profileUserId.value)
    : await follows.follow(authUserId.value, profileUserId.value)
}

/* ======================
   NAV
====================== */
const goBack = () => {
  router.push('/app')
}

/* ======================
   LIFECYCLE
====================== */
onMounted(() => {
  theme.init()
  loadProfile()
})

watch(() => route.params.id, loadProfile)
</script>

<template>
  <section class="profile">
    <div v-if="loading" class="loading">Cargando perfil…</div>

    <div v-else class="card">
      <!-- 🔙 STICKY BAR -->
      <div class="sticky-bar">
        <button class="back-btn" @click="goBack">
          ← Volver
        </button>
      </div>

      <!-- HEADER -->
      <div class="profile-header">
        <div class="avatar">👤</div>

        <h1>{{ profile.username }}</h1>

        <button
          v-if="authUserId && authUserId !== profileUserId"
          class="follow-btn"
          @click="toggleFollow"
        >
          {{ follows.isFollowing(profileUserId) ? 'Siguiendo' : 'Seguir' }}
        </button>

        <p class="email">{{ profile.email }}</p>

        <ThemeToggle />
      </div>

      <!-- BIO -->
      <div v-if="profile.bio" class="section">
        <h3>📝 Bio</h3>
        <p class="text">{{ profile.bio }}</p>
      </div>

      <!-- GÉNEROS -->
      <div v-if="profile.genres?.length" class="section">
        <h3>🎵 Géneros</h3>
        <div class="tags">
          <span v-for="g in profile.genres" :key="g" class="tag">
            {{ g }}
          </span>
        </div>
      </div>

      <!-- 🎵 AUDIOS SUBIDOS -->
      <div class="section">
        <h3>🎶 Audios subidos</h3>

        <p v-if="!uploadedAudios.length" class="empty">
          Este usuario no ha subido audios
        </p>

        <div
          v-for="audio in uploadedAudios"
          :key="audio.id"
          class="saved-song"
        >
          <strong class="song-title">{{ audio.title }}</strong>

          <button
            v-if="authUserId === profileUserId"
            class="delete"
            @click="deleteAudio(audio.id)"
          >
            🗑
          </button>
        </div>
      </div>

      <!-- ❤️ GUSTADOS -->
      <div class="section">
        <h3>❤️ Gustados</h3>

        <p v-if="!history.length" class="empty">
          No ha guardado audios aún
        </p>

        <div
          v-for="song in history"
          :key="song.id"
          class="saved-song"
        >
          <div>
            <strong class="song-title">{{ song.song_title }}</strong>
            <small class="song-artist">{{ song.artist }}</small>
          </div>
          <span class="heart">❤️</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.profile {
  position: fixed;
  inset: 0;
  display: flex;
  justify-content: center;
  background: inherit;
}

.loading {
  margin-top: 3rem;
  opacity: .7;
}

/* ======================
   CARD PRINCIPAL
====================== */
.card {
  width: 100%;
  max-width: 420px;
  height: 100vh;
  padding: 0 1.5rem 2rem;
  overflow-y: auto;
}

/* ======================
   STICKY BAR / VOLVER
====================== */
.sticky-bar {
  position: sticky;
  top: 12px;
  padding: .5rem 0;
  z-index: 10;
}

.back-btn {
  background: rgba(255,255,255,.9);
  padding: 8px 14px;
  border-radius: 999px;
  border: none;
  font-weight: 600;
  cursor: pointer;
  color: #111;
  box-shadow: 0 4px 12px rgba(0,0,0,.12);
}

/* DESKTOP */
@media (min-width: 1024px) {
  .sticky-bar {
    position: fixed;
    top: 20px;
    left: 24px;
    z-index: 100;
  }
}

/* ======================
   HEADER PERFIL
====================== */
.profile-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 2rem 0;
}

.avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: linear-gradient(135deg,#c4b5fd,#7c3aed);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
}

.email {
  font-size: .75rem;
  opacity: .7;
}

/* ======================
   SECCIONES / CARDS
====================== */
.section {
  margin-top: 1.25rem;
  background: white;
  padding: .9rem 1.1rem;
  border-radius: 14px;
  box-shadow: 0 6px 18px rgba(0,0,0,.06);
}

.section h3 {
  color: #111;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: .4rem;
}

/* Desktop centrado */
@media (min-width: 768px) {
  .section {
    max-width: 420px;
    margin-left: auto;
    margin-right: auto;
  }
}

/* ======================
   TEXTO (VISIBLE EN CLARO)
====================== */
.section p,
.section span,
.section small {
  color: #111;
}

.section .empty {
  color: #444;
}

/* ======================
   TAGS
====================== */
.tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.tag {
  background: #f3f4f6;
  padding: 6px 14px;
  border-radius: 999px;
  font-size: .75rem;
}

/* ======================
   SONGS
====================== */
.saved-song {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  margin-top: 6px;
  border-radius: 12px;
}

.song-title {
  color: #111;
}

.song-artist {
  font-size: .7rem;
  opacity: .7;
}

.delete {
  background: none;
  border: none;
  cursor: pointer;
}

.empty {
  opacity: .6;
}

/* ======================
   DARK MODE 🌙
====================== */
:global(.p-dark) .profile,
:global(.p-dark) .card {
  background: #0f0f12;
}

:global(.p-dark) h1,
:global(.p-dark) h3,
:global(.p-dark) strong,
:global(.p-dark) .back-btn {
  color: #f9fafb;
}

:global(.p-dark) p,
:global(.p-dark) span,
:global(.p-dark) small {
  color: #e5e7eb;
}

:global(.p-dark) .empty {
  color: #9ca3af;
}

:global(.p-dark) .saved-song {
  background: #18181b;
  border: 1px solid #27272a;
}

:global(.p-dark) .tag {
  background: #27272a;
  color: #e5e7eb;
}

:global(.p-dark) .section {
  background: #18181b;
  border: 1px solid #27272a;
}

:global(.p-dark) .back-btn {
  background: #18181b;
}
</style>
