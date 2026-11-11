// رفع قابل للاستئناف مع الاحتفاظ بالملفات المعلّقة (انقطاع، امتلاء Drive، فشل التحقق).
// الحالات: pending → uploading → verified | pending-offline | blocked-quota | failed-verify | failed
import { sha256Hex } from './crypto.js';
import { DriveFullError, NetworkError, SessionExpiredError, VerifyError } from './errors.js';

export class PendingStore {
  constructor() { this.items = new Map(); }
  put(item) { this.items.set(item.id, item); }
  get(id) { return this.items.get(id); }
  list() { return [...this.items.values()]; }
  delete(id) { this.items.delete(id); }
}

// kind: 'file' | 'meta' | 'index'. المحتوى الذي يدخل هنا مشفّر مسبقًا.
export async function enqueue(store, { id, name, bytes, kind = 'file' }) {
  const item = { id, name, bytes, kind, sha256: await sha256Hex(bytes), state: 'pending',
    sessionId: null, offset: 0, remoteId: null, lastError: null };
  store.put(item);
  return item;
}

async function attempt(drive, store, item, chunkSize) {
  if (item.sessionId) item.offset = await drive.queryOffset(item.sessionId); // استئناف من حيث وصل Drive فعلًا
  else { item.sessionId = await drive.startSession({ name: item.name, size: item.bytes.length }); item.offset = 0; }
  item.state = 'uploading';
  store.put(item);
  while (item.offset < item.bytes.length) {
    const end = Math.min(item.offset + chunkSize, item.bytes.length);
    const { received } = await drive.putChunk(item.sessionId, item.offset, item.bytes.slice(item.offset, end));
    item.offset = received;
    store.put(item);
  }
  const remote = await drive.finalize(item.sessionId);
  if (remote.size !== item.bytes.length || remote.sha256 !== item.sha256) throw new VerifyError();
  item.state = 'verified';
  item.remoteId = remote.id;
  item.lastError = null;
}

function classify(item, e) {
  item.lastError = e.message;
  if (e instanceof DriveFullError) item.state = 'blocked-quota';
  else if (e instanceof NetworkError) item.state = 'pending-offline';
  else if (e instanceof VerifyError) { item.state = 'failed-verify'; item.sessionId = null; item.offset = 0; }
  else item.state = 'failed';
}

export async function uploadPending(drive, store, id, { chunkSize = 256 * 1024 } = {}) {
  const item = store.get(id);
  if (!item) throw new Error('العنصر غير موجود في قائمة الرفع');
  if (item.state === 'verified') return item;
  try { await attempt(drive, store, item, chunkSize); }
  catch (e) {
    if (e instanceof SessionExpiredError) {
      item.sessionId = null; item.offset = 0;
      try { await attempt(drive, store, item, chunkSize); } catch (e2) { classify(item, e2); }
    } else classify(item, e);
  }
  store.put(item);
  return item; // البايتات تبقى في المخزن في كل الحالات غير verified
}
