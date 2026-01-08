<script setup>
import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase'

const notifications = ref([])

onMounted(async () => {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) return

 const { data } = await supabase
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



  notifications.value = data || []
})
</script>

<template>
  <section class="notifications">
    <h2>🔔 Notificaciones</h2>

    <p v-if="!notifications.length" class="empty">
      No tienes notificaciones
    </p>

    <div
      v-for="n in notifications"
      :key="n.id"
      class="notif"
    >
      <span v-if="n.type === 'follow'">
        <strong>{{ n.profiles.username }}</strong> empezó a seguirte
      </span>
    </div>
  </section>
</template>

<style scoped>
.notifications {
  padding: 1.5rem;
}

.notif {
  padding: 12px;
  border-bottom: 1px solid #eee;
  font-size: .9rem;
}

.empty {
  opacity: .6;
}
</style>
