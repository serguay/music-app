import { supabase } from './supabase'

export async function saveToHistory(song) {
  if (!song?.id) return

  const { data } = await supabase.auth.getUser()
  const user = data?.user
  if (!user) return

  await supabase.from('listening_history').insert({
    user_id: user.id,
    song_id: song.id
  })
}
