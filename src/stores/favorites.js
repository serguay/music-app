import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase'

const FAVORITES_CHANGED_KEY = 'favorites_last_changed'

const markFavoritesChanged = () => {
  try {
    localStorage.setItem(FAVORITES_CHANGED_KEY, Date.now().toString())
    window.dispatchEvent(new CustomEvent('favorites-changed'))
  } catch (e) {}
}

export const useFavorites = defineStore('favorites', {
  state: () => ({
    ids: new Set(),
    userId: null,
    loading: false,
    _table: null,
    _col: null,
    version: 0,
    lastSync: 0
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
        this.version++
        this.lastSync = Date.now()
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
      this.version++

      try {
        await this._detectSchema(this.userId)

        const payload = {
          user_id: this.userId,
          [this._col]: id
        }

        // ✅ Prefer UPSERT to avoid 409 conflicts on duplicate likes
        let upsertErr = null
        try {
          const { error: uErr } = await supabase
            .from(this._table)
            .upsert(payload, { onConflict: `user_id,${this._col}` })
          upsertErr = uErr
        } catch (e) {
          upsertErr = e
        }

        // If upsert failed (e.g., table has no matching unique index), fallback to insert
        if (upsertErr) {
          const { error } = await supabase.from(this._table).insert(payload)
          if (error && String(error.code) !== '23505') throw error
        }

        markFavoritesChanged()
        this.lastSync = Date.now()
      } catch (e) {
        console.warn('⚠️ favorites.add error:', e)
        this.ids.delete(id)
        this.version++
      }
    },

    async remove(id) {
      if (!this.userId || !id) return

      this.ids.delete(id)
      this.version++

      try {
        await this._detectSchema(this.userId)

        const { error } = await supabase
          .from(this._table)
          .delete()
          .eq('user_id', this.userId)
          .eq(this._col, id)

        if (error) throw error

        markFavoritesChanged()
        this.lastSync = Date.now()
      } catch (e) {
        console.warn('⚠️ favorites.remove error:', e)
        this.ids.add(id)
        this.version++
      }
    },

    async toggle(id) {
      if (!this.userId || !id) return

      if (this.isFav(id)) {
        await this.remove(id)
      } else {
        await this.add(id)
      }

      // ✅ Force re-sync so other views (Profile) don't keep stale liked songs
      await this.init(this.userId, true)
      markFavoritesChanged()
    },

    hasChangedSince(timestamp) {
      try {
        const lastChanged = parseInt(localStorage.getItem(FAVORITES_CHANGED_KEY) || '0', 10)
        return lastChanged > timestamp
      } catch {
        return false
      }
    },

    reset() {
      this.ids = new Set()
      this.userId = null
      this.loading = false
      this._table = null
      this._col = null
      this.version = 0
      this.lastSync = 0
    }
  }
})