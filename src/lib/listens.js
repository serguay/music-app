import { supabase } from './supabase'

export const registerListen = async (songId) => {
  const { data: auth } = await supabase.auth.getUser()
  const user = auth?.user
  if (!user || !songId) return

  // insertar solo 1 vez por usuario y canción
  const { error } = await supabase
    .from('listening_history')
    .insert({
      user_id: user.id,
      song_id: songId
    })

  // ignoramos duplicados (usuario ya contó)
  if (error && error.code !== '23505') {
    console.error('listen error', error)
  }
}
