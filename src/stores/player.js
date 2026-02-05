import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '../lib/supabase'

// =========================
// ⭐ Favorites Store
// =========================
export const useFavorites = defineStore('favorites', {
  state: () => ({
    ids: new Set(),
    userId: null,
    loading: false,
    saving: false,
    channel: null
  }),

  actions: {
    async init(userId) {
      if (!userId) return

      // si cambia de user, limpiamos estado y canal
      if (this.userId && this.userId !== userId) {
        this.ids = new Set()
        if (this.channel) {
          try {
            await supabase.removeChannel(this.channel)
          } catch (_) {}
          this.channel = null
        }
      }

      // ya inicializado
      if (this.userId === userId && this.channel) return

      this.userId = userId
      this.loading = true

      const { data, error } = await supabase
        .from('saved_audios')
        .select('audio_id')
        .eq('user_id', userId)

      if (!error && Array.isArray(data)) {
        this.ids = new Set(data.map((r) => r.audio_id))
      }

      this.loading = false

      // ✅ Realtime: mantiene todo sincronizado
      if (!this.channel) {
        this.channel = supabase
          .channel(`saved_audios:${userId}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'saved_audios',
              filter: `user_id=eq.${userId}`
            },
            (payload) => {
              const audioId = payload?.new?.audio_id || payload?.old?.audio_id
              if (!audioId) return

              if (payload.eventType === 'INSERT') {
                const next = new Set(this.ids)
                next.add(audioId)
                this.ids = next
              }

              if (payload.eventType === 'DELETE') {
                const next = new Set(this.ids)
                next.delete(audioId)
                this.ids = next
              }
            }
          )
          .subscribe()
      }
    },

    isFav(audioId) {
      if (!audioId) return false
      return this.ids.has(audioId)
    },

    async toggle(audioId) {
      if (!this.userId || !audioId) return
      if (this.saving) return
      this.saving = true

      const uid = this.userId
      const exists = this.ids.has(audioId)

      // ✅ optimistic
      {
        const next = new Set(this.ids)
        exists ? next.delete(audioId) : next.add(audioId)
        this.ids = next
      }

      try {
        if (!exists) {
          const { error } = await supabase
            .from('saved_audios')
            .insert({ user_id: uid, audio_id: audioId })

          // si ya existe por carrera (23505), lo ignoramos
          if (error && error.code !== '23505') throw error
        } else {
          const { error } = await supabase
            .from('saved_audios')
            .delete()
            .eq('user_id', uid)
            .eq('audio_id', audioId)

          if (error) throw error
        }
      } catch (e) {
        // rollback
        const rollback = new Set(this.ids)
        exists ? rollback.add(audioId) : rollback.delete(audioId)
        this.ids = rollback
        throw e
      } finally {
        this.saving = false
      }
    }
  }
})

// =========================
// ▶️ Player Store (REAL)
// =========================
export const usePlayer = defineStore('player', () => {
  const currentSong = ref(null)
  const isPlaying = ref(false)
  const queue = ref([])

  let audioEl = null
  const endedListeners = new Set()

  const ensureAudio = () => {
    if (audioEl) return audioEl
    audioEl = new Audio()
    audioEl.preload = 'metadata'

    audioEl.addEventListener('ended', () => {
      isPlaying.value = false
      endedListeners.forEach((fn) => {
        try {
          fn()
        } catch (e) {
          console.warn('[player] ended listener error:', e)
        }
      })
    })

    audioEl.addEventListener('play', () => {
      isPlaying.value = true
    })

    audioEl.addEventListener('pause', () => {
      isPlaying.value = false
    })

    audioEl.addEventListener('error', (e) => {
      console.warn('[player] audio error:', e)
      isPlaying.value = false
    })

    return audioEl
  }

  const getSongUrl = (song) => {
    if (!song) return null
    return (
      song.url ||
      song.audio_url ||
      song.audioUrl ||
      song.file_url ||
      song.song_url ||
      song.public_url ||
      song.storage_url ||
      null
    )
  }

  // Some components call this on boot
  const initUser = async () => {
    ensureAudio()
  }

  const setQueue = (list) => {
    queue.value = Array.isArray(list) ? list : []
  }

  const playSong = async (song) => {
    const el = ensureAudio()
    const url = getSongUrl(song)

    if (!url) {
      console.warn('[player] playSong called without a playable url:', song)
      return
    }

    // Toggle if same
    if (currentSong.value?.id && song?.id && currentSong.value.id === song.id) {
      if (isPlaying.value) {
        el.pause()
      } else {
        try {
          await el.play()
        } catch (e) {
          console.warn('[player] play() failed:', e)
        }
      }
      return
    }

    currentSong.value = song

    try {
      el.pause()
      el.currentTime = 0
      el.src = url
      await el.play()
      isPlaying.value = true
    } catch (e) {
      console.warn('[player] playSong failed:', e)
      isPlaying.value = false
    }
  }

  const stopSong = () => {
    const el = ensureAudio()
    try {
      el.pause()
      el.currentTime = 0
      el.src = ''
    } catch (_) {}

    isPlaying.value = false
    currentSong.value = null
  }

  const nextSong = async () => {
    if (!currentSong.value || !queue.value.length) return
    const idx = queue.value.findIndex((s) => s?.id === currentSong.value?.id)
    const next = idx >= 0 ? queue.value[(idx + 1) % queue.value.length] : queue.value[0]
    if (next) await playSong(next)
  }

  // Subscribe to ended; returns unsubscribe
  const onEnded = (fn) => {
    if (typeof fn !== 'function') return () => {}
    endedListeners.add(fn)
    return () => endedListeners.delete(fn)
  }

  return {
    currentSong,
    isPlaying,
    queue,
    initUser,
    setQueue,
    playSong,
    stopSong,
    nextSong,
    onEnded
  }
})

// ✅ Backwards-compat:
// If some old component imports `usePlayer` from this file, it now gets the real Player store.
// Favorites remains available as `useFavorites`.