<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { supabase } from '../lib/supabase'
import { useRouter } from 'vue-router'

const router = useRouter()

const notifications = ref([])
const loading = ref(true)
const errorMsg = ref('')
const userId = ref(null)

const goBack = () => router.push('/app')

const timeAgo = (dateStr) => {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const diff = Date.now() - d.getTime()
  const s = Math.floor(diff / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const days = Math.floor(h / 24)

  if (s < 30) return 'ahora'
  if (m < 60) return `hace ${m} min`
  if (h < 24) return `hace ${h} h`
  if (days < 7) return `hace ${days} días`
  return d.toLocaleDateString()
}

const openNotification = (n) => {
  if (n.type === 'follow' && n.from_user_id) {
    router.push(`/profile/${n.from_user_id}`)
  }
}

const fetchNotifications = async () => {
  loading.value = true
  errorMsg.value = ''

  const { data: auth, error: authErr } = await supabase.auth.getUser()
  if (authErr) {
    console.error(authErr)
    errorMsg.value = 'No se pudo comprobar la sesión.'
    loading.value = false
    return
  }

  if (!auth?.user) {
    errorMsg.value = 'No hay sesión activa.'
    loading.value = false
    return
  }

  userId.value = auth.user.id

  const { data, error } = await supabase
    .from('notifications')
    .select(`
      id,
      type,
      created_at,
      from_user_id,
      profiles:from_user_id ( username )
    `)
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error(error)
    errorMsg.value = 'Error cargando notificaciones.'
    notifications.value = []
    loading.value = false
    return
  }

  // ✅ Por si tu BD tiene duplicados: dedupe por id
  const map = new Map()
  ;(data || []).forEach((n) => {
    if (!map.has(n.id)) map.set(n.id, n)
  })

  notifications.value = Array.from(map.values())
  loading.value = false
}

const deleteNotif = async (id) => {
  if (!userId.value) return

  // ✅ UI Optimista: quitamos al instante
  const prev = [...notifications.value]
  notifications.value = notifications.value.filter((n) => n.id !== id)

  // ✅ BORRAR EN BD (id + user_id para que RLS permita)
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('id', id)
    .eq('user_id', userId.value)

  if (error) {
    console.error(error)
    // rollback si falla
    notifications.value = prev
    alert('No se pudo borrar la notificación. Revisa RLS/policies en Supabase.')
  }
}

onMounted(async () => {
  // ✅ añade el background SOLO en esta página
  document.documentElement.classList.add('notifications-bg')
  document.body.classList.add('notifications-bg')

  await fetchNotifications()
})

onUnmounted(() => {
  // ✅ quita el background al salir
  document.documentElement.classList.remove('notifications-bg')
  document.body.classList.remove('notifications-bg')
})
</script>

<template>
  <section class="notifications-page">
    <header class="topbar">
      <button class="back-btn" @click="goBack">← Volver</button>

      <div class="badge" v-if="!loading">
        {{ notifications.length }}
      </div>
    </header>

    <!-- Error -->
    <div v-if="errorMsg" class="state-card error">
      <div class="state-icon">⚠️</div>
      <div>
        <p class="state-title">Ups</p>
        <p class="state-text">{{ errorMsg }}</p>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="list">
      <div v-for="i in 5" :key="i" class="notif skeleton">
        <div class="avatar sk"></div>
        <div class="lines">
          <div class="line sk w1"></div>
          <div class="line sk w2"></div>
        </div>
        <div class="meta sk w3"></div>
      </div>
    </div>

    <!-- Empty -->
    <div v-else-if="!notifications.length && !errorMsg" class="state-card">
      <div class="state-icon">✨</div>
      <div>
        <p class="state-title">Todo tranquilo</p>
        <p class="state-text">No tienes notificaciones por ahora.</p>
      </div>
    </div>

    <!-- List -->
    <TransitionGroup v-else name="notif" tag="div" class="list">
      <button
        v-for="n in notifications"
        :key="n.id"
        class="notif"
        type="button"
        @click="openNotification(n)"
      >
        <div class="avatar">
          <span class="avatar-dot"></span>
        </div>

        <div class="content">
          <p class="msg">
            <template v-if="n.type === 'follow'">
              <strong class="u">{{ n.profiles?.username || 'Alguien' }}</strong>
              <span> empezó a seguirte</span>
            </template>

            <template v-else>
              <strong class="u">{{ n.profiles?.username || 'Alguien' }}</strong>
              <span> hizo una acción</span>
            </template>
          </p>

          <p class="when">{{ timeAgo(n.created_at) }}</p>
        </div>

        <!-- ✅ CLASE ARREGLADA -->
        <div class="actions-right">
          <button
            class="del-btn"
            type="button"
            @click.stop="deleteNotif(n.id)"
            aria-label="Quitar notificación"
            title="Quitar"
          >
            ✕
          </button>
        </div>
      </button>
    </TransitionGroup>
  </section>
</template>

<style scoped>
/* ✅ SOLO cuando estamos en Notifications */
:global(html.notifications-bg),
:global(body.notifications-bg){
  background: #0b1220;
  margin: 0;
  min-height: 100%;
}

/* 🎯 Variables */
.notifications-page{
  --bg: #0b1220;
  --card: rgba(255,255,255,.06);
  --card2: rgba(255,255,255,.08);
  --border: rgba(255,255,255,.10);
  --border2: rgba(255,255,255,.16);
  --text: rgba(255,255,255,.94);
  --muted: rgba(255,255,255,.68);
  --muted2: rgba(255,255,255,.56);
  --shadow: 0 18px 50px rgba(0,0,0,.22);
  --shadow2: 0 10px 28px rgba(0,0,0,.18);
  --ring: 0 0 0 4px rgba(99,102,241,.22);
  --radius: 18px;

  position: fixed;
  inset: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;

  padding: 18px 14px 28px;
  box-sizing: border-box;
  overflow-x: hidden;

  background: var(--bg);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

/* 🌫️ blobs */
.notifications-page::before,
.notifications-page::after{
  content: "";
  position: fixed;
  inset: -22%;
  pointer-events: none;
  z-index: 0;
  filter: blur(46px);
  opacity: .55;
  transform: translateZ(0);
}

.notifications-page::before{
  background:
    radial-gradient(620px 380px at 58% 10%, rgba(99,102,241,.34), transparent 62%),
    radial-gradient(520px 420px at 14% 86%, rgba(59,130,246,.22), transparent 60%);
}

.notifications-page::after{
  background:
    radial-gradient(720px 460px at 86% 78%, rgba(168,85,247,.20), transparent 64%),
    radial-gradient(520px 460px at 30% 56%, rgba(255,255,255,.045), transparent 68%);
  opacity: .45;
}

/* ✅ contenido por encima */
.topbar,
.list,
.state-card{
  position: relative;
  z-index: 1;
  max-width: 980px;
  margin-left: auto;
  margin-right: auto;
}

/* Topbar */
.topbar{
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  align-items: center;
  margin-bottom: 14px;
  padding: 10px 2px;
}

/* Botón volver */
.back-btn{
  justify-self: start;
  border: 1px solid var(--border);
  background: rgba(255,255,255,.07);
  color: rgba(255,255,255,.92);

  padding: 10px 14px;
  border-radius: 999px;
  font-weight: 900;
  letter-spacing: -0.01em;

  cursor: pointer;
  box-shadow: 0 10px 24px rgba(0,0,0,.16);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);

  transition: transform .14s ease, background .14s ease, border-color .14s ease, box-shadow .14s ease;
}

.back-btn:hover{
  background: rgba(255,255,255,.10);
  border-color: var(--border2);
  transform: translateY(-1px);
  box-shadow: 0 14px 28px rgba(0,0,0,.18);
}

.badge{
  justify-self: end;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34px;
  height: 34px;

  border-radius: 999px;
  font-weight: 950;
  color: rgba(255,255,255,.95);
  background: rgba(255,255,255,.10);
  border: 1px solid rgba(255,255,255,.15);
  box-shadow: 0 10px 26px rgba(0,0,0,.16);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

/* Lista */
.list{
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Card */
.notif{
  width: 100%;
  text-align: left;

  display: grid;
  grid-template-columns: 44px 1fr auto;
  gap: 12px;
  align-items: center;

  border: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(255,255,255,.075), rgba(255,255,255,.045));
  color: rgba(255,255,255,.92);

  border-radius: calc(var(--radius) + 2px);
  padding: 12px;
  box-shadow: var(--shadow2);

  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);

  cursor: pointer;

  transition: transform .14s ease, background .14s ease, border-color .14s ease, box-shadow .14s ease;
}

.notif:hover{
  transform: translateY(-1px);
  background: linear-gradient(180deg, rgba(255,255,255,.095), rgba(255,255,255,.055));
  border-color: var(--border2);
  box-shadow: var(--shadow);
}

.avatar{
  width: 40px;
  height: 40px;
  border-radius: 14px;
  background: rgba(255,255,255,.08);
  border: 1px solid rgba(255,255,255,.12);
  position: relative;
  overflow: hidden;
  box-shadow: 0 10px 20px rgba(0,0,0,.16);
}

.avatar-dot{
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  background: rgba(99,102,241,.95);
  box-shadow: 0 0 0 6px rgba(99,102,241,.16);
}

.msg{
  margin: 0;
  font-size: 14px;
  font-weight: 820;
  color: rgba(255,255,255,.94);
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.when{
  margin: 2px 0 0;
  font-size: 12px;
  font-weight: 800;
  color: rgba(255,255,255,.56);
}

.actions-right{
  display: inline-flex;
  align-items: center;
  justify-content: end;
}

.del-btn{
  width: 28px;
  height: 28px;
  border-radius: 11px;
  border: 1px solid rgba(255,255,255,.10);
  background: rgba(0,0,0,.22);
  color: rgba(255,255,255,.78);

  display: inline-flex;
  align-items: center;
  justify-content: center;

  cursor: pointer;
  padding: 0;
  line-height: 1;

  box-shadow: 0 8px 18px rgba(0,0,0,.16);
  transition: transform .14s ease, background .14s ease, border-color .14s ease, color .14s ease;
}

.del-btn:hover{
  background: rgba(0,0,0,.32);
  border-color: rgba(255,255,255,.16);
  color: rgba(255,255,255,.96);
  transform: translateY(-1px);
}

@media (max-width: 520px){
  .notif{
    grid-template-columns: 42px 1fr auto;
    border-radius: 16px;
  }
}
</style>
