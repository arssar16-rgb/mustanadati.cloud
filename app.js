// واجهة الأساس: بحث عربي محلي على بيانات وهمية. لا شبكة ولا حساب Google في هذه المرحلة.
import { SearchIndex } from './js/core/search.js';

const DEMO_DOCS = [
  { id: 'd1', name: 'عقد إيجار الشقة (وهمي)', category: 'عقود', tags: ['سكن', 'إيجار'], text: 'عقد إيجار سنوي بمبلغ 36000 ريال يبدأ في يناير', date: '2026-01-10' },
  { id: 'd2', name: 'فاتورة الكهرباء — أكتوبر (وهمي)', category: 'فواتير', tags: ['كهرباء'], text: 'فاتورة شهر أكتوبر المبلغ المستحق 412 ريالًا', date: '2026-02-01' },
  { id: 'd3', name: 'فاتورة الماء — أكتوبر (وهمي)', category: 'فواتير', tags: ['ماء'], text: 'فاتورة شهر أكتوبر المبلغ المستحق 80 ريالًا', date: '2026-03-01' },
  { id: 'd4', name: 'صورة جواز السفر (وهمي)', category: 'هوية', tags: ['سفر'], text: 'جواز سفر المملكة العربية السعودية', date: '2025-06-01' },
  { id: 'd5', name: 'تقرير طبي (وهمي)', category: 'صحة', tags: ['تقرير'], text: 'تقرير فحص دوري وتوصيات المتابعة', date: '2026-04-01' },
  { id: 'd6', name: 'وثيقة تأمين السيارة (وهمي)', category: 'تأمين', tags: ['سيارة'], text: 'وثيقة تأمين شامل تنتهي في مارس', date: '2026-03-15' },
  { id: 'd7', name: 'شهادة تخرج (وهمي)', category: 'شهادات', tags: ['تعليم'], text: 'شهادة البكالوريوس تقدير جيد جدًا', date: '2024-07-01' },
];

const $ = (id) => document.getElementById(id);
const fmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium' });
const index = new SearchIndex();
const byId = new Map(DEMO_DOCS.map((d) => [d.id, d]));
DEMO_DOCS.forEach((d) => index.upsert(d));

let activeCategory = null;

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

function renderStats() {
  $('sDocs').textContent = String(DEMO_DOCS.length);
  $('sCats').textContent = String(new Set(DEMO_DOCS.map((d) => d.category)).size);
  $('sSync').textContent = 'لم تتم بعد';
  $('sPending').textContent = '0';
}

function renderChips() {
  const counts = new Map();
  DEMO_DOCS.forEach((d) => counts.set(d.category, (counts.get(d.category) || 0) + 1));
  const box = $('chips'); box.replaceChildren();
  for (const [cat, n] of counts) {
    const b = el('button', { type: 'button', className: 'chip' }, cat, el('b', {}, String(n)));
    b.setAttribute('aria-pressed', String(activeCategory === cat));
    b.addEventListener('click', () => { activeCategory = activeCategory === cat ? null : cat; renderChips(); renderResults(); });
    box.append(b);
  }
}

function renderResults() {
  const q = $('q').value.trim();
  $('searchBox').classList.toggle('has-text', q.length > 0);
  const section = $('resultsSection');
  if (!q && !activeCategory) { section.hidden = true; return; }
  const { results, partial } = index.search(q, { category: activeCategory });
  section.hidden = false;
  $('resultsTitle').textContent = results.length ? `النتائج (${results.length})` : 'النتائج';
  $('partialNote').hidden = !partial;
  const box = $('results'); box.replaceChildren();
  if (!results.length) { box.append(el('div', { className: 'empty' }, 'لا توجد مستندات مطابقة')); return; }
  for (const r of results) {
    const d = byId.get(r.id);
    box.append(el('article', { className: 'result' },
      el('h3', {}, d.name),
      el('div', { className: 'meta' }, el('span', {}, d.category), el('span', {}, fmt.format(new Date(d.date))),
        el('span', { className: 'tags' }, ...d.tags.map((t) => el('span', {}, t)))),
      el('p', {}, d.text)));
  }
}

$('q').addEventListener('input', renderResults);
$('clear').addEventListener('click', () => { $('q').value = ''; $('q').focus(); renderResults(); });
renderStats(); renderChips();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* التطبيق يعمل بدونه */ });
}
