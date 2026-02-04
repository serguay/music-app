// src/stores/favorites.js
import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase'

export const useFavorites = defineStore('favorites', {
  state: () => ({
    ids: new Set(),
    userId: null,
    loading: false
  }),

  actions: {
    async init(userId, force = false) {
      if (!userId) return
      if (!force && this.userId === userId && this.ids?.size) return

      this.userId = userId
      this.loading = true

      const { data, error } = await supabase
        .from('favorites')
        .select('song_id')
        .eq('user_id', userId)

      if (!error && data) {
        this.ids = new Set((data || []).map(r => r.song_id).filter(Boolean))
      } else {
        this.ids = new Set()
        if (error) console.warn('⚠️ favorites.init error:', error)
      }

      this.loading = false
    },

    isFav(songId) {
      if (!songId) return false
      return this.ids.has(songId)
    },

    async refresh() {
      if (!this.userId) return
      await this.init(this.userId, true)
    },

    async add(songId) {
      if (!this.userId || !songId) return

      // optimista
      this.ids.add(songId)

      const { error } = await supabase
        .from('favorites')
        .insert({ user_id: this.userId, song_id: songId })

      // si ya existía (23505), ok. Si otro error, rollback.
      if (error && String(error.code) !== '23505') {
        console.warn('⚠️ favorites.add error:', error)
        this.ids.delete(songId)
      }
    },

    async remove(songId) {
      if (!this.userId || !songId) return

      // optimista
      this.ids.delete(songId)

      const { error } = await supabase
        .from('favorites')
        .delete()
        .eq('user_id', this.userId)
        .eq('song_id', songId)

      if (error) {
        console.warn('⚠️ favorites.remove error:', error)
        // rollback
        this.ids.add(songId)
      }
    },

    async toggle(songId) {
      if (!this.userId || !songId) return

      if (this.isFav(songId)) {
        await this.remove(songId)
      } else {
        await this.add(songId)
      }
    },

    reset() {
      this.ids = new Set()
      this.userId = null
      this.loading = false
    }
  }
})