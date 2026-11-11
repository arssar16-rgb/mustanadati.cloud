// الخزنة: ربط رمز القفل (6 أرقام) + مفتاح الجهاز + مفتاح الاسترداد بالمفتاح الرئيسي.
//
// - المفتاح الرئيسي لا يُحفظ أبدًا بصيغته الصريحة. يُحفظ مغلَّفًا مرتين:
//     1) بالرمز: PBKDF2-SHA256 (600 ألف دورة) ثم الناتج يُغلَّف أيضًا بمفتاح الجهاز غير القابل للتصدير،
//        فلا تُجرَّب الرموز خارج هذا الجهاز حتى لو نُسخت قاعدة البيانات.
//     2) بمفتاح الاسترداد (256 بت) — لا يتأثر بالرمز ولا بالجهاز.
// - عدّاد المحاولات الفاشلة مع تأخير متصاعد (لا مسح للبيانات، حتى لا يتسبب خطأ بفقدها).
// - لا يُحفظ شيء أثناء الإعداد قبل أن تؤكد أنك حفظت مفتاح الاسترداد.
import {
  generateMasterKey, generateDeviceKey, createRecoveryKey, parseRecoveryKey,
  wrapMasterWithRecovery, unwrapMasterWithRecovery, sealBytes, openBytes, randomBytes, concat,
} from './crypto.js';
import { CryptoError } from './errors.js';

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const PIN_AAD = 'mustanadati/pin-wrap/v1';
const DEV_AAD = 'mustanadati/device-pin/v1';
export const DEFAULT_ITERATIONS = 600_000;
export const FREE_ATTEMPTS = 5;

export class VaultError extends Error {
  constructor(code, info = {}) { super(code); this.name = 'VaultError'; this.code = code; this.info = info; }
}

// ---------- الرمز ----------
export function normalizePin(p) {
  return String(p ?? '').trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
}
// يعيد null إن كان مقبولًا، وإلا 'format' أو 'weak'
export function pinProblem(pin) {
  if (!/^\d{6}$/.test(pin)) return 'format';
  if (/^(\d)\1{5}$/.test(pin)) return 'weak';
  const d = [...pin].map(Number);
  const up = d.every((x, i) => i === 0 || x - d[i - 1] === 1);
  const down = d.every((x, i) => i === 0 || d[i - 1] - x === 1);
  return up || down ? 'weak' : null;
}

async function pinKey(pin, salt, iterations) {
  const k = await subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, k, 256));
}
async function deviceSeal(key, bytes) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(DEV_AAD) }, key, bytes));
  return concat(iv, ct);
}
async function deviceOpen(key, sealed) {
  return new Uint8Array(await subtle.decrypt(
    { name: 'AES-GCM', iv: sealed.slice(0, 12), additionalData: enc.encode(DEV_AAD) }, key, sealed.slice(12)));
}

// ---------- تأكيد مفتاح الاسترداد ----------
export const recoveryGroups = (text) => String(text).split('-');
function randInt(n) {
  const b = new Uint32Array(1), lim = Math.floor(0x100000000 / n) * n;
  let x;
  do { globalThis.crypto.getRandomValues(b); x = b[0]; } while (x >= lim); // دون انحياز
  return x % n;
}
export function pickChallenge(text, count = 2) {
  const n = recoveryGroups(text).length, picked = new Set();
  while (picked.size < count) picked.add(randInt(n));
  return [...picked].sort((a, b) => a - b);
}
// 0 لا يظهر أبدًا في المفتاح، فنعامله كحرف O (خطأ شائع عند النسخ باليد)
export const normalizeRecoveryInput = (s) => String(s ?? '').toUpperCase().replace(/0/g, 'O').replace(/[^A-Z2-7-]/g, '');
const groupOnly = (s) => normalizeRecoveryInput(s).replace(/-/g, '');
export function checkAnswers(text, indices, answers) {
  const g = recoveryGroups(text);
  return indices.every((gi, k) => groupOnly(answers[k]) === g[gi]);
}

export class Vault {
  constructor(store, { iterations = DEFAULT_ITERATIONS, now = () => Date.now() } = {}) {
    this.store = store;
    this.iterations = iterations;
    this.now = now;
    this.master = null;
  }
  get unlocked() { return this.master !== null; }

  async isSetup() {
    return !!(await this.store.get('keyring')) && !!(await this.store.get('device-key'));
  }

  async _buildKeyring(master, pin, deviceKey, recoveryBlob) {
    const salt = randomBytes(16);
    const pinBlob = await sealBytes(await pinKey(pin, salt, this.iterations), master, PIN_AAD);
    return { v: 1, salt, iterations: this.iterations, deviceBlob: await deviceSeal(deviceKey, pinBlob), recoveryBlob, createdAt: this.now() };
  }

  // ---- الإعداد: يجهّز كل شيء في الذاكرة ولا يحفظ شيئًا ----
  async prepareSetup(rawPin) {
    if (await this.isSetup()) throw new VaultError('already-setup');
    const pin = normalizePin(rawPin);
    const problem = pinProblem(pin);
    if (problem) throw new VaultError('bad-pin-' + problem);
    const master = generateMasterKey();
    const deviceKey = await generateDeviceKey();
    const rec = await createRecoveryKey();
    const keyring = await this._buildKeyring(master, pin, deviceKey, await wrapMasterWithRecovery(master, rec.raw));
    return { recoveryText: rec.text, master, deviceKey, keyring };
  }
  // يُحفظ الآن فقط، وبعد أن تكتب مقطعين من مفتاح الاسترداد من ورقتك
  async finishSetup(pending, indices, answers) {
    if (!checkAnswers(pending.recoveryText, indices, answers)) throw new VaultError('bad-answers');
    await this.store.put('device-key', pending.deviceKey);
    await this.store.put('keyring', pending.keyring);
    this.master = pending.master;
  }

  // ---- القفل ----
  async _lockState() { return (await this.store.get('lock-state')) || { fails: 0, until: 0 }; }

  async unlock(rawPin) {
    const t = this.now(), ls = await this._lockState();
    if (ls.until > t) throw new VaultError('locked', { retryInMs: ls.until - t });
    const keyring = await this.store.get('keyring'), deviceKey = await this.store.get('device-key');
    if (!keyring || !deviceKey) throw new VaultError('not-setup');
    try {
      const pinBlob = await deviceOpen(deviceKey, keyring.deviceBlob);
      const k = await pinKey(normalizePin(rawPin), keyring.salt, keyring.iterations);
      this.master = await openBytes(k, pinBlob, PIN_AAD);
    } catch {
      const fails = ls.fails + 1;
      const until = fails >= FREE_ATTEMPTS ? t + Math.min(3_600_000, 30_000 * 2 ** (fails - FREE_ATTEMPTS)) : 0;
      await this.store.put('lock-state', { fails, until });
      throw new VaultError('bad-pin', { attemptsLeft: Math.max(0, FREE_ATTEMPTS - fails), retryInMs: until ? until - t : 0 });
    }
    if (ls.fails || ls.until) await this.store.put('lock-state', { fails: 0, until: 0 });
    return true;
  }
  lock() { this.master = null; }

  async changePin(rawPin) {
    if (!this.master) throw new VaultError('locked-app');
    const pin = normalizePin(rawPin), problem = pinProblem(pin);
    if (problem) throw new VaultError('bad-pin-' + problem);
    const keyring = await this.store.get('keyring'), deviceKey = await this.store.get('device-key');
    await this.store.put('keyring', await this._buildKeyring(this.master, pin, deviceKey, keyring.recoveryBlob));
  }

  // ---- الاسترداد: نفس المفتاح الرئيسي، رمز جديد ومفتاح جهاز جديد ----
  // recoveryBlob اختياري: لجهاز جديد يُجلب فيه من Drive لاحقًا
  async recover(recoveryText, rawPin, { recoveryBlob = null } = {}) {
    const pin = normalizePin(rawPin), problem = pinProblem(pin);
    if (problem) throw new VaultError('bad-pin-' + problem);
    const keyring = await this.store.get('keyring');
    const blob = recoveryBlob || keyring?.recoveryBlob;
    if (!blob) throw new VaultError('no-recovery-data');
    let master;
    try {
      master = await unwrapMasterWithRecovery(blob, await parseRecoveryKey(normalizeRecoveryInput(recoveryText)));
    } catch (e) {
      if (e instanceof CryptoError) throw new VaultError('bad-recovery');
      throw e;
    }
    const deviceKey = await generateDeviceKey();
    await this.store.put('device-key', deviceKey);
    await this.store.put('keyring', await this._buildKeyring(master, pin, deviceKey, blob));
    await this.store.put('lock-state', { fails: 0, until: 0 });
    this.master = master;
  }
  async exportRecoveryBlob() { return (await this.store.get('keyring'))?.recoveryBlob ?? null; }

  async reset() { this.master = null; await this.store.clear(); }
}
