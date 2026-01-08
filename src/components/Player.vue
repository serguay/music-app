<script setup>
import { onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { usePlayer } from '../stores/player'
import { useFavorites } from '../stores/favorites'

const player = usePlayer()
const favorites = useFavorites()

onMounted(async () => {
  const { data } = await supabase.auth.getUser()
  favorites.init(data?.user?.id)
})
</script>

<template>
  <transition name="slide-up">
    <div
      v-if="player.currentSong"
      :key="player.currentSong.id"
      class="player-card"
    >
      <div class="info">
        <strong>{{ player.currentSong.title }}</strong>
        <small>{{ player.currentSong.artist || 'Tú' }}</small>
      </div>

      <div class="controls">
        <button @click="player.isPlaying ? player.pauseSong() : player.resumeSong()">
          {{ player.isPlaying ? '⏸' : '▶️' }}
        </button>

        <button @click="favorites.toggle(player.currentSong.id)">
          {{ favorites.isFav(player.currentSong.id) ? '❤️' : '🤍' }}
        </button>

        <button @click="player.stopSong()">✖</button>
      </div>

      <input
        type="range"
        min="0"
        max="100"
        value="0"
        class="progress"
      />
    </div>
  </transition>
</template>

<style scoped>
.player-card {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  width: 90%;
  max-width: 420px;
  background: #111;
  color: white;
  border-radius: 20px;
  padding: 1rem;
  box-shadow: 0 20px 40px rgba(0,0,0,.4);
}

.info {
  margin-bottom: .8rem;
}

.controls {
  display: flex;
  justify-content: space-between;
  gap: .5rem;
}

.controls button {
  flex: 1;
  background: #22c55e;
  border: none;
  padding: .6rem;
  border-radius: 12px;
  font-size: 1.2rem;
}

.progress {
  width: 100%;
  margin-top: .8rem;
}

.slide-up-enter-active {
  animation: slideUp .3s ease;
}

@keyframes slideUp {
  from { transform: translate(-50%, 100%); }
  to { transform: translate(-50%, 0); }
}
</style>
