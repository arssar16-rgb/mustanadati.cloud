// محاكي Google Drive في الذاكرة للاختبار: حصة تخزين، انقطاع، انتهاء جلسة، فساد عند الإنهاء.
// المهايئ الحقيقي (المرحلة 4) سيطبّق الواجهة نفسها فوق Drive REST.
import { NetworkError, DriveFullError, SessionExpiredError, VersionConflictError } from '../core/errors.js';
import { sha256Hex, concat } from '../core/crypto.js';

let seq = 0;

export class MockDrive {
  constructor({ quotaBytes = Infinity } = {}) {
    this.quotaBytes = quotaBytes;
    this.online = true;
    this.files = new Map();
    this.sessions = new Map();
    this.named = new Map();
    this.dropAfterChunks = null; // n: يسمح بـ n مقاطع ثم ينقطع الاتصال مرة واحدة
    this.corruptFinalize = false;
  }
  _net() { if (!this.online) throw new NetworkError(); }
  get used() {
    let u = 0;
    for (const f of this.files.values()) u += f.bytes.length;
    for (const n of this.named.values()) u += n.bytes.length;
    return u;
  }
  async startSession({ name, size }) {
    this._net();
    if (this.used + size > this.quotaBytes) throw new DriveFullError();
    const id = 's' + (++seq);
    this.sessions.set(id, { id, name, size, received: 0, chunks: [] });
    return id;
  }
  async queryOffset(id) {
    this._net();
    const s = this.sessions.get(id);
    if (!s) throw new SessionExpiredError();
    return s.received;
  }
  async putChunk(id, offset, bytes) {
    this._net();
    const s = this.sessions.get(id);
    if (!s) throw new SessionExpiredError();
    if (this.dropAfterChunks !== null) {
      if (this.dropAfterChunks === 0) { this.dropAfterChunks = null; throw new NetworkError('انقطع الاتصال أثناء الرفع'); }
      this.dropAfterChunks--;
    }
    if (offset !== s.received) throw new Error('عدم تطابق موضع الرفع');
    if (this.used + s.received + bytes.length > this.quotaBytes) throw new DriveFullError();
    s.chunks.push(bytes);
    s.received += bytes.length;
    return { received: s.received };
  }
  async finalize(id) {
    this._net();
    const s = this.sessions.get(id);
    if (!s) throw new SessionExpiredError();
    let bytes = concat(...s.chunks);
    if (this.corruptFinalize) { bytes = bytes.slice(); bytes[0] ^= 1; }
    const fid = 'f' + (++seq);
    this.files.set(fid, { id: fid, name: s.name, bytes });
    this.sessions.delete(id);
    return { id: fid, size: bytes.length, sha256: await sha256Hex(bytes) };
  }
  async stat(id) {
    this._net();
    const f = this.files.get(id);
    return f ? { id, size: f.bytes.length, sha256: await sha256Hex(f.bytes) } : null;
  }
  async download(id) { this._net(); return this.files.get(id)?.bytes.slice() ?? null; }
  async getNamed(name) {
    this._net();
    const n = this.named.get(name);
    return n ? { bytes: n.bytes.slice(), version: n.version } : null;
  }
  async putNamed(name, bytes, { ifVersion = null } = {}) {
    this._net();
    const cur = this.named.get(name);
    if ((cur ? cur.version : null) !== ifVersion) throw new VersionConflictError();
    const others = this.used - (cur ? cur.bytes.length : 0);
    if (others + bytes.length > this.quotaBytes) throw new DriveFullError();
    const version = (cur ? cur.version : 0) + 1;
    this.named.set(name, { bytes: bytes.slice(), version });
    return { version };
  }
  expireSession(id) { this.sessions.delete(id); }
}
