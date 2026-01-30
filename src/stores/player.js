import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '../lib/supabase'

export const usePlayer = defineStore('player', () => {
  const audio = ref(null)
  const currentSong = ref(null)
  const isPlaying = ref(false)
  const userId = ref(null)

  // ⏱️ TIEMPOS (NUEVO)
  const currentTime = ref(0)
  const duration = ref(0)

  // 🔁 callback externo (Home.vue)
  const endedCallback = ref(null)

  // 🎼 Cola actual (Home debe inyectarla con setQueue)
  const queue = ref([])

  function setQueue(list) {
    queue.value = Array.isArray(list) ? list : []
  }

  // evita bucles si endedCallback llama a nextSong()
  let isAdvancing = false

  /* ======================
     USER
  ====================== */
  async function initUser() {
    const { data } = await supabase.auth.getUser()
    userId.value = data?.user?.id || null
  }

  /* ======================
     AUTOPLAY
  ====================== */
  function onEnded(cb) {
    endedCallback.value = cb
  }
  // ⏭️ NEXT: intenta avanzar usando la cola; si no hay cola, usa endedCallback (guardado)
  async function nextSong() {
    if (isAdvancing) return
    isAdvancing = true

    try {
      const list = queue.value || []

      // 1) Si hay cola, avanzamos por ahí
      if (Array.isArray(list) && list.length) {
        const cur = currentSong.value

        if (!cur?.id) {
          await playSong(list[0])
          return
        }

        const idx = list.findIndex((s) => s?.id === cur.id)
        const next = idx === -1 ? list[0] : list[(idx + 1) % list.length]
        if (next) {
          await playSong(next)
          return
        }
      }

      // 2) Fallback: si Home maneja "siguiente" con endedCallback
      if (endedCallback.value) {
        const res = endedCallback.value()
        // si el callback devuelve promesa, la esperamos
        if (res && typeof res.then === 'function') {
          await res
        }
      }
    } finally {
      isAdvancing = false
    }
  }

  /* ======================
     PLAY SONG + CONTADOR
  ====================== */
  async function playSong(song) {
    const src = song.url || song.audio_url
    if (!src || !song?.id) return

    // ✅ asegúrate de tener userId (por si initUser no se llamó todavía)
    if (!userId.value) {
      await initUser()
    }

    if (!audio.value) {
      audio.value = new Audio()
    }

    audio.value.pause()
    audio.value.currentTime = 0
    audio.value.src = src
    audio.value.load()

    currentSong.value = song
    currentTime.value = 0
    duration.value = 0

    // ⏱️ tiempo en tiempo real
    audio.value.ontimeupdate = () => {
      currentTime.value = audio.value.currentTime
    }

    // ⏱️ duración real
    audio.value.onloadedmetadata = () => {
      duration.value = audio.value.duration
    }

    audio.value.onended = () => {
      isPlaying.value = false
      if (endedCallback.value) {
        endedCallback.value()
      }
    }

    try {
      await audio.value.play()
      isPlaying.value = true

      // 🔥 CONTADOR DE REPRODUCCIÓN (1 por usuario)
      if (userId.value) {
        await supabase.from('listening_history').insert({
          song_id: song.id,
          user_id: userId.value
        })
      }

    } catch (e) {
      console.error('Error al reproducir:', e)
    }
  }

  /* ======================
     CONTROLS
  ====================== */
  function pauseSong() {
    if (!audio.value) return
    audio.value.pause()
    isPlaying.value = false
    // ✅ NO tocar currentSong aquí: al pausar debe seguir siendo la misma canción
  }

  function resumeSong() {
    // ✅ Si hay audio, reanuda
    if (audio.value) {
      audio.value.play()
      isPlaying.value = true
      return
    }

    // ✅ Si por lo que sea se perdió el objeto Audio, volvemos a cargar la canción actual
    if (currentSong.value) {
      playSong(currentSong.value)
    }
  }

  function stopSong() {
    if (!audio.value) return
    audio.value.pause()
    audio.value.currentTime = 0
    currentSong.value = null
    currentTime.value = 0
    duration.value = 0
    isPlaying.value = false
  }

  return {
    audio,
    currentSong,
    isPlaying,

    // ⏱️ exportamos tiempos
    currentTime,
    duration,
    queue,
    setQueue,

    initUser,
    playSong,
    pauseSong,
    resumeSong,
    stopSong,
    onEnded,
    nextSong
  }
})
