// src/offline/download.js
import { saveOfflineTrack } from './db'
import { supabase } from '../lib/supabase'

// ✅ cambia esto si tu bucket se llama distinto
const DEFAULT_BUCKET = 'music-bucket'

function parseStorageUrl(audioUrl) {
  // Soporta:
  // 1) .../storage/v1/object/public/<bucket>/<path>
  // 2) .../storage/v1/object/sign/<bucket>/<path>?token=...
  try {
    const u = new URL(audioUrl)
    const parts = u.pathname.split('/').filter(Boolean)

    // parts ejemplo:
    // ["storage","v1","object","public", bucket, ...path]
    // ["storage","v1","object","sign", bucket, ...path]

    const i = parts.indexOf('object')
    if (i === -1) return null

    const mode = parts[i + 1] // "public" o "sign"
    const bucket = parts[i + 2]
    const path = parts.slice(i + 3).join('/')

    if (!mode || !bucket || !path) return null
    return { bucket, path, mode }
  } catch {
    return null
  }
}

export async function downloadTrack({ id, title, artist, audioUrl, bucket }) {
  if (!audioUrl) throw new Error('audioUrl vacío')

  let blob = null

  // ✅ Caso 1: si audioUrl es URL de Supabase Storage (public o sign)
  const ref = parseStorageUrl(audioUrl)
  if (ref) {
    const { data, error } = await supabase.storage.from(ref.bucket).download(ref.path)
    if (error) throw new Error(`Supabase download error: ${error.message}`)
    blob = data
  } else {
    // ✅ Caso 2: si audioUrl es solo un path (sin http)
    // Ej: "uploads/tema.mp3" o "user123/tema.mp3"
    const isPlainPath = typeof audioUrl === 'string' && !audioUrl.startsWith('http')
    if (isPlainPath) {
      const b = bucket || DEFAULT_BUCKET
      const { data, error } = await supabase.storage.from(b).download(audioUrl)
      if (error) throw new Error(`Supabase download error: ${error.message}`)
      blob = data
    } else {
      // ✅ Caso 3: URL normal (no supabase) -> fetch
      const res = await fetch(audioUrl, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      blob = await res.blob()
    }
  }

  if (!blob || blob.size === 0) throw new Error('Blob vacío (no se pudo bajar el audio)')

  await saveOfflineTrack({
    id,
    title: title || 'Canción',
    artist: artist || '',
    blob,
    mimeType: blob.type || 'audio/mpeg',
    size: blob.size,
    savedAt: Date.now()
  })
}
