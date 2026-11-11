// فهرس البحث: الأسماء والتصنيفات والوسوم ومحتوى OCR. الترتيب: الارتباط ثم التاريخ (الأحدث أولًا).
import { indexTokens, queryTokens, normalizeArabic } from './arabic.js';
import { sealJSON, openJSON } from './crypto.js';

const WEIGHTS = { name: 5, tags: 4, category: 3, text: 1 };
const PREFIX_FACTOR = 0.6;

function tf(s) {
  const m = {};
  for (const t of indexTokens(s || '')) m[t] = (m[t] || 0) + 1;
  return m;
}

function hitCount(field, tok) {
  let hits = field[tok] || 0;
  if (tok.length >= 2) {
    for (const k in field) if (k !== tok && k.startsWith(tok)) hits += PREFIX_FACTOR * field[k];
  }
  return hits;
}

export class SearchIndex {
  constructor() { this.docs = new Map(); }
  get size() { return this.docs.size; }

  upsert(d) {
    this.docs.set(d.id, {
      id: d.id, date: d.date || '',
      category: normalizeArabic(d.category || ''),
      f: { name: tf(d.name), category: tf(d.category), tags: tf((d.tags || []).join(' ')), text: tf(d.text) },
    });
  }
  remove(id) { this.docs.delete(id); }

  search(query, { category = null, limit = 50 } = {}) {
    const cat = category ? normalizeArabic(category) : null;
    const pool = [...this.docs.values()].filter((d) => !cat || d.category === cat);
    const byDate = (a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : a.id < b.id ? -1 : 1);
    const q = [...new Set(queryTokens(query))];

    if (!q.length) { // تصفّح بلا استعلام: الأحدث أولًا
      return { results: pool.sort(byDate).slice(0, limit).map((d) => ({ id: d.id, score: 0, fields: [] })), partial: false };
    }

    // مصفوفة الإصابات لكل مستند ولكل كلمة
    const rows = pool.map((d) => {
      const perTok = q.map((tok) => {
        let s = 0; const fields = [];
        for (const [fname, w] of Object.entries(WEIGHTS)) {
          const h = hitCount(d.f[fname], tok);
          if (h > 0) { s += w * (1 + Math.log(h)); fields.push(fname); }
        }
        return { s, fields };
      });
      return { d, perTok };
    });
    const idf = q.map((_, i) => {
      const df = rows.filter((r) => r.perTok[i].s > 0).length;
      return Math.log(1 + rows.length / Math.max(df, 1));
    });

    const run = (mode) => rows
      .filter((r) => (mode === 'all' ? r.perTok.every((p) => p.s > 0) : r.perTok.some((p) => p.s > 0)))
      .map((r) => ({
        d: r.d,
        score: Math.round(r.perTok.reduce((a, p, i) => a + p.s * idf[i], 0) * 1e6) / 1e6,
        fields: [...new Set(r.perTok.flatMap((p) => p.fields))],
      }));

    let partial = false;
    let hits = run('all');
    if (!hits.length && q.length > 1) { hits = run('any'); partial = hits.length > 0; }
    hits.sort((a, b) => b.score - a.score || byDate(a.d, b.d));
    return { results: hits.slice(0, limit).map((h) => ({ id: h.d.id, score: h.score, fields: h.fields })), partial };
  }

  toJSON() { return { v: 1, docs: [...this.docs.values()] }; }
  static fromJSON(o) {
    const idx = new SearchIndex();
    for (const d of o.docs) idx.docs.set(d.id, d);
    return idx;
  }
}

// الفهرس يُحفظ مشفّرًا ولا يغادر الجهاز إلا مشفّرًا
export const sealIndex = (master, index) => sealJSON(master, 'search-index', index.toJSON());
export async function openIndex(master, sealed) {
  return SearchIndex.fromJSON(await openJSON(master, 'search-index', sealed));
}
