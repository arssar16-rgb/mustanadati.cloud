// التخزين المحلي: واجهة واحدة (get/put/delete/keys/clear) بنسختين: ذاكرة للاختبار وIndexedDB للمتصفح.
// بيانات المستخدم (الوثائق والفهرس) تُحفظ مشفّرة بالمفتاح الرئيسي دائمًا.
import { sealJSON, openJSON } from './crypto.js';
import { SearchIndex, sealIndex, openIndex } from './search.js';

export class MemoryStore {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.has(k) ? this.m.get(k) : undefined; }
  async put(k, v) { this.m.set(k, v); }
  async delete(k) { this.m.delete(k); }
  async keys() { return [...this.m.keys()]; }
  async clear() { this.m.clear(); }
}

export class IdbStore {
  constructor(name = 'mustanadati') { this.name = name; this._p = null; }
  _db() {
    if (!this._p) {
      this._p = new Promise((resolve, reject) => {
        const r = indexedDB.open(this.name, 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error || new Error('تعذّر فتح التخزين المحلي'));
        r.onblocked = () => reject(new Error('التخزين المحلي محجوب'));
      });
    }
    return this._p;
  }
  async _run(mode, fn) {
    const db = await this._db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('أُلغيت عملية الحفظ'));
    });
  }
  get(k) { return this._run('readonly', (s) => s.get(k)); }
  put(k, v) { return this._run('readwrite', (s) => s.put(v, k)); }
  delete(k) { return this._run('readwrite', (s) => s.delete(k)); }
  keys() { return this._run('readonly', (s) => s.getAllKeys()); }
  clear() { return this._run('readwrite', (s) => s.clear()); }
}

const clean = (r) => ({
  name: String(r.name ?? '').trim(),
  category: String(r.category ?? '').trim(),
  tags: [...new Set((r.tags || []).map((t) => String(t).trim()).filter(Boolean))],
  text: String(r.text ?? ''),
  date: String(r.date ?? ''),
  ...(r.demo ? { demo: true } : {}),
});

// مستودع الوثائق: السجلات والفهرس في الذاكرة بعد الفتح، ويُحفظان مشفّرين عند كل تعديل.
// صيغة meta.enc هي نفسها التي ستُرفع لاحقًا إلى Drive (التسمية 'meta')، فلا تحويل عند المزامنة.
export class Repo {
  constructor(store, master) {
    this.store = store;
    this.master = master;
    this.records = {};
    this.index = new SearchIndex();
  }
  static async open(store, master) {
    const r = new Repo(store, master);
    await r.load();
    return r;
  }
  _rebuild() {
    const idx = new SearchIndex();
    for (const [id, r] of Object.entries(this.records)) idx.upsert({ id, ...r });
    return idx;
  }
  async load() {
    const sealed = await this.store.get('meta.enc');
    // فشل فك التشفير هنا يُرمى ولا يُبتلع: لا نعتبر البيانات فارغة بالخطأ
    this.records = sealed ? (await openJSON(this.master, 'meta', sealed)).records : {};
    let idx = null;
    const si = await this.store.get('index.enc');
    if (si) { try { idx = await openIndex(this.master, si); } catch { idx = null; } }
    // الفهرس مشتقّ من السجلات: إن غاب أو فسد أو لم يطابق عددها يُعاد بناؤه
    if (!idx || idx.size !== Object.keys(this.records).length) idx = this._rebuild();
    this.index = idx;
  }
  async persist() {
    await this.store.put('meta.enc', await sealJSON(this.master, 'meta', { records: this.records }));
    await this.store.put('index.enc', await sealIndex(this.master, this.index));
  }
  list() { return Object.entries(this.records).map(([id, r]) => ({ id, ...r })); }
  get(id) { return this.records[id] ? { id, ...this.records[id] } : null; }
  async putMany(entries) {
    for (const [id, rec] of entries) {
      const c = clean(rec);
      if (!c.name) throw new Error('اسم الوثيقة مطلوب');
      this.records[id] = c;
      this.index.upsert({ id, ...c });
    }
    await this.persist();
  }
  put(id, rec) { return this.putMany([[id, rec]]); }
  async removeWhere(pred) {
    let n = 0;
    for (const [id, r] of Object.entries(this.records)) {
      if (pred({ id, ...r })) { delete this.records[id]; this.index.remove(id); n++; }
    }
    if (n) await this.persist();
    return n;
  }
  remove(id) { return this.removeWhere((r) => r.id === id); }
  async replaceAll(records) {
    this.records = {};
    for (const [id, r] of Object.entries(records)) this.records[id] = clean(r);
    this.index = this._rebuild();
    await this.persist();
  }
  search(q, opts) { return this.index.search(q, opts); }
}
