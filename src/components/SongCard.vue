<script setup>
import { useFavorites } from '../stores/favorites'

const props = defineProps({
  song: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['play'])

const favorites = useFavorites()

const play = () => {
  emit('play', props.song)
}

const toggleSave = async (e) => {
  e.stopPropagation()

  // si aún no hay sesión / init de favoritos, no hacemos nada
  if (!favorites.userId) return

  // 🔥 ANIMACIÓN
  const btn = e.currentTarget
  btn.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(1.5)' },
      { transform: 'scale(0.9)' },
      { transform: 'scale(1)' }
    ],
    {
      duration: 400,
      easing: 'cubic-bezier(.17,.89,.32,1.49)'
    }
  )

  try {
    await favorites.toggle(props.song.id)
  } catch (err) {
    console.warn('⚠️ No se pudo actualizar favorito:', err)
  }
}
</script>

<template>
  <div class="song-card" @click="play">
    <!-- INFO -->
    <div class="info">
      <strong class="title" :title="song.title">
        {{ song.title }}
      </strong>

      <p v-if="song.note" class="note" :title="song.note">
        {{ song.note }}
      </p>

      <!-- 👤 USERNAME REAL DEL AUDIO -->
      <small class="artist">
        {{ song.artist }}
      </small>
    </div>

    <!-- ACTIONS -->
    <div class="actions">
      <button class="icon play">▶</button>

      <!-- ❤️ FAVORITO -->
      <button class="icon save" @click="toggleSave" :disabled="favorites.saving">
        {{ favorites.isFav(song.id) ? '❤️' : '🤍' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.song-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.04);
  margin-bottom: 12px;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.song-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.08);
}

.info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 75%;
}

.title {
  font-size: 0.95rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.note {
  font-size: 0.8rem;
  color: #555;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.artist {
  font-size: 0.75rem;
  opacity: 0.7;
}

.actions {
  display: flex;
  gap: 10px;
}

.icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.play {
  background: #22c55e;
  color: white;
  box-shadow: 0 6px 16px rgba(34, 197, 94, 0.4);
}

.save {
  background: #f3f4f6;
  color: #111;
}

.save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
