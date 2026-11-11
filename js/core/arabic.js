// تطبيع النص العربي للبحث: يتجاهل التشكيل والتطويل واختلاف الهمزات والتاء المربوطة والأرقام الهندية
const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭ]/g;

export function normalizeArabic(input = '') {
  return String(input)
    .normalize('NFKC') // يفكّ أشكال العرض (ﻻ ← لا) التي تأتي من OCR وPDF
    .toLowerCase()
    .replace(TASHKEEL, '')
    .replace(/ـ/g, '')
    .replace(/[آأإٱ]/g, 'ا') // آ أ إ ٱ ← ا
    .replace(/[ىئی]/g, 'ي')        // ى ئ ی ← ي
    .replace(/ؤ/g, 'و')                      // ؤ ← و
    .replace(/ة/g, 'ه')                      // ة ← ه
    .replace(/ک/g, 'ك')                      // ک ← ك
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
}

export const tokenize = (s) => normalizeArabic(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

const stripAl = (t) => (t.length > 4 && t.startsWith('ال') ? t.slice(2) : t);

// الفهرس يحفظ الكلمة وصورتها دون «ال»؛ الاستعلام يستخدم الصورة دون «ال» فقط
export function indexTokens(s) {
  const out = [];
  for (const t of tokenize(s)) { out.push(t); const b = stripAl(t); if (b !== t) out.push(b); }
  return out;
}
export const queryTokens = (s) => tokenize(s).map(stripAl);
