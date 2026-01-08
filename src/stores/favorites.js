import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase'

export const useFavorites = defineStore('favorites', {
  state: () => ({
    ids: new Set(),
    userId: null,
    loading: false
  }),

  actions: {
    async init(userId) {
      if (!userId || this.userId === userId) return

      this.userId = userId
      this.loading = true

      const { data, error } = await supabase
        .from('saved_audios')
        .select('audio_id')
        .eq('user_id', userId)

      if (!error && data) {
        this.ids = new Set(data.map(r => r.audio_id))
      }

      this.loading = false
    },

    isFav(id) {
      return this.ids.has(id)
    },

    async toggle(audioId) {
      if (!this.userId || this.loading) return

      // QUITAR
      if (this.ids.has(audioId)) {
        await supabase
          .from('saved_audios')
          .delete()
          .eq('user_id', this.userId)
          .eq('audio_id', audioId)

        this.ids.delete(audioId)
        return
      }

      // AÑADIR (UPSERT → NUNCA 409)
      const { error } = await supabase
        .from('saved_audios')
        .upsert(
          {
            user_id: this.userId,
            audio_id: audioId
          },
          {
            onConflict: 'user_id,audio_id',
            ignoreDuplicates: true
          }
        )

      if (!error) {
        this.ids.add(audioId)
      }
    },

    reset() {
      this.ids = new Set()
      this.userId = null
      this.loading = false
    }
  }
})
