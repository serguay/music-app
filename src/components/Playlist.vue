<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { supabase } from '../lib/supabase'

const props = defineProps({
  search: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['play', 'songs-loaded'])

const songs = ref([])
const loading = ref(true)
const currentUserId = ref(null)
const playCounts = ref({})
const songRefs = ref({})

let channel = null
let lastPlayedId = ref(null)

/* ======================
   🔍 SEARCH HIT
====================== */
const searchHitId = ref(null)

/* ======================
   PLAY COUNTS
====================== */
const loadPlayCounts = async () => {
  const { data } = await supabase
    .from('listening_history')
    .select('song_id')

  if (!data) return

  const counts = {}
  data.forEach(row => {
    counts[row.song_id] = (counts[row.song_id] || 0) + 1
  })

  playCounts.value = counts
}

/* ======================
   LOAD SONGS
====================== */
const loadSongs = async () => {
  loading.value = true

  const { data: audios, error } = await supabase
    .from('audios')
    .select(`
      id,
      title,
      audio_url,
      note,
      created_at,
      image_url,
      user_id,
      profiles ( username )
    `)
    .order('created_at', { ascending: false })

  if (error) return

  songs.value = (audios || []).map(song => ({
    ...song,
    username: song.profiles?.username || 'Usuario'
  }))

  emit('songs-loaded', songs.value)
  await loadPlayCounts()
  loading.value = false
}

/* ======================
   SEARCH AUTOSCROLL + HIT
====================== */
watch(
  () => props.search,
  async (value) => {
    searchHitId.value = null
    if (!value) return

    await nextTick()

    const firstMatch = songs.value.find(song =>
      song.title?.toLowerCase().includes(value.toLowerCase())
    )

    if (firstMatch && songRefs.value[firstMatch.id]) {
      searchHitId.value = firstMatch.id

      songRefs.value[firstMatch.id].scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      })
    }
  }
)

/* ======================
   DELETE
====================== */
const deleteSong = async (songId) => {
  if (!confirm('¿Seguro que quieres eliminar este audio?')) return

  await supabase.from('saved_audios').delete().eq('audio_id', songId)
  await supabase.from('listening_history').delete().eq('song_id', songId)
  await supabase.from('audios').delete().eq('id', songId)

  songs.value = songs.value.filter(s => s.id !== songId)
  await loadPlayCounts()
}

/* ======================
   PLAY
====================== */
const playSong = (song) => {
  if (lastPlayedId.value === song.id) return
  lastPlayedId.value = song.id

  emit('play', {
    ...song,
    url: song.audio_url,
    username: song.username || 'Usuario'
  })
}

/* ======================
   REALTIME
====================== */
onMounted(async () => {
  const { data } = await supabase.auth.getUser()
  currentUserId.value = data?.user?.id || null

  await loadSongs()

  channel = supabase
    .channel('playlist-realtime')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'audios' },
      payload => {
        songs.value = [
          { ...payload.new, username: 'Usuario' },
          ...songs.value
        ]
      }
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'listening_history' },
      payload => {
        const id = payload.new.song_id
        playCounts.value[id] = (playCounts.value[id] || 0) + 1
      }
    )
    .subscribe()
})

onUnmounted(() => {
  if (channel) supabase.removeChannel(channel)
})
</script>

<template>
  <div class="playlist">
    <p v-if="loading" class="empty">Cargando audios...</p>
    <p v-else-if="!songs.length" class="empty">No hay audios aún</p>

    <div class="playlist-scroll">
      <div
        v-for="song in songs"
        :key="song.id"
        class="song-card"
        :class="{
          playing: lastPlayedId === song.id,
          'search-hit': searchHitId === song.id
        }"
        :ref="el => songRefs[song.id] = el"
        @click="playSong(song)"
      >

        <!-- INFO -->
        <div class="info">
          <div class="title-wrapper">
            <strong class="title">
              <span>{{ song.title }}</span>
            </strong>
          </div>
          <small v-if="song.note">{{ song.note }}</small>
        </div>

        <!-- ACTIONS -->
        <div class="actions-box">
          <div class="plays-box">
            ▶ {{ playCounts[song.id] || 0 }}
          </div>

          <button
            v-if="song.user_id === currentUserId"
            class="delete-btn"
            @click.stop="deleteSong(song.id)"
          >
            🗑️
          </button>
        </div>
      </div>
    </div>
  </div>
</template>



<style scoped>
/* =========================
   PLAYLIST
========================= */
.playlist {
  margin-top: 1.5rem;
}

/* =========================
   SONG CARD (GLASS GRIS)
========================= */
.song-card {
  position: relative;

  border-radius: 16px;
  padding: 10px 14px;
  margin-bottom: 10px;

  display: flex;
  gap: 12px;
  cursor: pointer;

  width: 100%;
  max-width: 100%;
  overflow: visible;

  background: rgba(245, 246, 248, 0.92);

  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);

  border: 1px solid rgba(0,0,0,0.06);

  box-shadow:
    0 10px 30px rgba(0,0,0,0.08);

  transition:
    transform .15s ease,
    box-shadow .2s ease,
    border-color .2s ease;
}

/* ===== CAPA GLASS INTERIOR ===== */
.song-card::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;

  background: rgba(235, 237, 240, 0.9);

  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);

  z-index: 0;
}

.song-card > * {
  position: relative;
  z-index: 1;
}

/* =========================
   🔍 SEARCH HIT (FLECHA)
========================= */
.song-card.search-hit {
  border-color: rgba(99,102,241,0.9);
  box-shadow:
    0 0 0 1px rgba(99,102,241,0.45),
    0 0 18px rgba(99,102,241,0.45),
    0 18px 45px rgba(0,0,0,0.18);
}

/* Flecha */
.song-card.search-hit::after {
  content: "➜";
  position: absolute;
  left: -26px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 22px;
  font-weight: 700;
  color: #6366f1;
  animation: bounce-arrow 1s infinite ease-in-out;
}

/* animación flecha */
@keyframes bounce-arrow {
  0%   { transform: translate(-4px, -50%); opacity: 0.6; }
  50%  { transform: translate(0px, -50%); opacity: 1; }
  100% { transform: translate(-4px, -50%); opacity: 0.6; }
}

/* =========================
   HOVER
========================= */
.song-card:hover {
  transform: translateY(-1px);
  box-shadow:
    0 14px 40px rgba(0,0,0,0.12),
    0 0 18px rgba(99,102,241,0.25);
}

/* =========================
   INFO
========================= */
.info {
  flex: 1;
  min-width: 0;
}

.info strong,
.title span {
  font-size: 0.95rem;
  line-height: 1.2;
  color: #111;
}

.info small {
  font-size: 0.7rem;
  margin-top: 2px;
  color: #666;
}

/* =========================
   TITULO
========================= */
.title-wrapper {
  overflow: hidden;
  max-width: 100%;
}

.title span {
  display: inline-block;
  white-space: nowrap;
  max-width: 100%;
}

/* marquee SOLO playing */
.song-card.playing .title span {
  animation: marquee 8s linear infinite;
}

@keyframes marquee {
  from { transform: translateX(0); }
  to { transform: translateX(-100%); }
}

/* =========================
   ACTIONS
========================= */
.actions-box {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

/* ▶ plays */
.plays-box {
  display: flex;
  align-items: center;
  gap: 6px;

  font-size: 0.75rem;
  font-weight: 600;

  padding: 6px 10px;
  border-radius: 999px;

  background: rgba(0,0,0,0.08);
  color: #111;
}

/* 🗑 delete */
.delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;

  width: 34px;
  height: 34px;

  border-radius: 10px;
  border: none;
  cursor: pointer;

  background: rgba(0,0,0,0.08);
  color: #111;

  font-size: 1rem;
  transition: background .15s ease, transform .15s ease;
}

.delete-btn:hover {
  background: rgba(239,68,68,0.15);
  transform: scale(1.05);
}

/* =========================
   🔥 FIX PLAYING
========================= */
.song-card.playing {
  backdrop-filter: blur(12px) !important;
  -webkit-backdrop-filter: blur(12px) !important;
}

/* =========================
   DARK MODE 🌙
========================= */
:global(.p-dark) .song-card {
  background: rgba(20,20,22,0.85);
  border: 1px solid rgba(255,255,255,0.06);

  box-shadow:
    0 0 0 1px rgba(255,255,255,0.04),
    0 20px 50px rgba(0,0,0,0.6);
}

:global(.p-dark) .song-card::before {
  background: rgba(28,28,30,0.9);
}

/* search hit dark */
:global(.p-dark) .song-card.search-hit {
  border-color: rgba(99,102,241,1);
  box-shadow:
    0 0 0 1px rgba(99,102,241,0.6),
    0 0 22px rgba(99,102,241,0.7),
    0 30px 70px rgba(0,0,0,0.9);
}

:global(.p-dark) .song-card.search-hit::after {
  color: #818cf8;
}

:global(.p-dark) .song-card:hover {
  box-shadow:
    0 0 0 1px rgba(255,255,255,0.08),
    0 0 28px rgba(99,102,241,0.35),
    0 25px 60px rgba(0,0,0,0.85);
}

:global(.p-dark) .song-card.playing {
  border-color: rgba(59,130,246,0.8);

  box-shadow:
    0 0 0 1px rgba(59,130,246,0.45),
    0 0 18px rgba(59,130,246,0.6),
    0 0 40px rgba(59,130,246,0.45),
    0 30px 70px rgba(0,0,0,0.9);

  transform: scale(1.02);
}

:global(.p-dark) .info strong,
:global(.p-dark) .title span {
  color: #f9fafb;
}

:global(.p-dark) .info small {
  color: #9ca3af;
}

:global(.p-dark) .plays-box,
:global(.p-dark) .delete-btn {
  background: rgba(255,255,255,0.08);
  color: #e5e7eb;
}

:global(.p-dark) .delete-btn:hover {
  background: rgba(239,68,68,0.25);
}

/* =========================
   MOBILE
========================= */
@media (max-width: 640px) {
  .song-card {
    flex-direction: column;
  }

  .song-card.search-hit::after {
    display: none;
  }

  .actions-box {
    justify-content: flex-end;
  }
}

/* =========================
   EMPTY
========================= */
.empty {
  text-align: center;
  opacity: 0.6;
}

</style>