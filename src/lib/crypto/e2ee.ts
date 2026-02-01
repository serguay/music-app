// src/lib/crypto/e2ee.ts
import nacl from 'tweetnacl'
import { decodeUTF8, encodeUTF8, encodeBase64, decodeBase64 } from 'tweetnacl-util'

const LS_KEY = (userId: string) => `music:crypto:keypair:v1:${userId}`

type KeypairB64 = { publicKey: string; secretKey: string }

// ✅ Crea/lee el keypair local (por usuario)
export function getOrCreateLocalKeypair(userId: string): KeypairB64 {
  const k = LS_KEY(userId)
  const raw = localStorage.getItem(k)
  if (raw) return JSON.parse(raw)

  const kp = nacl.box.keyPair()
  const out: KeypairB64 = {
    publicKey: encodeBase64(kp.publicKey),
    secretKey: encodeBase64(kp.secretKey)
  }
  localStorage.setItem(k, JSON.stringify(out))
  return out
}

// ✅ Asegura que tu public_key está guardada en profiles
export async function ensureMyPublicKey(supabase: any, userId: string) {
  const kp = getOrCreateLocalKeypair(userId)

  // mira si ya existe en profiles
  const { data } = await supabase
    .from('profiles')
    .select('public_key')
    .eq('id', userId)
    .maybeSingle()

  if (!data?.public_key) {
    await supabase
      .from('profiles')
      .update({ public_key: kp.publicKey, public_key_version: 1 })
      .eq('id', userId)
  }

  return kp.publicKey
}

// ✅ Cifra para "toUserId" usando su public_key
export async function encryptForUser(
  supabase: any,
  fromUserId: string,
  toUserId: string,
  plaintext: string
) {
  const my = getOrCreateLocalKeypair(fromUserId)

  const { data: toProfile, error } = await supabase
    .from('profiles')
    .select('public_key')
    .eq('id', toUserId)
    .maybeSingle()

  if (error) throw error
  if (!toProfile?.public_key) throw new Error('Recipient has no public_key')

  const theirPub = decodeBase64(toProfile.public_key)
  const mySecret = decodeBase64(my.secretKey)

  const nonce = nacl.randomBytes(nacl.box.nonceLength)
  const msg = decodeUTF8(plaintext)

  const boxed = nacl.box(msg, nonce, theirPub, mySecret)
  if (!boxed) throw new Error('Encryption failed')

  return {
    ciphertext: encodeBase64(boxed),
    nonce: encodeBase64(nonce),
    sender_pubkey: my.publicKey,
    enc_algo: 'crypto_box_easy' // lo dejamos así para tu schema actual
  }
}

// ✅ Descifra si viene ciphertext
export function decryptMessageIfNeeded(authUserId: string, row: any): string {
  if (!row?.ciphertext || !row?.nonce || !row?.sender_pubkey) return row?.text || ''

  const my = getOrCreateLocalKeypair(authUserId)
  const mySecret = decodeBase64(my.secretKey)

  const senderPub = decodeBase64(row.sender_pubkey)
  const nonce = decodeBase64(row.nonce)
  const boxed = decodeBase64(row.ciphertext)

  const opened = nacl.box.open(boxed, nonce, senderPub, mySecret)
  if (!opened) return '🔒 Mensaje cifrado (no se pudo descifrar)'

  return encodeUTF8(opened)
}