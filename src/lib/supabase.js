import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('❌ Faltan variables de entorno VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // ✅ Para poder tener usuarios distintos en ventanas/pestañas distintas (no se comparte entre tabs)
    storage: window.sessionStorage,

    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
})

// ✅ Debug: expone el cliente en la consola del navegador (Chrome/Safari)
// Quita esto cuando ya no lo necesites.
if (typeof window !== 'undefined') {
  window.supabase = supabase
}