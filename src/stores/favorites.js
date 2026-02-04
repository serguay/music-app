import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase'

// Store de favoritos compatible con distintos esquemas:
// - tabla `favorites` con columna `song_id`
// - tabla `favorites` con columna `audio_id`
// - tabla `saved_audios` con columna `audio_id`
// - tabla `saved_audios` con columna `song_id`
// Detecta automáticamente cuál existe y usa esa.

export const useFavorites = defineStore('favorites', {
  state: () => ({
    ids: new Set(),
    userId: null,
    loading: false,

    _table: null, // 'favorites' | 'saved_audios'
    _col: null // 'song_id' | 'audio_id'
  }),

  actions: {
    async _detectSchema(userId) {
      if (this._table && this._col) return

      const candidates = [
        { table: 'favorites', col: 'song_id' },
        { table: 'favorites', col: 'audio_id' },
        { table: 'saved_audios', col: 'audio_id' },
        { table: 'saved_audios', col: 'song_id' }
      ]

      for (const c of candidates) {
        const { error } = await supabase
          .from(c.table)
          .select(c.col)
          .eq('user_id', userId)
          .limit(1)

        if (!error) {
          this._table = c.table
          this._col = c.col
          return
        }
      }

      // fallback (si algo raro pasa)
      this._table = 'saved_audios'
      this._col = 'audio_id'
    },

    async init(userId, force = false) {
      if (!userId) return

      if (this.userId && this.userId !== userId) {
        this.ids = new Set()
        this._table = null
        this._col = null
      }

      if (!force && this.userId === userId && this.ids && this.ids.size) return

      this.userId = userId
      this.loading = true

      try {
        await this._detectSchema(userId)

        const { data, error } = await supabase
          .from(this._table)
          .select(this._col)
          .eq('user_id', userId)

        if (error) throw error

        const list = (data || [])
          .map((r) => r?.[this._col])
          .filter(Boolean)

        this.ids = new Set(list)
      } catch (e) {
        console.warn('⚠️ favorites.init error:', e)
        this.ids = new Set()
      } finally {
        this.loading = false
      }
    },

    isFav(id) {
      if (!id) return false
      return this.ids.has(id)
    },

    async refresh() {
      if (!this.userId) return
      await this.init(this.userId, true)
    },

    async add(id) {
      if (!this.userId || !id) return

      this.ids.add(id)

      try {
        await this._detectSchema(this.userId)

        const payload = {
          user_id: this.userId,
          [this._col]: id
        }

        const { error } = await supabase.from(this._table).insert(payload)

        // 23505 = ya existe (ok)
        if (error && String(error.code) !== '23505') throw error
      } catch (e) {
        console.warn('⚠️ favorites.add error:', e)
        this.ids.delete(id)
      }
    },

    async remove(id) {
      if (!this.userId || !id) return

      this.ids.delete(id)

      try {
        await this._detectSchema(this.userId)

        const { error } = await supabase
          .from(this._table)
          .delete()
          .eq('user_id', this.userId)
          .eq(this._col, id)

        if (error) throw error
      } catch (e) {
        console.warn('⚠️ favorites.remove error:', e)
        this.ids.add(id)
      }
    },

    async toggle(id) {
      if (!this.userId || !id) return
      if (this.isFav(id)) return this.remove(id)
      return this.add(id)
    },

    reset() {
      this.ids = new Set()
      this.userId = null
      this.loading = false
      this._table = null
      this._col = null
    }
  }
})