// نواة التشفير — WebCrypto فقط (تعمل في Safari وNode 22 دون مكتبات خارجية)
// التسلسل: مفتاح رئيسي عشوائي (256 بت) → مفاتيح فرعية بـ HKDF → مفتاح مستقل لكل ملف.
// المفتاح الرئيسي يُغلَّف مرّتين: بمفتاح الجهاز (غير قابل للتصدير) وبمفتاح الاسترداد.
import { CryptoError } from './errors.js';

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export function concat(...parts) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}
export function fromB64(s) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
const readU32 = (u8, o) => new DataView(u8.buffer, u8.byteOffset + o, 4).getUint32(0);

export async function sha256(bytes) {
  return new Uint8Array(await subtle.digest('SHA-256', bytes));
}
export async function sha256Hex(bytes) {
  return [...(await sha256(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- اشتقاق المفاتيح ----------
export async function deriveKeyBytes(ikm, label, length = 32) {
  const k = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('mustanadati/v1'), info: enc.encode(label) },
    k, length * 8);
  return new Uint8Array(bits);
}
const aesKey = (raw, usages) => subtle.importKey('raw', raw, 'AES-GCM', false, usages);

// ---------- تغليف عام (AES-GCM + AAD) ----------
export async function sealBytes(keyRaw, plaintext, aad) {
  const nonce = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: enc.encode(aad) }, await aesKey(keyRaw, ['encrypt']), plaintext));
  return concat(nonce, ct);
}
export async function openBytes(keyRaw, sealed, aad) {
  try {
    if (sealed.length < 12 + 16) throw new Error('short');
    return new Uint8Array(await subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.slice(0, 12), additionalData: enc.encode(aad) },
      await aesKey(keyRaw, ['decrypt']), sealed.slice(12)));
  } catch { throw new CryptoError(); }
}

// بيانات التنظيم والفهرس: JSON مشفّر بمفتاح فرعي لكل تسمية
export async function sealJSON(master, label, obj) {
  const key = await deriveKeyBytes(master, 'json/' + label);
  return sealBytes(key, enc.encode(JSON.stringify(obj)), 'json/' + label);
}
export async function openJSON(master, label, sealed) {
  const key = await deriveKeyBytes(master, 'json/' + label);
  return JSON.parse(dec.decode(await openBytes(key, sealed, 'json/' + label)));
}

// ---------- المفتاح الرئيسي ----------
export const generateMasterKey = () => randomBytes(32);

const WRAP_AAD = 'mustanadati/master-wrap/v1';

// مفتاح الجهاز: CryptoKey غير قابل للتصدير يُحفظ في IndexedDB (يُنسخ بالاستنساخ البنيوي)
export const generateDeviceKey = () =>
  subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

export async function wrapMasterWithDevice(master, deviceKey) {
  const nonce = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: enc.encode(WRAP_AAD + '/device') }, deviceKey, master));
  return concat(nonce, ct);
}
export async function unwrapMasterWithDevice(sealed, deviceKey) {
  try {
    return new Uint8Array(await subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.slice(0, 12), additionalData: enc.encode(WRAP_AAD + '/device') },
      deviceKey, sealed.slice(12)));
  } catch { throw new CryptoError(); }
}

// ---------- مفتاح الاسترداد (عبارة مستقلة) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32enc(u8) {
  let bits = 0, val = 0, out = '';
  for (const b of u8) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
    val &= (1 << bits) - 1;
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32dec(s) {
  let bits = 0, val = 0; const out = [];
  for (const ch of s) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new CryptoError('مفتاح الاسترداد يحتوي رمزًا غير صالح');
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
    val &= (1 << bits) - 1;
  }
  return new Uint8Array(out);
}

export async function formatRecoveryKey(raw) {
  const check = (await sha256(raw))[0];
  const s = b32enc(concat(raw, new Uint8Array([check])));
  return s.match(/.{1,5}/g).join('-');
}
export async function createRecoveryKey() {
  const raw = randomBytes(32);
  return { raw, text: await formatRecoveryKey(raw) };
}
export async function parseRecoveryKey(text) {
  const clean = String(text).toUpperCase().replace(/[^A-Z2-7]/g, '');
  const bytes = b32dec(clean).slice(0, 33);
  if (bytes.length < 33) throw new CryptoError('مفتاح الاسترداد ناقص');
  const raw = bytes.slice(0, 32);
  if ((await sha256(raw))[0] !== bytes[32]) throw new CryptoError('مفتاح الاسترداد غير صحيح — راجع الحروف');
  return raw;
}
export async function wrapMasterWithRecovery(master, recoveryRaw) {
  return sealBytes(await deriveKeyBytes(recoveryRaw, 'recovery-wrap'), master, WRAP_AAD + '/recovery');
}
export async function unwrapMasterWithRecovery(sealed, recoveryRaw) {
  return openBytes(await deriveKeyBytes(recoveryRaw, 'recovery-wrap'), sealed, WRAP_AAD + '/recovery');
}
// إثبات حيازة مفتاح الاسترداد للخادم دون كشفه: الخادم يحفظ SHA-256 للإثبات فقط
export async function recoveryProof(recoveryRaw) {
  return toB64(await deriveKeyBytes(recoveryRaw, 'recovery-auth'));
}

// ---------- تشفير الملفات (مقاطع 1MB، مع ربط الترتيب ونهاية الملف) ----------
const MAGIC = enc.encode('MSF1');
const TAG = 16;

export async function encryptFile(master, fileId, plaintext, chunkSize = 1 << 20) {
  const fileKey = randomBytes(32);
  const prefix = randomBytes(8);
  const wrapKey = await deriveKeyBytes(master, 'file-key-wrap');
  const wrappedKey = await sealBytes(wrapKey, fileKey, 'file-key/' + fileId);
  const key = await aesKey(fileKey, ['encrypt']);
  const n = Math.max(1, Math.ceil(plaintext.length / chunkSize));
  const parts = [MAGIC, u32(chunkSize), prefix];
  for (let i = 0; i < n; i++) {
    const last = i === n - 1 ? 1 : 0;
    const ct = await subtle.encrypt(
      { name: 'AES-GCM', iv: concat(prefix, u32(i)), additionalData: enc.encode(`${fileId}|${i}|${last}`) },
      key, plaintext.slice(i * chunkSize, (i + 1) * chunkSize));
    parts.push(new Uint8Array(ct));
  }
  return { wrappedKey, blob: concat(...parts) };
}

export async function decryptFile(master, fileId, wrappedKey, blob) {
  try {
    for (let i = 0; i < 4; i++) if (blob[i] !== MAGIC[i]) throw new Error('magic');
    const chunkSize = readU32(blob, 4);
    const prefix = blob.slice(8, 16);
    const body = blob.slice(16);
    if (chunkSize < 1 || body.length < TAG) throw new Error('size');
    const wrapKey = await deriveKeyBytes(master, 'file-key-wrap');
    const fileKey = await openBytes(wrapKey, wrappedKey, 'file-key/' + fileId);
    const key = await aesKey(fileKey, ['decrypt']);
    const encChunk = chunkSize + TAG;
    const n = Math.ceil(body.length / encChunk);
    const out = [];
    for (let i = 0; i < n; i++) {
      const last = i === n - 1 ? 1 : 0;
      const pt = await subtle.decrypt(
        { name: 'AES-GCM', iv: concat(prefix, u32(i)), additionalData: enc.encode(`${fileId}|${i}|${last}`) },
        key, body.slice(i * encChunk, (i + 1) * encChunk));
      out.push(new Uint8Array(pt));
    }
    return concat(...out);
  } catch { throw new CryptoError(); }
}
