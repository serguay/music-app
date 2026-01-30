<script setup>
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { supabase } from '../lib/supabase'

const route = useRoute()
const song = ref(null)
const loading = ref(true)
const errorMsg = ref('')

onMounted(async () => {
  try {
    const id = route.params.id

    const { data, error } = await supabase
      .from('audios')
      .select('id,title,artist,audio_url,image_url,note,genre')
      .eq('id', id)
      .single()

    if (error) {
      errorMsg.value = 'No existe esa canción'
    } else {
      song.value = data
    }
  } catch (e) {
    errorMsg.value = 'Error cargando la canción'
  } finally {
    loading.value = false
  }
})

const copyLink = async () => {
  const url = `${window.location.origin}/#/s/${route.params.id}`
  await navigator.clipboard.writeText(url)
  alert('🔗 Link copiado')
}
</script>

<template>
  <section class="public-wrap">
    <div class="public-card">
      <p v-if="loading" class="muted">Cargando...</p>

      <template v-else-if="song">
        <img v-if="song.image_url" :src="song.image_url" class="cover" />

        <h2 class="title">{{ song.title }}</h2>
        <p class="artist">{{ song.artist || 'Artista' }}</p>

        <audio class="player" controls :src="song.audio_url"></audio>

        <p v-if="song.note" class="note">{{ song.note }}</p>

        <div class="actions">
          <button class="btn" @click="copyLink">Copiar link</button>
          <a class="btn ghost" href="/#/login">Entrar a la app</a>
        </div>
      </template>

      <p v-else class="muted">{{ errorMsg || 'No existe esa canción' }}</p>
    </div>
  </section>
</template>

<style scoped>
.public-wrap{
  min-height: 100vh;
  display:flex;
  align-items:center;
  justify-content:center;
  padding: 20px;
  background: #f3f4f6;
}

.public-card{
  width:100%;
  max-width: 420px;
  background: #fff;
  border-radius: 22px;
  padding: 18px;
  box-shadow: 0 30px 80px rgba(0,0,0,.12);
}

.cover{
  width:100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  border-radius: 18px;
  margin-bottom: 14px;
}

.title{
  margin: 0;
  font-weight: 900;
  font-size: 1.3rem;
}

.artist{
  margin: 4px 0 12px;
  opacity: .65;
  font-weight: 700;
}

.player{
  width:100%;
  margin: 6px 0 10px;
}

.note{
  margin: 10px 0 0;
  opacity: .8;
  line-height: 1.35;
}

.actions{
  display:flex;
  gap: 10px;
  margin-top: 14px;
}

.btn{
  flex:1;
  border: none;
  cursor:pointer;
  border-radius: 14px;
  padding: 12px 14px;
  font-weight: 900;
  background: #111;
  color: #fff;
}

.btn.ghost{
  background: #f3f4f6;
  color:#111;
  text-decoration:none;
  display:flex;
  align-items:center;
  justify-content:center;
}

.muted{ opacity:.7; font-weight:700; }
</style>
