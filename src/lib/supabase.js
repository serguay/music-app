import { createClient } from '@supabase/supabase-js'

// 🔴 REEMPLAZA estos valores por los tuyos de Supabase
const supabaseUrl = 'https://lzxxqzrzuxyqdpwrnvzf.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6eHhxenJ6dXh5cWRwd3JudnpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1NDczNTIsImV4cCI6MjA4MzEyMzM1Mn0.CrBp8u5FYaAh_RPgWlM3MI_dLf_xGUWB-FG8IuiSwKY'

// Cliente Supabase
export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey
)
