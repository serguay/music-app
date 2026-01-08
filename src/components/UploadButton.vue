<script setup>
import { ref } from 'vue'
import { supabase } from '../lib/supabase'

const emit = defineEmits(['uploaded'])

const fileInput = ref(null)
const file = ref(null)
const imageFile = ref(null)
const showModal = ref(false)
const title = ref('')
const description = ref('')
const uploading = ref(false)

/* ======================
   🔐 AUDIO HASH (GRATIS)
====================== */
const generateAudioHash = async (file) => {
  const buffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/* ======================
   FILE SELECT
====================== */
const onFileChange = (e) => {
  const selected = e.target.files[0]
  if (!selected) return

  file.value = selected
  title.value = selected.name.replace(/\.[^/.]+$/, '')
  description.value = ''
  showModal.value = true
}

/* ======================
   IMAGE SELECT (PNG ONLY)
====================== */
const onImageChange = (e) => {
  const img = e.target.files[0]
  if (!img) return

  if (img.type !== 'image/png') {
    alert('La imagen debe ser PNG')
    e.target.value = null
    imageFile.value = null
    return
  }

  imageFile.value = img
}

/* ======================
    UPLOAD
====================== */
const upload = async () => {
  if (!file.value || !title.value) return

  if (!imageFile.value) {
    alert('Debes subir una imagen PNG')
    return
  }

  uploading.value = true

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    uploading.value = false
    return
  }

  /* ---------- 🔐 HASH CHECK ---------- */
  const audioHash = await generateAudioHash(file.value)

  const { data: existing } = await supabase
    .from('audios')
    .select('id')
    .eq('audio_hash', audioHash)
    .limit(1)

  if (existing && existing.length > 0) {
    alert('❌ Este audio ya existe en la plataforma')
    uploading.value = false
    return
  }

  /* ---------- AUDIO ---------- */
  const cleanName = title.value
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9.-]/g, '')

  const ext = file.value.name.split('.').pop()
  const audioPath = `${user.id}/${Date.now()}-${cleanName}.${ext}`

  const { error: audioError } = await supabase.storage
    .from('music-bucket')
    .upload(audioPath, file.value)

  if (audioError) {
    console.error(audioError)
    alert('Error subiendo audio')
    uploading.value = false
    return
  }

  const { data: audioData } = supabase.storage
    .from('music-bucket')
    .getPublicUrl(audioPath)

  /* ---------- IMAGE ---------- */
  const imgPath = `${user.id}/${Date.now()}.png`

  const { error: imgError } = await supabase.storage
    .from('audio-images')
    .upload(imgPath, imageFile.value, {
      contentType: 'image/png'
    })

  if (imgError) {
    console.error(imgError)
    alert('Error subiendo imagen')
    uploading.value = false
    return
  }

  const { data: imgData } = supabase.storage
    .from('audio-images')
    .getPublicUrl(imgPath)

  /* ---------- DB ---------- */
  const { error: dbError } = await supabase.from('audios').insert({
    user_id: user.id,
    title: title.value,
    artist: 'Tú',
    audio_url: audioData.publicUrl,
    note: description.value,
    image_url: imgData.publicUrl,
    audio_hash: audioHash
  })

  if (dbError) {
    console.error(dbError)
    alert('Error guardando audio')
    uploading.value = false
    return
  }

  /* ---------- RESET ---------- */
  uploading.value = false
  showModal.value = false
  file.value = null
  imageFile.value = null
  title.value = ''
  description.value = ''

  emit('uploaded')
}
</script>

<template>
  <!-- BOTÓN -->
  <label class="upload-btn">
    + Subir audio
    <input
      ref="fileInput"
      type="file"
      accept="audio/*"
      hidden
      @change="onFileChange"
    />
  </label>

  <!-- MODAL -->
  <div v-if="showModal" class="overlay">
    <div class="modal">
      <h3>🎵 Nuevo audio</h3>

      <label>Nombre del audio</label>
      <input v-model="title" />

      <label class="desc-label">Descripción</label>
      <textarea
        v-model="description"
        placeholder="Describe este audio, idea, emoción, para qué sirve…"
      />

      <label class="desc-label">Imagen (PNG obligatorio)</label>

      <label class="image-upload">
        <input
          type="file"
          accept="image/png"
          required
          @change="onImageChange"
        />
        <span>
          {{ imageFile ? imageFile.name : 'Seleccionar imagen PNG' }}
        </span>
      </label>

      <small class="original">
        Archivo original: {{ file?.name }}
      </small>

      <div class="actions">
        <button class="cancel" @click="showModal = false">
          Cancelar
        </button>

        <button
          class="confirm"
          :disabled="uploading"
          @click="upload"
        >
          {{ uploading ? 'Subiendo…' : 'Subir' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.upload-btn {
  background: #111;
  color: white;
  padding: 12px 18px;
  border-radius: 12px;
  font-weight: 600;
  cursor: pointer;
}

/* MODAL */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.modal {
  width: 90%;
  max-width: 360px;
  background: white;
  border-radius: 20px;
  padding: 1.6rem;
}

.modal label {
  font-size: 0.8rem;
  font-weight: 600;
}

.desc-label {
  margin-top: 10px;
  display: block;
}

.modal input,
.modal textarea {
  width: 100%;
  margin-top: 6px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid #ddd;
  margin-bottom: 6px;
  resize: none;
}

.modal textarea {
  min-height: 80px;
}

/* 🖼️ IMAGEN */
.image-upload {
  margin-top: 8px;
  margin-bottom: 6px;
  border: 2px dashed #22c55e;
  border-radius: 14px;
  padding: 14px 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  font-weight: 600;
  font-size: 0.85rem;
  color: #166534;
  background: rgba(34, 197, 94, 0.08);
  cursor: pointer;
  transition: all 0.2s ease;
}

.image-upload:hover {
  background: rgba(34, 197, 94, 0.15);
  transform: scale(1.015);
}

.image-upload input {
  display: none;
}

.original {
  font-size: 0.7rem;
  opacity: 0.6;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 1rem;
}

.cancel {
  flex: 1;
  background: #eee;
  border: none;
  padding: 10px;
  border-radius: 10px;
}

.confirm {
  flex: 1;
  background: #22c55e;
  border: none;
  color: white;
  padding: 10px;
  border-radius: 10px;
}
</style>
