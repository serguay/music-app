import { openDB } from 'idb'

const DB_NAME = 'musicapp-db'
const STORE = 'offline_tracks'

const dbPromise = openDB(DB_NAME, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORE)) {
      db.createObjectStore(STORE, { keyPath: 'id' })
    }
  }
})

export async function saveOfflineTrack(track) {
  const db = await dbPromise
  await db.put(STORE, track)
}

export async function getOfflineTrack(id) {
  const db = await dbPromise
  return db.get(STORE, id)
}

export async function listOfflineTracks() {
  const db = await dbPromise
  return db.getAll(STORE)
}

export async function deleteOfflineTrack(id) {
  const db = await dbPromise
  return db.delete(STORE, id)
}
