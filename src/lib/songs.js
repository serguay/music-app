import { supabase } from './supabase'

export async function saveSong(song) {
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) return

  const { error } = await supabase
    .from('listening_history')
    .upsert(
      {
        user_id: user.id,
        song_id: song.id,
        song_title: song.title,
        artist: song.artist || 'Tú',
        audio_url: song.url,
        is_saved: true
      },
      {
        onConflict: 'user_id,song_id'
      }
    )

  if (error) {
    console.error('Error guardando canción', error)
  }
}
