<script setup>
import { ref } from 'vue'
import { supabase } from '../lib/supabase'

const props = defineProps({
  userId: {
    type: String,
    required: true
  }
})

const username = ref('')
const bio = ref('')
const selectedGenres = ref([])
const loading = ref(false)
const error = ref(null)

const genres = [
  'Pop',
  'Rock',
  'Hip Hop',
  'Electrónica',
  'Techno',
  'House',
  'Reggaeton',
  'Trap',
  'Jazz',
  'Lo-Fi',
  'Indie'
]

const toggleGenre = (genre) => {
  if (selectedGenres.value.includes(genre)) {
    selectedGenres.value = selectedGenres.value.filter(g => g !== genre)
  } else {
    selectedGenres.value.push(genre)
  }
}

const saveProfile = async () => {
  if (!username.value.trim()) {
    error.value = 'El nombre de usuario es obligatorio'
    return
  }

  loading.value = true
  error.value = null

  const { error: supaError } = await supabase
    .from('profiles')
    .update({
      username: username.value,
      bio: bio.value,
      genres: selectedGenres.value
    })
    .eq('id', props.userId)

  loading.value = false

  if (supaError) {
    error.value = supaError.message
  } else {
    location.reload()
  }
}
</script>

<template>
  <div class="overlay">
    <div class="modal">
      <h2>Completa tu perfil 🎧</h2>
      <p class="subtitle">
        Antes de continuar, cuéntanos un poco sobre ti
      </p>

      <input
        v-model="username"
        type="text"
        placeholder="Nombre de usuario"
      />

      <textarea
        v-model="bio"
        placeholder="Bio (artista, productor, oyente...)"
        rows="3"
      />

      <div class="genres">
        <span
          v-for="genre in genres"
          :key="genre"
          :class="['genre', { active: selectedGenres.includes(genre) }]"
          @click="toggleGenre(genre)"
        >
          {{ genre }}
        </span>
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <button @click="saveProfile" :disabled="loading">
        {{ loading ? 'Guardando...' : 'Guardar perfil' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.25s ease;
}

.modal {
  background: white;
  width: 90%;
  max-width: 380px;
  border-radius: 18px;
  padding: 24px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.2);
  animation: slideUp 0.35s ease;
}

h2 {
  margin: 0;
  font-size: 1.4rem;
}

.subtitle {
  font-size: 0.9rem;
  color: #666;
  margin: 6px 0 16px;
}

input,
textarea {
  width: 100%;
  border-radius: 12px;
  border: 1px solid #ddd;
  padding: 12px;
  font-size: 0.95rem;
  margin-bottom: 12px;
}

textarea {
  resize: none;
}

.genres {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.genre {
  padding: 8px 12px;
  border-radius: 999px;
  font-size: 0.8rem;
  border: 1px solid #ddd;
  cursor: pointer;
  transition: all 0.15s ease;
}

.genre.active {
  background: #111;
  color: white;
  border-color: #111;
}

button {
  width: 100%;
  background: #1db954;
  color: black;
  border: none;
  padding: 12px;
  border-radius: 12px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
}

button:disabled {
  opacity: 0.7;
}

.error {
  color: #e11d48;
  font-size: 0.8rem;
  margin-bottom: 10px;
}

/* Animaciones */
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes slideUp {
  from {
    transform: translateY(20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}
</style>
