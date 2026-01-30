// src/offline/export.js
import { getOfflineTrack } from './db'

function sanitize(name = 'audio') {
  return name
    .replace(/[\/\\?%*:|"<>]/g, '-')   // caracteres prohibidos
    .replace(/\s+/g, ' ')
    .trim()
}

export async function exportOfflineTrackFile(id, filename = 'cancion.mp3') {
  const t = await getOfflineTrack(id)
  if (!t?.blob) throw new Error('No está descargada en offline')

  const safe = sanitize(filename)
  const url = URL.createObjectURL(t.blob)

  const a = document.createElement('a')
  a.href = url
  a.download = safe
  document.body.appendChild(a)
  a.click()
  a.remove()

  URL.revokeObjectURL(url)
}
