import { createRouter, createWebHashHistory } from 'vue-router'
import { supabase } from '../lib/supabase'

import Login from '../views/Login.vue'
import Register from '../views/Register.vue'
import Home from '../views/Home.vue'
import Profile from '../views/Profile.vue'
import Promotions from '../views/Promotions.vue'
import MusicMap from '../views/MusicMap.vue'

// ✅ NUEVO: página pública de canción
import SongPublic from '../views/SongPublic.vue'

// ✅ NUEVAS: páginas legales (públicas)
import Terms from '../views/Terms.vue'
import Privacy from '../views/Privacy.vue'
import Security from '../views/Security.vue'

// ✅ ADMIN
import Admin from '../views/Admin.vue'
import AdminUsers from '../views/AdminUsers.vue'
import AdminAudios from '../views/AdminAudios.vue'
import AdminPromotions from '../views/AdminPromotions.vue'

const routes = [
  { path: '/', redirect: '/login' },

  { path: '/login', component: Login, meta: { public: true } },
  { path: '/register', component: Register, meta: { public: true } },

  // ✅ PÁGINAS LEGALES (PÚBLICAS)
  { path: '/terms', component: Terms, meta: { public: true } },
  { path: '/privacy', component: Privacy, meta: { public: true } },
  { path: '/security', component: Security, meta: { public: true } },

  // ✅ RUTA PÚBLICA PARA COMPARTIR CANCIONES
  { path: '/s/:id', component: SongPublic, meta: { public: true } },

  {
    path: '/app',
    component: Home,
    meta: { requiresAuth: true }
  },

  {
    path: '/profile/:id',
    component: Profile,
    meta: { requiresAuth: true }
  },

  {
    path: '/notifications',
    component: () => import('../views/Notifications.vue'),
    meta: { requiresAuth: true }
  },

  {
    path: '/promotions',
    component: Promotions,
    meta: { requiresAuth: true }
  },
  {
    path: '/music-map',
    component: MusicMap,
    meta: { requiresAuth: true }
  },

  // ✅ ADMIN PANEL
  {
    path: '/admin',
    component: Admin,
    meta: { requiresAuth: true }
  },

  // ✅ ADMIN SUBPAGES
  {
    path: '/admin/users',
    component: AdminUsers,
    meta: { requiresAuth: true }
  },
  {
    path: '/admin/audios',
    component: AdminAudios,
    meta: { requiresAuth: true }
  },
  {
    path: '/admin/promotions',
    component: AdminPromotions,
    meta: { requiresAuth: true }
  },

  // fallback
  { path: '/:pathMatch(.*)*', redirect: '/app' }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

// ✅ FIX: limpia estado global (modales/overlays) al cambiar de ruta
router.afterEach(() => {
  const html = document.documentElement
  const body = document.body

  // clases que a veces se quedan enganchadas
  html.classList.remove('cm-share-open', 'share-open')
  body.classList.remove('cm-share-open', 'share-open')

  // estilos inline que bloquean scroll / clicks
  html.style.overflow = ''
  html.style.overflowY = ''
  html.style.filter = ''
  html.style.pointerEvents = ''

  body.style.overflow = ''
  body.style.overflowY = ''
  body.style.filter = ''
  body.style.pointerEvents = ''
})

router.beforeEach(async (to, from, next) => {
  try {
    const { data: { session } } = await supabase.auth.getSession()

    const isPublic = to.meta.public === true
    const requiresAuth = to.meta.requiresAuth === true

    // ✅ Bloqueo por verificación de email
    const waiting = !!localStorage.getItem('awaiting_email_verification')
    const user = session?.user
    const confirmed = !!(user?.email_confirmed_at || user?.confirmed_at)

    // 1) Rutas protegidas
    if (requiresAuth) {
      if (!session) {
        return next({ path: '/login', query: { redirect: to.fullPath } })
      }

      // Si hay sesión pero NO está confirmado (o estamos esperando verificación), NO entra
      if (waiting || !confirmed) {
        try { await supabase.auth.signOut() } catch (_) {}
        return next({ path: '/register', query: { verify: '1' } })
      }
    }

    // 2) Rutas públicas
    if (session && isPublic && (to.path === '/login' || to.path === '/register')) {
      if (confirmed && !waiting) {
        return next('/app')
      }
      return next({ path: '/register', query: { verify: '1' } })
    }

    return next()
  } catch (e) {
    console.error('[router.beforeEach] getSession failed:', e)

    if (to.meta.requiresAuth === true) {
      return next('/login')
    }

    return next()
  }
})

export default router