import { createRouter, createWebHashHistory } from 'vue-router'
import { supabase } from '../lib/supabase'

import Login from '../views/Login.vue'
import Register from '../views/Register.vue'
import Home from '../views/Home.vue'
import Profile from '../views/Profile.vue'

const routes = [
  { path: '/', redirect: '/login' },

  { path: '/login', component: Login },
  { path: '/register', component: Register },

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

  // 🔔 NOTIFICACIONES
  {
    path: '/notifications',
    component: () => import('../views/Notifications.vue'),
    meta: { requiresAuth: true }
  }
]

const router = createRouter({
  history: createWebHashHistory(), // 🔥 CAMBIO CLAVE PARA ELECTRON
  routes
})

router.beforeEach(async (to, from, next) => {
  const {
    data: { session }
  } = await supabase.auth.getSession()

  if (to.meta.requiresAuth && !session) {
    next('/login')
  } else {
    next()
  }
})

export default router
