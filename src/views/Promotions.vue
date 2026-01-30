<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { supabase } from '../lib/supabase'

const router = useRouter()
const route = useRoute()

const userId = ref(null)
const audios = ref([])
const selectedAudioId = ref(null)
const loading = ref(false)
const paying = ref(false)

const plans = ref([
  { id: 'basic', label: 'Básico', price: 1, desc: 'Duración 1 mes (sube un poco tu audio)' },
  { id: 'pro', label: 'Pro', price: 3, desc: 'Duración 1 mes (más visibilidad en Home)' },
  { id: 'max', label: 'Máximo', price: 5, desc: 'Duración 1 mes (top prioridad 🔥)' },
])

const selectedPlan = ref('basic')

const selectedAudio = computed(() =>
  audios.value.find(a => a.id === selectedAudioId.value) || null
)

// ✅ Saber si un audio tiene promo ACTIVA ahora mismo
const isAudioPromoted = (audio) => {
  if (!audio?.promoted_until) return false
  return new Date(audio.promoted_until).getTime() > Date.now()
}

// ✅ Lista filtrada: solo audios NO promocionados (para que no se pueda pagar 2 veces)
const availableAudios = computed(() => {
  return audios.value.filter(a => !isAudioPromoted(a))
})

const isSelectedAudioPromoted = computed(() => isAudioPromoted(selectedAudio.value))

const formatDate = (d) => {
  try {
    return new Date(d).toLocaleDateString()
  } catch {
    return ''
  }
}

const loadMyAudios = async () => {
  if (!userId.value) return
  loading.value = true

  // 1) Traer audios del usuario (legacy fields incluidos)
  const { data: audioRows, error: audioErr } = await supabase
    .from('audios')
    .select('id, title, created_at, promoted_until, promoted_plan')
    .eq('user_id', userId.value)
    .order('created_at', { ascending: false })

  if (audioErr) {
    console.error('❌ Error cargando audios:', audioErr)
    audios.value = []
    loading.value = false
    return
  }

  const nowIso = new Date().toISOString()

  // 2) Traer promociones activas (nuevo sistema) que NO han caducado
  const { data: promoRows, error: promoErr } = await supabase
    .from('promotions')
    .select('audio_id, expires_at, ends_at, plan, status')
    .eq('user_id', userId.value)
    .eq('status', 'active')
    .or(`expires_at.gt.${nowIso},ends_at.gt.${nowIso}`)

  if (promoErr) {
    console.log('⚠️ promotions select error:', promoErr)
  }

  const promoMap = new Map(
    (promoRows || [])
      .filter(p => p?.audio_id)
      .map(p => [p.audio_id, p])
  )

  // 3) Mezclar: si hay promo activa -> usamos expires_at (o ends_at)
  //    si no -> mantenemos legacy `audios.promoted_until` para no romper promos antiguas
  audios.value = (audioRows || []).map(a => {
    const promo = promoMap.get(a.id)
    const promoUntil = promo?.expires_at || promo?.ends_at || a.promoted_until || null
    const promoPlan = promo?.plan || a.promoted_plan || null

    return {
      ...a,
      promoted_until: promoUntil,
      promoted_plan: promoPlan,
    }
  })

  // ✅ Si el audio seleccionado se acaba de promocionar, lo quitamos de la selección
  if (selectedAudioId.value) {
    const sel = audios.value.find(a => a.id === selectedAudioId.value)
    if (sel && isAudioPromoted(sel)) selectedAudioId.value = null
  }

  loading.value = false
}

onMounted(async () => {
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    router.push('/')
    return
  }

  userId.value = session.user.id
  await loadMyAudios()

  // ✅ Mensajes tras volver de Stripe
  const promoParam = route.query.promo
  if (promoParam === 'success') {
    alert('✅ Pago completado. Tu promoción se activará en unos segundos.')
    // recargar por si ya está marcado en DB
    await loadMyAudios()
    // limpiar query
    router.replace({ query: {} })
  }
  if (promoParam === 'cancel') {
    alert('❌ Pago cancelado.')
    router.replace({ query: {} })
  }
})

const payPromotion = async () => {
  if (!selectedAudioId.value) {
    alert('❌ Selecciona un audio primero')
    return
  }

  if (isSelectedAudioPromoted.value) {
    alert(`🔥 Este audio ya está promocionado hasta ${formatDate(selectedAudio.value.promoted_until)}.`)
    return
  }

  paying.value = true

  try {
    // ✅ 1) Asegurar sesión activa
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()

    if (sessionError || !session) {
      console.error('❌ Sin sesión:', sessionError)
      alert('❌ Sesión expirada. Vuelve a iniciar sesión.')
      await supabase.auth.signOut()
      router.push('/')
      return
    }

    // ✅ 2) Refrescar token SIEMPRE antes de llamar a la Edge Function
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession()

    if (refreshError || !refreshed?.session?.access_token) {
      console.error('❌ No se pudo refrescar la sesión:', refreshError)
      alert('❌ Sesión expirada. Vuelve a iniciar sesión.')
      await supabase.auth.signOut()
      router.push('/')
      return
    }

    const token = refreshed.session.access_token

    console.log('✅ Sesión refrescada, user:', refreshed.session.user.id)
    console.log('📤 Llamando a Edge Function: create-checkout')

    // ✅ 3) Llamar Edge Function con token fresco + apikey
    const { data, error } = await supabase.functions.invoke('create-checkout', {
      body: {
        audio_id: selectedAudioId.value,
        plan: selectedPlan.value,
      },
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
    })

    // ✅ 4) Manejar error
    if (error) {
      console.error('❌ Error en create-checkout:', error)

      if (error?.status === 401) {
        alert('❌ Error de autenticación. Cierra sesión y vuelve a iniciar.')
        await supabase.auth.signOut()
        router.push('/')
      } else {
        alert(`❌ Error: ${error?.message || 'Error desconocido'}`)
      }
      return
    }

    console.log('✅ Respuesta:', data)

    // ✅ 5) Redirigir a Stripe
    if (!data?.url) {
      alert('❌ No se generó el link de pago')
      return
    }

    console.log('🔗 Redirigiendo a Stripe:', data.url)
    window.location.href = data.url
  } catch (e) {
    console.error('❌ Error inesperado:', e)
    alert('Error inesperado')
  } finally {
    paying.value = false
  }
}
</script>

<template>
  <section class="promo-page">
    <header class="promo-header">
      <button class="back" @click="router.back()">←</button>

      <div>
        <h1>💸 Promociones</h1>
        <p>Promociona un audio para que aparezca más arriba en la app 🔥</p>
      </div>
    </header>

    <div class="card">
      <h2>1) Elige tu audio</h2>

      <div v-if="loading" class="muted">Cargando tus audios…</div>
      <div v-else-if="!audios.length" class="muted">No tienes audios todavía.</div>
      <div v-else-if="!availableAudios.length" class="muted">✅ Ya tienes todos tus audios con promoción activa.</div>

      <div v-else class="audio-list">
        <button
          v-for="a in availableAudios"
          :key="a.id"
          class="audio-item"
          :class="{ selected: a.id === selectedAudioId }"
          @click="selectedAudioId = a.id"
        >
          <span class="title">🎵 {{ a.title || 'Audio sin título' }}</span>
          <span class="small">{{ new Date(a.created_at).toLocaleDateString() }}</span>
        </button>
      </div>
    </div>

    <div class="card" style="margin-top: 12px">
      <h2>2) Elige plan</h2>

      <div class="plans">
        <label
          v-for="p in plans"
          :key="p.id"
          class="plan"
          :class="{ active: selectedPlan === p.id }"
        >
          <input type="radio" name="plan" :value="p.id" v-model="selectedPlan" />

          <div class="plan-info">
            <div class="plan-top">
              <strong>{{ p.label }}</strong>
              <span class="price">{{ p.price }}€</span>
            </div>

            <div class="muted">{{ p.desc }}</div>
          </div>
        </label>
      </div>

      <div v-if="selectedAudio" class="summary">
        <div class="muted">Vas a promocionar:</div>
        <div class="summary-title">🎧 {{ selectedAudio.title || 'Audio sin título' }}</div>
      </div>

      <div v-if="selectedAudio && isSelectedAudioPromoted" class="promo-status">
        🔥 Este audio está promocionado hasta <strong>{{ formatDate(selectedAudio.promoted_until) }}</strong>
      </div>

      <button class="pay" :disabled="!selectedAudioId || paying || isSelectedAudioPromoted" @click="payPromotion">
        {{ paying ? 'Procesando…' : 'Pagar promoción' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.promo-page {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: 18px 14px 110px;
}

.promo-header {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 12px;
}

.back {
  border: none;
  background: transparent;
  font-size: 18px;
  cursor: pointer;
}

.card {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 14px;
}

.audio-list {
  display: grid;
  gap: 10px;
  margin-top: 12px;
}

.audio-item {
  width: 100%;
  text-align: left;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.2);
  cursor: pointer;
}

.audio-item.selected {
  outline: 2px solid rgba(255, 255, 255, 0.25);
}

.title {
  display: block;
  font-weight: 700;
}

.small {
  font-size: 12px;
  opacity: 0.8;
}

.muted {
  opacity: 0.75;
  font-size: 14px;
}

.plans {
  display: grid;
  gap: 10px;
  margin-top: 12px;
}

.plan {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border-radius: 12px;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.2);
}

.plan.active {
  outline: 2px solid rgba(255, 255, 255, 0.25);
}

.plan-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.plan-info {
  width: 100%;
}

.price {
  font-weight: 700;
}

.summary {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.summary-title {
  margin-top: 4px;
  font-weight: 700;
}

.pay {
  margin-top: 14px;
  width: 100%;
  padding: 12px;
  border-radius: 12px;
  border: none;
  font-weight: 800;
  cursor: pointer;
}

.promo-status {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 120, 0, 0.12);
  font-size: 14px;
}
</style>