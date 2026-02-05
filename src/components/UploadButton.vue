<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import { supabase } from '../lib/supabase'
import checkImg from '../assets/check.png'

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

/* --- ✅ FT (usuario invitado) — opcional (debe existir en profiles) --- */
const featQuery = ref('')
const featOptions = ref([])
const featLoading = ref(false)
const selectedFeatUser = ref(null) // { id, username }
let featDebounce = null

const resetFeat = () => {
  featQuery.value = ''
  featOptions.value = []
  featLoading.value = false
  selectedFeatUser.value = null
}

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
  else {
    unlockBodyScroll()
    resetFeat()
  }
})

/* --- ✅ Buscar usuarios para FT (debounce) --- */
watch(featQuery, (q) => {
  // si ya hay uno seleccionado y el user borra/edita, deseleccionamos
  if (selectedFeatUser.value && q !== (selectedFeatUser.value.username || '')) {
    selectedFeatUser.value = null
  }

  clearTimeout(featDebounce)
  featDebounce = setTimeout(async () => {
    const query = (q || '').trim()
    if (query.length < 2) {
      featOptions.value = []
      return
    }

    featLoading.value = true
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username')
      .ilike('username', `%${query}%`)
      .order('created_at', { ascending: false })
      .limit(8)

    featLoading.value = false
    if (error) {
      featOptions.value = []
      return
    }

    featOptions.value = (data || [])
      .filter(u => (u?.username || '').trim().length)
      .map(u => ({ id: u.id, username: u.username }))
  }, 250)
})

onBeforeUnmount(() => {
  unlockBodyScroll()
  if (imagePreview.value) URL.revokeObjectURL(imagePreview.value)
  if (videoPreview.value) URL.revokeObjectURL(videoPreview.value)
  if (featDebounce) clearTimeout(featDebounce)
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
  if (!img || !['image/png', 'image/jpeg'].includes(img.type)) {
    alert('La imagen debe ser PNG o JPG')
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

/* --- ✅ helpers FT --- */
const selectFeatUser = (u) => {
  selectedFeatUser.value = u
  featQuery.value = u?.username || ''
  featOptions.value = []
}

const clearFeatUser = () => {
  selectedFeatUser.value = null
  featQuery.value = ''
  featOptions.value = []
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

  // ✅ Evita duplicados tanto en publicados como en pendientes
  const [{ data: existingAudios }, { data: existingSubs }] = await Promise.all([
    supabase.from('audios').select('id').eq('audio_hash', audioHash).limit(1),
    supabase.from('audio_submissions').select('id').eq('audio_hash', audioHash).limit(1)
  ])

  const alreadyExists =
    (Array.isArray(existingAudios) && existingAudios.length > 0) ||
    (Array.isArray(existingSubs) && existingSubs.length > 0)

  if (alreadyExists) {
    alert('❌ Este audio ya existe (publicado o pendiente de revisión)')
    uploading.value = false
    return
  }

  const cleanName = title.value
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9.-]/g, '')

  // --- Upload audio ---
  const audioExt = (file.value.name.split('.').pop() || 'mp3').toLowerCase()
  const audioPath = `${user.id}/${Date.now()}-${cleanName}.${audioExt}`

  const { error: audioUpErr } = await supabase.storage
    .from('music-bucket')
    .upload(audioPath, file.value, { contentType: file.value.type, upsert: true })

  if (audioUpErr) {
    uploading.value = false
    alert('Error subiendo audio')
    return
  }

  const { data: audioData } = supabase.storage.from('music-bucket').getPublicUrl(audioPath)
  const audioPublicUrl = audioData?.publicUrl || null

  // --- Upload cover image ---
  const imgExt = (imageFile.value.name.split('.').pop() || 'png').toLowerCase()
  const imgPath = `${user.id}/${Date.now()}-${cleanName}.${imgExt}`

  const { error: imgUpErr } = await supabase.storage
    .from('audio-images')
    .upload(imgPath, imageFile.value, { contentType: imageFile.value.type, upsert: true })

  if (imgUpErr) {
    uploading.value = false
    alert('Error subiendo imagen')
    return
  }

  const { data: imgData } = supabase.storage.from('audio-images').getPublicUrl(imgPath)
  const imgPublicUrl = imgData?.publicUrl || null

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

  const payload = {
    user_id: user.id,
    title: title.value,
    artist: 'Tú',
    audio_url: audioPublicUrl,

    // columnas nuevas
    note: description.value || null,
    image_url: imgPublicUrl,
    // ✅ tu tabla `audios` usa `genre` (texto) y NO `genres` (array)
    genre: selectedTag.value || null,
    audio_hash: audioHash,

    // opcional
    video_url: videoPublicUrl,

    ...(selectedFeatUser.value?.id
      ? {
          feat_user_id: selectedFeatUser.value.id,
          feat_username: selectedFeatUser.value.username
        }
      : {})
  }

  // ✅ En vez de publicar directo, lo mandamos a revisión (admin)
  const { error: dbError } = await supabase
    .from('audio_submissions')
    .insert({
      ...payload,
      status: 'pending'
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

      resetFeat()

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
    <span class="main-upload-trigger__label">+ Subir audio</span>
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

            <!-- ✅ FEAT (FT) -->
            <div class="form-group">
              <label>Feat (opcional · usuario de la app)</label>

              <div class="feat-wrap">
                <input
                  v-model="featQuery"
                  type="text"
                  class="input-modern"
                  placeholder="Escribe el nombre de usuario (mín 2 letras)…"
                  autocomplete="off"
                />

                <button
                  v-if="selectedFeatUser"
                  type="button"
                  class="feat-clear"
                  @click="clearFeatUser"
                  title="Quitar feat"
                >
                  ✕
                </button>

                <div v-if="featLoading" class="feat-hint">Buscando…</div>

                <div
                  v-else-if="featQuery && featQuery.trim().length >= 2 && !selectedFeatUser && featOptions.length === 0"
                  class="feat-hint"
                >
                  No existe ese usuario
                </div>

                <div v-if="!selectedFeatUser && featOptions.length" class="feat-list">
                  <button
                    v-for="u in featOptions"
                    :key="u.id"
                    type="button"
                    class="feat-item"
                    @click="selectFeatUser(u)"
                  >
                    @{{ u.username }}
                  </button>
                </div>

                <div v-if="selectedFeatUser" class="feat-selected">
                  ✅ FT: <strong>@{{ selectedFeatUser.username }}</strong>
                </div>
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
          <img
            :src="checkImg"
            alt="Subida correcta"
            class="success-check"
            draggable="false"
          />
          <h4 class="success-msg-text">✅ En ~5 minutos revisamos tu audio. Si está OK, se publicará.</h4>
        </div>

      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Upload button (igual que los otros botones claros) */
.main-upload-trigger{
  display:inline-flex;
  align-items:center;
  justify-content:center;

  padding:14px 22px;
  border-radius:999px;
  border:1px solid rgba(255,255,255,0.55);

  background:rgba(255,255,255,0.82);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);

  cursor:pointer;
  position:relative;
  overflow:hidden;
  isolation:isolate;

  box-shadow:
    0 10px 26px rgba(0,0,0,0.12),
    inset 0 1px 0 rgba(255,255,255,0.85);

  transition: transform .18s ease, box-shadow .18s ease, background .18s ease;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
}

.main-upload-trigger:hover{
  transform: translateY(-3px);
  background: rgba(255,255,255,0.92);
  box-shadow:
    0 16px 40px rgba(0,0,0,0.16),
    inset 0 1px 0 rgba(255,255,255,0.92);
}

.main-upload-trigger:active{
  transform: translateY(1px) scale(0.98);
}

/* Gradiente SOLO dentro del botón */
.main-upload-trigger::after{
  content:"";
  position:absolute;
  inset:-1px;
  border-radius:inherit;
  pointer-events:none;
  z-index:1;

  opacity:0;
  background: linear-gradient(96deg,
    rgba(242,203,254,1),
    rgba(87,195,249,1),
    rgba(63,252,106,1)
  );
  background-size: 200% 200%;
  transition: opacity .18s ease;
}

.main-upload-trigger:hover::after{
  opacity:.65;
  animation: btnGradientSlide 1.4s ease-in-out infinite;
}

/* Texto SIEMPRE legible */
.main-upload-trigger__label{
  position: relative;
  z-index: 2;

  /* texto limpio (sin “pill” blanco dentro) */
  color: rgba(0,0,0,0.88);
  font-weight: 900;
  font-size: .92rem;
  letter-spacing: .2px;
  line-height: 1;

  /* un pelín de contraste para que se lea con el gradiente */
  text-shadow: 0 1px 0 rgba(255,255,255,0.55);
}

@keyframes btnGradientSlide{
  0%{ background-position: 0% 50%; }
  50%{ background-position: 100% 50%; }
  100%{ background-position: 0% 50%; }
}

/* Dark mode */
:global(.p-dark) .main-upload-trigger{
  background: rgba(30,30,34,0.65);
  border-color: rgba(255,255,255,0.16);
}
:global(.p-dark) .main-upload-trigger__label{
  color: rgba(255,255,255,0.92);
  text-shadow: 0 1px 0 rgba(0,0,0,0.35);
}
:global(.p-dark) .main-upload-trigger:hover{
  background: rgba(30,30,34,0.78);
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

/* =========================================
   ✅ MODAL SCROLL (hide scrollbar but keep scroll)
   ========================================= */
.modal-card {
  scrollbar-width: none;          /* Firefox */
  -ms-overflow-style: none;       /* old Edge/IE */
}

.modal-card::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.modal-card::-webkit-scrollbar-thumb {
  background: transparent;
}

.modal-card::-webkit-scrollbar-track {
  background: transparent;
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

/* =========================================
   ✅ FEAT (FT) selector
   ========================================= */
.feat-wrap{
  position: relative;
  width: 100%;
}

.feat-clear{
  position: absolute;
  top: 50%;
  right: 12px;
  transform: translateY(-50%);
  width: 34px;
  height: 34px;
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,0.08);
  background: rgba(0,0,0,0.55);
  color: #fff;
  cursor: pointer;
  display: grid;
  place-items: center;
}

.feat-hint{
  margin-top: 8px;
  font-size: 0.85rem;
  font-weight: 700;
  opacity: 0.7;
  text-align: center;
}

.feat-list{
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 170px;
  overflow: auto;
  border-radius: 16px;
  padding: 10px;
  background: #f6f6f7;
  border: 1px solid #ededee;
}

.feat-item{
  text-align: left;
  padding: 10px 12px;
  border-radius: 14px;
  border: none;
  cursor: pointer;
  font-weight: 800;
  background: #fff;
  box-shadow: 0 6px 16px rgba(0,0,0,0.06);
}

.feat-item:active{
  transform: scale(0.99);
}

.feat-selected{
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 16px;
  background: rgba(34,197,94,0.10);
  border: 1px solid rgba(34,197,94,0.22);
  font-weight: 800;
  text-align: center;
}

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
.success-check{
  width: min(320px, 78vw);
  height: auto;
  display: block;
  user-select: none;
  -webkit-user-drag: none;
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