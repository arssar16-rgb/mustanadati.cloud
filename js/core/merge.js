// دمج ثلاثي لبيانات التنظيم: الأساس (آخر حالة متزامنة) + المحلي + البعيد.
// التعديلات غير المتعارضة تُدمج تلقائيًا؛ المتعارضة تبقى في قائمة conflicts ولا تُحسم دون اختيارك.
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => (o[k] = sortKeys(v[k]), o), {}) : v;
export const deepEqual = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));

const SET_FIELDS = new Set(['tags']);

function mergeSet(b = [], l = [], r = []) {
  const B = new Set(b), L = new Set(l), R = new Set(r), out = [];
  for (const x of new Set([...B, ...L, ...R])) {
    if (B.has(x)) { if (L.has(x) && R.has(x)) out.push(x); }      // حذف أحد الطرفين يُنفَّذ
    else if (L.has(x) || R.has(x)) out.push(x);                    // إضافة أي طرف تُنفَّذ
  }
  return out.sort();
}

function mergeRecord(id, b, l, r, conflicts) {
  const out = {};
  const fields = new Set([...Object.keys(b || {}), ...Object.keys(l), ...Object.keys(r)]);
  for (const f of fields) {
    const bv = b?.[f], lv = l[f], rv = r[f];
    if (bv === undefined && lv === undefined && rv === undefined) continue;
    if (SET_FIELDS.has(f)) { out[f] = mergeSet(bv, lv, rv); continue; }
    if (deepEqual(lv, rv)) { if (lv !== undefined) out[f] = clone(lv); }
    else if (deepEqual(lv, bv)) { if (rv !== undefined) out[f] = clone(rv); }
    else if (deepEqual(rv, bv)) { if (lv !== undefined) out[f] = clone(lv); }
    else {
      conflicts.push({ id, field: f, base: clone(bv), local: clone(lv), remote: clone(rv) });
      if (lv !== undefined) out[f] = clone(lv); // قيمة مؤقتة للعرض فقط إلى أن تختار
    }
  }
  return out;
}

export function mergeRecordSets(base = {}, local = {}, remote = {}) {
  const merged = {}, conflicts = [];
  for (const id of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const b = base[id], l = local[id], r = remote[id];
    if (l && r) merged[id] = mergeRecord(id, b, l, r, conflicts);
    else if (!l && !r) continue;
    else {
      const side = l ? 'local' : 'remote';
      const rec = l || r;
      if (!b) merged[id] = clone(rec);                          // إضافة جديدة من طرف واحد
      else if (deepEqual(rec, b)) continue;                     // الطرف الآخر حذفها والطرف هذا لم يعدّلها ← حذف
      else {                                                    // حذف مقابل تعديل: لا نفقد بياناتك
        merged[id] = clone(rec);
        conflicts.push({ id, field: '__deleted__', base: clone(b),
          local: side === 'local' ? clone(rec) : null, remote: side === 'remote' ? clone(rec) : null });
      }
    }
  }
  return { merged, conflicts };
}

// اختيار الطرف الصحيح لتعارض واحد: choice = 'local' | 'remote'
export function resolveConflict(records, conflict, choice) {
  const out = clone(records);
  const value = conflict[choice];
  if (conflict.field === '__deleted__') {
    if (value === null) delete out[conflict.id]; else out[conflict.id] = clone(value);
  } else {
    out[conflict.id] ??= {};
    if (value === undefined) delete out[conflict.id][conflict.field];
    else out[conflict.id][conflict.field] = clone(value);
  }
  return out;
}
