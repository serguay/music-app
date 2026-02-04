import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase'

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

// Backwards-compat: PlayerBar imports { usePlayer } from '../stores/player'
export { useFavorites as usePlayer }