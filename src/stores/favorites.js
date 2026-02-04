import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase'

export const useFavorites = defineStore('favorites', {
  state: () => ({
    ids: new Set(),
    userId: null,
    loading: false,
    version: 0,
    lastChangedAt: 0,
    channel: null
  }),

  actions: {
    // ✅ init SOLO establece user + carga + realtime (pero permite refresh aunque sea mismo user)
    async init(userId) {
      if (!userId) return
      const changedUser = this.userId !== userId

      this.userId = userId

      // si es otro user, limpiamos
      if (changedUser) {
        this.ids = new Set()
        this.version++
      }

      await this.refresh(true)
      this.startRealtime()
    },

    // ✅ refresh SIEMPRE puede recargar (aunque sea el mismo user)
    async refresh(force = false) {
      if (!this.userId) return
      if (this.loading && !force) return

      this.loading = true
      try {
        const { data, error } = await supabase
          .from('saved_audios')
          .select('audio_id')
          .eq('user_id', this.userId)

        if (error) throw error

        const newSet = new Set((data || []).map(r => r.audio_id).filter(Boolean))
        this.ids = newSet
        this.version++
        this.lastChangedAt = Date.now()
      } catch (e) {
        console.error('❌ favorites.refresh error:', e)
      } finally {
        this.loading = false
      }
    },

    isFav(audioId) {
      return !!audioId && this.ids.has(audioId)
    },

    hasChangedSince(ts) {
      return (this.lastChangedAt || 0) > (ts || 0)
    },

    // ✅ Toggle robusto: borra si existe, si no existe hace UPSERT (sin 409)
    async toggle(audioId) {
      if (!this.userId || !audioId) return

      const already = this.ids.has(audioId)

      // ✅ optimistic UI
      if (already) this.ids.delete(audioId)
      else this.ids.add(audioId)
      this.version++
      this.lastChangedAt = Date.now()
      window.dispatchEvent(new CustomEvent('favorites-changed'))

      try {
        if (already) {
          const { error } = await supabase
            .from('saved_audios')
            .delete()
            .eq('user_id', this.userId)
            .eq('audio_id', audioId)

          if (error) throw error
        } else {
          // ✅ upsert evita el 409 por duplicate unique
          const { error } = await supabase
            .from('saved_audios')
            .upsert(
              { user_id: this.userId, audio_id: audioId },
              { onConflict: 'user_id,audio_id' }
            )

          // si aun así llega 23505, lo ignoramos
          if (error && String(error.code) !== '23505') throw error
        }
      } catch (e) {
        console.error('❌ favorites.toggle error:', e)

        // rollback si falla
        if (already) this.ids.add(audioId)
        else this.ids.delete(audioId)

        this.version++
        this.lastChangedAt = Date.now()
        window.dispatchEvent(new CustomEvent('favorites-changed'))
      }
    },

    startRealtime() {
      this.stopRealtime()
      if (!this.userId) return

      this.channel = supabase
        .channel(`favorites-${this.userId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'saved_audios',
            filter: `user_id=eq.${this.userId}`
          },
          async () => {
            // ✅ cuando llega insert/delete desde cualquier sitio, recargamos set
            await this.refresh(true)
            window.dispatchEvent(new CustomEvent('favorites-changed'))
          }
        )
        .subscribe()
    },

    stopRealtime() {
      if (this.channel) {
        supabase.removeChannel(this.channel)
        this.channel = null
      }
    }
  }
})