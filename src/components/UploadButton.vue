<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import { supabase } from '../lib/supabase'
import { DotLottieVue } from '@lottiefiles/dotlottie-vue'

const emit = defineEmits(['uploaded'])

/* --- 1. ESTADOS DEL FORMULARIO --- */
const fileInput = ref(null)
const file = ref(null)
const imageFile = ref(null)
const imagePreview = ref(null)
const videoFile = ref(null)
const videoPreview = ref(null)
const showModal = ref(false)
const title = ref('')
const description = ref('')
const uploading = ref(false)
const showSuccessAnim = ref(false)

/* --- 2. CONFIGURACIÓN DE GÉNEROS --- */
const selectedTag = ref('')
const tagsList = ['Techno', 'Hip Hop', 'Indie', 'Jazz', 'Rock', 'Pop', 'Lo-fi', 'Trap']

/* --- ✅ FIX iOS: bloquear scroll del body cuando el modal está abierto --- */
const lockBodyScroll = () => {
  document.documentElement.style.overflow = 'hidden'
  document.body.style.overflow = 'hidden'
  document.body.style.touchAction = 'none'
}
const unlockBodyScroll = () => {
  document.documentElement.style.overflow = ''
  document.body.style.overflow = ''
  document.body.style.touchAction = ''
}

watch(showModal, (v) => {
  if (v) lockBodyScroll()
  else unlockBodyScroll()
})

onBeforeUnmount(() => {
  unlockBodyScroll()
  if (imagePreview.value) URL.revokeObjectURL(imagePreview.value)
  if (videoPreview.value) URL.revokeObjectURL(videoPreview.value)
})

/* --- 3. LÓGICA DE SEGURIDAD (AUDIO HASH) --- */
const generateAudioHash = async (file) => {
  const buffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/* --- 4. MANEJO DE ARCHIVOS --- */
const onFileChange = (e) => {
  const selected = e.target.files[0]
  if (!selected) return
  file.value = selected
  title.value = decodeURIComponent(selected.name.replace(/\.[^/.]+$/, ''))
  showModal.value = true
}

const onImageChange = (e) => {
  const img = e.target.files[0]
  if (!img || img.type !== 'image/png') {
    alert('La imagen debe ser PNG')
    return
  }
  imageFile.value = img
  imagePreview.value = URL.createObjectURL(img)
}

const getVideoDurationSeconds = (file) => {
  return new Promise((resolve, reject) => {
    try {
      const url = URL.createObjectURL(file)
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.src = url
      video.onloadedmetadata = () => {
        const d = Number(video.duration || 0)
        URL.revokeObjectURL(url)
        resolve(d)
      }
      video.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('No se pudo leer el vídeo'))
      }
    } catch (e) {
      reject(e)
    }
  })
}

const onVideoChange = async (e) => {
  const v = e.target.files?.[0]
  if (!v) return

  // tipos permitidos
  const allowed = ['video/mp4', 'video/webm', 'video/quicktime']
  if (!allowed.includes(v.type)) {
    alert('El vídeo debe ser MP4 / WebM / QuickTime')
    e.target.value = ''
    return
  }

  // max 10s
  try {
    const secs = await getVideoDurationSeconds(v)
    if (secs > 10.1) {
      alert('❌ El vídeo debe durar máximo 10 segundos')
      e.target.value = ''
      videoFile.value = null
      if (videoPreview.value) URL.revokeObjectURL(videoPreview.value)
      videoPreview.value = null
      return
    }
  } catch {
    alert('❌ No se pudo validar la duración del vídeo')
    e.target.value = ''
    return
  }

  videoFile.value = v
  if (videoPreview.value) URL.revokeObjectURL(videoPreview.value)
  videoPreview.value = URL.createObjectURL(v)
}

/* --- 5. FUNCIÓN DE SUBIDA (LÓGICA SUPABASE) --- */
const upload = async () => {
  if (!file.value || !title.value || !imageFile.value || !selectedTag.value) {
    alert('Faltan datos por rellenar')
    return
  }

  uploading.value = true
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) { uploading.value = false; return }

  const audioHash = await generateAudioHash(file.value)
  const { data: existing } = await supabase
    .from('audios')
    .select('id')
    .eq('audio_hash', audioHash)
    .limit(1)

  if (existing && existing.length > 0) {
    alert('❌ Este audio ya existe')
    uploading.value = false
    return
  }

  const cleanName = title.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9.-]/g, '')
  const audioPath = `${user.id}/${Date.now()}-${cleanName}.${file.value.name.split('.').pop()}`
  await supabase.storage.from('music-bucket').upload(audioPath, file.value)
  const { data: audioData } = supabase.storage.from('music-bucket').getPublicUrl(audioPath)

  const imgPath = `${user.id}/${Date.now()}.png`
  await supabase.storage.from('audio-images').upload(imgPath, imageFile.value, { contentType: 'image/png' })
  const { data: imgData } = supabase.storage.from('audio-images').getPublicUrl(imgPath)

  // ✅ (Opcional) subir vídeo corto (máx 10s) a bucket `videos`
  let videoPublicUrl = null
  if (videoFile.value) {
    const videoExt = (videoFile.value.name.split('.').pop() || 'mp4').toLowerCase()
    const videoPath = `${user.id}/${Date.now()}-${cleanName}.${videoExt}`

    const { error: vErr } = await supabase.storage
      .from('videos')
      .upload(videoPath, videoFile.value, { contentType: videoFile.value.type, upsert: true })

    if (vErr) {
      uploading.value = false
      alert('Error subiendo vídeo')
      return
    }

    const { data: vData } = supabase.storage.from('videos').getPublicUrl(videoPath)
    videoPublicUrl = vData?.publicUrl || null
  }

  const { error: dbError } = await supabase.from('audios').insert({
    user_id: user.id,
    title: title.value,
    artist: 'Tú',
    audio_url: audioData.publicUrl,
    note: description.value,
    image_url: imgData.publicUrl,
    video_url: videoPublicUrl,
    audio_hash: audioHash,
    genre: selectedTag.value
  })

  if (!dbError) {
    uploading.value = false
    showSuccessAnim.value = true
    setTimeout(() => {
      showModal.value = false
      showSuccessAnim.value = false

      if (imagePreview.value) URL.revokeObjectURL(imagePreview.value)
      imagePreview.value = null
      imageFile.value = null

      if (videoPreview.value) URL.revokeObjectURL(videoPreview.value)
      videoPreview.value = null
      videoFile.value = null

      emit('uploaded')
    }, 3800)
  } else {
    uploading.value = false
    alert('Error guardando audio')
  }
}
</script>

<template>
  <label class="main-upload-trigger">
    + Subir audio
    <input
      ref="fileInput"
      type="file"
      accept="audio/*, .mp3, .wav, .m4a, .aac, .ogg"
      hidden
      @change="onFileChange"
    />
  </label>

  <!-- ✅ FIX DEFINITIVO: Teleport al body para que NUNCA quede detrás -->
  <Teleport to="body">
    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div :class="['modal-card', { 'success-mode': showSuccessAnim }]" role="dialog" aria-modal="true">

        <div v-if="!showSuccessAnim" class="modal-body">
          <header class="modal-header">
            <h3>🎵 Nuevo audio</h3>
          </header>

          <section class="form-container">
            <div class="form-group">
              <label>Nombre del track</label>
              <input v-model="title" type="text" placeholder="Título..." class="input-modern" />
            </div>

            <div class="form-group">
              <label>Descripción / Bio</label>
              <textarea v-model="description" placeholder="Escribe la historia de este audio..." class="textarea-modern"></textarea>
            </div>

            <div class="form-group">
              <label>Género musical</label>
              <div class="tags-flex">
                <button
                  v-for="tag in tagsList"
                  :key="tag"
                  type="button"
                  :class="['tag-pill', { active: selectedTag === tag }]"
                  @click="selectedTag = tag"
                >
                  {{ tag }}
                </button>
              </div>
            </div>

            <div class="form-group">
              <label>Portada (PNG)</label>
              <label class="image-wide-dropzone">
                <input type="file" accept="image/png, image/jpeg" hidden @change="onImageChange" />
                <div v-if="!imagePreview" class="plus-icon-big">+</div>
                <img v-else :src="imagePreview" class="image-preview-full" />
              </label>
            </div>

            <div class="form-group">
              <label>Vídeo (opcional · máx 10s)</label>
              <label class="image-wide-dropzone">
                <input type="file" accept="video/mp4,video/webm,video/quicktime" hidden @change="onVideoChange" />
                <div v-if="!videoPreview" class="plus-icon-big">+</div>
                <video v-else :src="videoPreview" class="video-preview-full" controls playsinline />
              </label>
            </div>
          </section>

          <footer class="modal-actions">
            <button class="btn-cancel" @click="showModal = false">Cancelar</button>
            <button class="btn-pub" :disabled="uploading" @click="upload">
              {{ uploading ? 'Subiendo...' : 'Publicar' }}
            </button>
          </footer>
        </div>

        <div v-else class="success-screen">
          <DotLottieVue
            class="success-lottie"
            autoplay
            loop
            src="https://fonts.gstatic.com/s/e/notoemoji/latest/1f60a/lottie.json"
          />
          <h4 class="success-msg-text">¡Publicado con éxito!</h4>
        </div>

      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* =========================================
   1. BOTÓN DISPARADOR CON ANIMACIÓN 🔥
   ========================================= */
.main-upload-trigger {
  background: #111111;
  color: #ffffff;
  padding: 12px 24px;
  border-radius: 999px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  z-index: 1;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 4px 15px rgba(0,0,0,0.2);
  position: relative;
  overflow: hidden;
}
.main-upload-trigger:hover {
  transform: scale(1.05);
  background: #222222;
  box-shadow: 0 8px 25px rgba(0,0,0,0.4);
}
.main-upload-trigger:active { transform: scale(0.95); }
.main-upload-trigger::after {
  content: "";
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: linear-gradient(60deg, transparent, rgba(255,255,255,0.1), transparent);
  transform: rotate(45deg);
  animation: shine 4s infinite;
}
@keyframes shine {
  0% { left: -100%; }
  20% { left: 100%; }
  100% { left: 100%; }
}

/* =========================================
   2. MODAL (FIX iOS / Z-INDEX / BLUR)
   ========================================= */
.modal-overlay {
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483647 !important; /* 🔥 máximo */
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 20px;

  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);

  /* WebKit fixes */
  transform: translateZ(0);
  isolation: isolate;
  pointer-events: auto;
}

.modal-card {
  width: 100%;
  max-width: 420px;
  background: #ffffff;
  border-radius: 40px;
  padding: 2.2rem;

  box-shadow: 0 50px 100px rgba(0,0,0,0.5);
  margin: 0 auto;

  animation: popUp 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);

  /* siempre delante */
  position: relative;
  z-index: 2147483647;

  /* WebKit */
  transform: translateZ(0);
  will-change: transform;

  /* ✅ si el móvil es pequeño: scroll interno */
  max-height: min(86vh, 720px);
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}

@keyframes popUp {
  from { opacity: 0; transform: scale(0.92) translateY(40px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

/* =========================================
   3. CAMPOS (TEXTO NEGRO IPHONE)
   ========================================= */
.modal-header h3 {
  text-align: center;
  font-size: 1.6rem;
  font-weight: 900;
  margin-bottom: 20px;
  color: #000;
}

.input-modern, .textarea-modern {
  width: 100%;
  padding: 15px 18px;
  border-radius: 18px;
  border: 1px solid #f2f2f2;
  background: #f9f9f9;
  font-size: 1rem;
  color: #000000 !important;
  -webkit-text-fill-color: #000000;
  opacity: 1;
}

.textarea-modern {
  min-height: 90px;
  resize: none;
}

/* =========================================
   RESTO
   ========================================= */
.form-container { display: flex; flex-direction: column; gap: 16px; }
.form-group { display: flex; flex-direction: column; gap: 6px; }
.form-group label { font-size: 0.7rem; font-weight: 800; color: #888; text-transform: uppercase; }

.tags-flex { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.tag-pill { background: #f0f0f0; border: none; padding: 10px 15px; border-radius: 12px; font-weight: 700; font-size: 0.75rem; cursor: pointer; color: #333; }
.tag-pill.active { background: #111; color: #fff; }

.image-wide-dropzone {
  width: 100%;
  height: 110px;
  background: #fafafa;
  border: 2px dashed #eee;
  border-radius: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
}
.plus-icon-big{
  width: 54px;
  height: 54px;
  border-radius: 16px;
  display: grid;
  place-items: center;
  background: #111;
  color: #fff;
  font-weight: 900;
  font-size: 26px;
}
.image-preview-full { width: 100%; height: 100%; object-fit: cover; }
.video-preview-full {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 0;
}

.modal-actions { display: flex; gap: 12px; margin-top: 25px; }
.btn-cancel { flex: 1; background: #f5f5f5; border: none; padding: 15px; border-radius: 20px; font-weight: 700; color: #999; cursor: pointer; }
.btn-pub { flex: 2; background: #22c55e; border: none; padding: 15px; border-radius: 20px; font-weight: 800; color: white; cursor: pointer; }
.btn-pub:disabled { opacity: .65; cursor: not-allowed; }

/* =========================================
   SUCCESS
   ========================================= */
.success-screen{
  display:flex;
  flex-direction: column;
  align-items:center;
  justify-content:center;
  gap: 14px;
  padding: 10px 0;
}
.success-lottie{
  width: min(320px, 78vw);
  height: min(320px, 78vw);
}
.success-msg-text{
  font-weight: 900;
  font-size: 1.15rem;
}

/* =========================================
   ✅ ANTI-BUG GLOBAL (si #app tiene transform/filter)
   ========================================= */
:global(#app){
  transform: none !important;
  filter: none !important;
}
</style>
