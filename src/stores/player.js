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

  /* ======================
     PLAY SONG + CONTADOR
  ====================== */
  async function playSong(song) {
    const src = song.url || song.audio_url
    if (!src || !song?.id) return

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
      await supabase.from('listening_history').insert({
        song_id: song.id,
        user_id: userId.value
      })

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
  }

  function resumeSong() {
    if (!audio.value) return
    audio.value.play()
    isPlaying.value = true
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

    initUser,
    playSong,
    pauseSong,
    resumeSong,
    stopSong,
    onEnded
  }
})
