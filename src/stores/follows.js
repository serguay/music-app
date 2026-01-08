import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '../lib/supabase'

export const useFollows = defineStore('follows', () => {
  const following = ref([])
  const followers = ref([])

  /* ======================
     LOAD FOLLOWING
  ====================== */
  const loadFollowing = async (userId) => {
    if (!userId) return

    const { data } = await supabase
      .from('follows')
      .select('followed_id')
      .eq('follower_id', userId)

    following.value = data?.map(f => f.followed_id) || []
  }

  /* ======================
     LOAD FOLLOWERS
  ====================== */
  const loadFollowers = async (userId) => {
    if (!userId) return

    const { data } = await supabase
      .from('follows')
      .select('follower_id')
      .eq('followed_id', userId)

    followers.value = data?.map(f => f.follower_id) || []
  }

  /* ======================
     IS FOLLOWING?
  ====================== */
  const isFollowing = (userId) => {
    return following.value.includes(userId)
  }

  /* ======================
     FOLLOW
  ====================== */
  const follow = async (fromUserId, toUserId) => {
    if (!fromUserId || !toUserId) return

    await supabase.from('follows').insert({
      follower_id: fromUserId,
      followed_id: toUserId
    })

    // 🔔 NOTIFICATION
    await supabase.from('notifications').insert({
      user_id: toUserId,
      from_user_id: fromUserId,
      type: 'follow',
      read: false
    })

    following.value.push(toUserId)
  }

  /* ======================
     UNFOLLOW
  ====================== */
  const unfollow = async (fromUserId, toUserId) => {
    await supabase
      .from('follows')
      .delete()
      .eq('follower_id', fromUserId)
      .eq('followed_id', toUserId)

    following.value = following.value.filter(id => id !== toUserId)
  }

  return {
    following,
    followers,
    loadFollowing,
    loadFollowers,
    isFollowing,
    follow,
    unfollow
  }
})
