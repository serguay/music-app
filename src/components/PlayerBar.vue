<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
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

/* ======================
   STATE
====================== */
const userId = ref(null)
const isSaved = ref(false)

const currentTime = ref(0)
const duration = ref(0)
let rafId = null

/* ======================
   AUTH
====================== */
onMounted(async () => {
  const { data } = await supabase.auth.getUser()
  userId.value = data?.user?.id || null

  if (userId.value) {
    favorites.init(userId.value)
  }

  startTracking()
})

onUnmounted(() => {
  if (rafId) cancelAnimationFrame(rafId)
})

/* ======================
   TRACK AUDIO TIME
====================== */
const startTracking = () => {
  const update = () => {
    if (player.audio) {
      currentTime.value = player.audio.currentTime || 0
      duration.value = player.audio.duration || 0
    }
    rafId = requestAnimationFrame(update)
  }
  update()
}

/* ======================
   COMPUTED
====================== */
const song = computed(() => player.currentSong)
const playing = computed(() => player.isPlaying)
const progress = computed(() => currentTime.value)
const total = computed(() => duration.value)

/* ======================
   TIME FORMAT
====================== */
const formatTime = (sec) => {
  if (!sec || isNaN(sec)) return '00:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/* ======================
   CONTROLS
====================== */
const toggle = () => {
  if (!player.audio) {
    if (player.currentSong) player.playSong(player.currentSong)
    return
  }
  player.isPlaying ? player.pauseSong() : player.resumeSong()
}

const seek = (e) => {
  if (player.audio) player.audio.currentTime = e.target.value
}

/* ======================
   SAVE
====================== */
const toggleSave = async () => {
  if (!song.value?.id) return
  await favorites.toggle(song.value.id)
  isSaved.value = favorites.isFav(song.value.id)
}

/* ======================
   ❌ CLOSE PLAYER (LA CLAVE)
====================== */
const closePlayer = () => {
  player.stopSong()
  emit('close')
}
</script>

<template>
  <div v-if="song" class="player" :class="{ playing }">

    <!-- COVER + NOTAS -->
    <div class="cover-wrapper">
      <img
        v-if="song.image_url"
        :src="song.image_url"
        class="cover"
        alt="cover"
      />

      <div v-if="playing" class="music-notes">
        <span class="note">🎵</span>
        <span class="note">🎶</span>
        <span class="note">🎵</span>
        <span class="note">🎶</span>
      </div>
    </div>

    <!-- HEADER -->
    <div class="header">
      <div class="title-wrapper">
        <strong class="title">
          <span>{{ song.title }}</span>
        </strong>
      </div>

      <button
        class="username-btn"
        @click="emit('go-profile', song.user_id)"
      >
        {{ song.username || 'Usuario' }}
      </button>

      <!-- ❌ CERRAR (FUNCIONA) -->
      <button class="close" @click="closePlayer">✕</button>
    </div>

    <!-- PROGRESS -->
    <input
      class="range"
      type="range"
      min="0"
      :max="Math.max(total, 1)"
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
      <button class="play" @click="toggle">
        {{ playing ? '⏸' : '▶' }}
      </button>

      <button class="next" @click="emit('next')">⏭</button>

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
  bottom: 16px;
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
  z-index: 999;

  display: flex;
  flex-direction: column;
  gap: 12px;

  box-shadow:
    0 12px 36px rgba(0,0,0,.6),
    inset 0 1px 0 rgba(255,255,255,.05);

  backdrop-filter: blur(14px);
}

/* 🖥️ Desktop: compensa sidebar */
@media (min-width: 1024px) {
  .player {
    transform: translateX(calc(-50% + 40px));
  }
}

/* =========================
   COVER
========================= */
.cover-wrapper {
  position: absolute;
  top: -22px;
  left: 16px;
  width: 56px;
  height: 56px;
}

.cover {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  object-fit: cover;
  background: #111;
  box-shadow: 0 8px 24px rgba(0,0,0,.6);
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
  opacity: 0;
  animation: floatNote 2.4s infinite ease-in-out;
}

.note:nth-child(1) { left: 5%;  animation-delay: 0s; }
.note:nth-child(2) { left: 30%; animation-delay: .6s; }
.note:nth-child(3) { left: 55%; animation-delay: 1.2s; }
.note:nth-child(4) { left: 75%; animation-delay: 1.8s; }

@keyframes floatNote {
  0%   { transform: translateY(0) scale(.7); opacity: 0; }
  20%  { opacity: .9; }
  100% { transform: translateY(-42px) scale(1.2); opacity: 0; }
}

/* =========================
   HEADER
========================= */
.header {
  position: relative;
  text-align: center;
  margin-top: 12px;
}

.title-wrapper,
.title,
.title span {
  pointer-events: none;
}

.title {
  font-weight: 700;
  font-size: .95rem;
}

.title-wrapper {
  width: 100%;
  overflow: hidden;
  white-space: nowrap;
}

.title span {
  display: inline-block;
  padding-left: 100%;
  animation: marquee 10s linear infinite;
}

.player:not(.playing) .title span {
  animation-play-state: paused;
}

@keyframes marquee {
  from { transform: translateX(0); }
  to   { transform: translateX(-100%); }
}

.username-btn {
  margin-top: 4px;
  background: none;
  border: none;
  color: rgba(255,255,255,.6);
  font-size: .75rem;
  cursor: pointer;
}

/* =========================
   ❌ BOTÓN CERRAR
========================= */
.close {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 28px;
  height: 28px;
  background: rgba(0,0,0,.75);
  border: none;
  border-radius: 50%;
  color: white;
  font-size: 1.1rem;
  cursor: pointer;
  z-index: 10000;
}

/* =========================
   PROGRESS
========================= */
.range {
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: rgba(255,255,255,.15);
  accent-color: #22c55e;
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

.play,
.next {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: radial-gradient(circle at top, #22c55e, #16a34a);
  border: none;
  font-size: 1.4rem;
  cursor: pointer;
}

.save {
  font-size: 1.6rem;
  background: none;
  border: none;
  opacity: .35;
  cursor: pointer;
}

.save.active {
  opacity: 1;
  color: #ef4444;
  transform: scale(1.15);
}
</style>
