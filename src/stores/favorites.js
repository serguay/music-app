import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase'

export const useFavorites = defineStore('favorites', {
  state: () => ({
    // usamos objeto reactivo (Set NO es reactivo del todo en Pinia)
    idsMap: {},
    userId: null,
    loading: false,
    saving: false,
    version: 0, // para que los componentes puedan reaccionar fácil
    _initPromise: null,
    _channel: null
  }),

  actions: {
    _setIdsFromRows(rows) {
      const map = {}
      for (const r of rows || []) {
        if (r?.audio_id) map[r.audio_id] = true
      }
      this.idsMap = map
      this.version++
    },

    isFav(audioId) {
      if (!audioId) return false
      return !!this.idsMap[audioId]
    },

    async init(userId, { force = false } = {}) {
      if (!userId) return
      if (!force && this.userId === userId && this._initPromise) return this._initPromise
      if (!force && this.userId === userId && Object.keys(this.idsMap || {}).length) return

      this.userId = userId
      this.loading = true

      // si ya hay init en curso, reutilizamos
      if (this._initPromise && !force) return this._initPromise

      this._initPromise = (async () => {
        const { data, error } = await supabase
          .from('saved_audios')
          .select('audio_id')
          .eq('user_id', userId)

        if (!error) this._setIdsFromRows(data)
        this.loading = false

        // 🔴 Realtime (solo 1 canal)
        this._setupRealtime()
      })().finally(() => {
        this._initPromise = null
        this.loading = false
      })

      return this._initPromise
    },

    _setupRealtime() {
      if (!this.userId) return

      // evitar duplicar canal
      if (this._channel) return

      this._channel = supabase
        .channel(`favorites_${this.userId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'saved_audios', filter: `user_id=eq.${this.userId}` },
          (payload) => {
            const row = payload?.new || payload?.old
            const audioId = row?.audio_id
            if (!audioId) return

            if (payload.eventType === 'INSERT') {
              this.idsMap = { ...this.idsMap, [audioId]: true }
              this.version++
            }

            if (payload.eventType === 'DELETE') {
              const next = { ...(this.idsMap || {}) }
              delete next[audioId]
              this.idsMap = next
              this.version++
            }
          }
        )
        .subscribe()
    },

    async refresh() {
      if (!this.userId) return
      return this.init(this.userId, { force: true })
    },

    async add(audioId) {
      if (!this.userId || !audioId) return

      // UPsert con ignoreDuplicates => no peta con unique constraint
      const { error } = await supabase
        .from('saved_audios')
        .upsert(
          { user_id: this.userId, audio_id: audioId },
          { onConflict: 'user_id,audio_id', ignoreDuplicates: true }
        )

      // aunque ignoreDuplicates, si existía, lo dejamos true igualmente
      if (!error) {
        this.idsMap = { ...this.idsMap, [audioId]: true }
        this.version++
        return
      }

      // fallback si el cliente no soporta ignoreDuplicates bien
      if (error?.code === '23505') {
        this.idsMap = { ...this.idsMap, [audioId]: true }
        this.version++
        return
      }

      throw error
    },

    async remove(audioId) {
      if (!this.userId || !audioId) return

      const { error } = await supabase
        .from('saved_audios')
        .delete()
        .match({ user_id: this.userId, audio_id: audioId })

      if (!error) {
        const next = { ...(this.idsMap || {}) }
        delete next[audioId]
        this.idsMap = next
        this.version++
        return
      }

      throw error
    },

    async toggle(audioId) {
      if (!this.userId || !audioId) return

      // lock para evitar spam doble click
      if (this.saving) return
      this.saving = true

      try {
        if (this.isFav(audioId)) {
          await this.remove(audioId)
        } else {
          await this.add(audioId)
        }
      } finally {
        this.saving = false
      }
    },

    // por si quieres limpiar al logout
    reset() {
      this.idsMap = {}
      this.userId = null
      this.version++
      this.loading = false
      this.saving = false
      this._initPromise = null
      if (this._channel) {
        try { supabase.removeChannel(this._channel) } catch {}
      }
      this._channel = null
    }
  }
})