// المرحلة 1: إعداد الخزنة، القفل، الاسترداد، وحفظ الوثائق مشفّرة على الجهاز.
// لا شبكة ولا Google في هذه المرحلة. كل نص يأتي من المستخدم يُعرض بـ textContent فقط.
import { IdbStore, Repo } from './js/core/store.js';
import { Vault, VaultError, pickChallenge, pinProblem, normalizePin, recoveryGroups } from './js/core/vault.js';

const $ = (id) => document.getElementById(id);
const store = new IdbStore();
const vault = new Vault(store);
let repo = null;
let pending = null;      // إعداد قيد التنفيذ: لا شيء محفوظ حتى التأكيد
let challenge = null;
let activeCategory = null;
let updateReady = false;
const hadController = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;

const HIDDEN_LOCK_MS = 60_000;
const IDLE_LOCK_MS = 300_000;
const SCREENS = ['scrBoot', 'scrWelcome', 'scrPin', 'scrRecovery', 'scrConfirm', 'scrLock', 'scrForgot', 'app'];
const fmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium' });

function showScreen(name) {
  for (const id of SCREENS) $(id).hidden = id !== name;
  document.body.classList.toggle('gated', name !== 'app');
  const first = { scrPin: 'pin1', scrConfirm: 'ansA', scrLock: 'unlockPin', scrForgot: 'fgKey' }[name];
  if (first) setTimeout(() => $(first).focus(), 50);
}
function setMsg(id, msg) { const e = $(id); e.textContent = msg || ''; e.hidden = !msg; }
function busy(btn, on, label) { btn.disabled = on; if (label) btn.dataset.label ??= btn.textContent; btn.textContent = on ? label : btn.dataset.label ?? btn.textContent; }
function newId() { return [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
function waitText(ms) {
  const s = Math.ceil(ms / 1000);
  return s < 60 ? `${s} ثانية` : `${Math.ceil(s / 60)} دقيقة`;
}
function pinMessage(code) {
  return { 'bad-pin-format': 'الرمز يجب أن يكون 6 أرقام بالضبط.', 'bad-pin-weak': 'الرمز سهل التخمين (أرقام متكررة أو متتالية). اختر رمزًا آخر.' }[code] || 'تعذّر قبول الرمز.';
}

// ---------- الإعداد ----------
$('btnStart').addEventListener('click', () => showScreen('scrPin'));

$('formPin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = normalizePin($('pin1').value), b = normalizePin($('pin2').value);
  const problem = pinProblem(a);
  if (problem) return setMsg('pinErr', pinMessage('bad-pin-' + problem));
  if (a !== b) return setMsg('pinErr', 'الرمزان غير متطابقين.');
  setMsg('pinErr', '');
  busy($('btnPin'), true, 'جارٍ إنشاء المفاتيح…');
  try {
    pending = await vault.prepareSetup(a);
    renderRecoveryKey(pending.recoveryText);
    $('pin1').value = $('pin2').value = '';
    $('recAck').checked = false; $('btnRecNext').disabled = true; $('copyMsg').hidden = true;
    showScreen('scrRecovery');
  } catch (err) {
    setMsg('pinErr', err instanceof VaultError ? pinMessage(err.code) : 'حدث خطأ غير متوقع: ' + err.message);
  } finally { busy($('btnPin'), false); }
});

function renderRecoveryKey(text) {
  const box = $('recKey'); box.replaceChildren();
  recoveryGroups(text).forEach((g, i) => {
    const s = document.createElement('span');
    const n = document.createElement('small'); n.textContent = String(i + 1);
    s.append(n, g);
    box.append(s);
  });
}
$('btnCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(pending.recoveryText); $('copyMsg').hidden = false; }
  catch { $('copyMsg').textContent = 'تعذّر النسخ. اكتبه يدويًا.'; $('copyMsg').hidden = false; }
});
$('recAck').addEventListener('change', (e) => { $('btnRecNext').disabled = !e.target.checked; });
$('btnRecNext').addEventListener('click', () => {
  challenge = pickChallenge(pending.recoveryText);
  $('chA').textContent = String(challenge[0] + 1); $('chB').textContent = String(challenge[1] + 1);
  $('ansA').value = $('ansB').value = ''; setMsg('confErr', '');
  showScreen('scrConfirm');
});
$('btnConfBack').addEventListener('click', () => showScreen('scrRecovery'));

$('formConfirm').addEventListener('submit', async (e) => {
  e.preventDefault();
  busy($('btnConf'), true, 'جارٍ الحفظ…');
  try {
    await vault.finishSetup(pending, challenge, [$('ansA').value, $('ansB').value]);
    pending = null; challenge = null;
    $('recKey').replaceChildren();
    repo = await Repo.open(store, vault.master);
    if (!repo.list().length) await repo.putMany(demoDocs());
    try { await navigator.storage?.persist?.(); } catch { /* اختياري */ }
    enterApp();
  } catch (err) {
    setMsg('confErr', err instanceof VaultError && err.code === 'bad-answers'
      ? 'غير مطابق. راجع ورقتك (تذكّر: لا يوجد صفر في المفتاح، والحرف O هو حرف).' : 'حدث خطأ: ' + err.message);
  } finally { busy($('btnConf'), false); }
});

function demoDocs() {
  const d = (id, name, category, tags, text, date) => [id, { name: name + ' (وهمي)', category, tags, text, date, demo: true }];
  return [
    d('d1', 'عقد إيجار الشقة', 'عقود', ['سكن', 'إيجار'], 'عقد إيجار سنوي بمبلغ 36000 ريال يبدأ في يناير', '2026-01-10'),
    d('d2', 'فاتورة الكهرباء — أكتوبر', 'فواتير', ['كهرباء'], 'فاتورة شهر أكتوبر المبلغ المستحق 412 ريالًا', '2026-02-01'),
    d('d3', 'فاتورة الماء — أكتوبر', 'فواتير', ['ماء'], 'فاتورة شهر أكتوبر المبلغ المستحق 80 ريالًا', '2026-03-01'),
    d('d4', 'صورة جواز السفر', 'هوية', ['سفر'], 'جواز سفر المملكة العربية السعودية', '2025-06-01'),
    d('d5', 'تقرير طبي', 'صحة', ['تقرير'], 'تقرير فحص دوري وتوصيات المتابعة', '2026-04-01'),
    d('d6', 'وثيقة تأمين السيارة', 'تأمين', ['سيارة'], 'وثيقة تأمين شامل تنتهي في مارس', '2026-03-15'),
    d('d7', 'شهادة تخرج', 'شهادات', ['تعليم'], 'شهادة البكالوريوس تقدير جيد جدًا', '2024-07-01'),
  ];
}

// ---------- القفل والفتح ----------
$('formUnlock').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = $('unlockPin').value;
  $('unlockPin').value = '';
  busy($('btnUnlock'), true, 'جارٍ الفتح…');
  try {
    await vault.unlock(pin);
    repo = await Repo.open(store, vault.master);
    setMsg('unlockErr', '');
    enterApp();
  } catch (err) {
    if (err instanceof VaultError && err.code === 'bad-pin') {
      setMsg('unlockErr', err.info.retryInMs
        ? `الرمز غير صحيح. محاولات كثيرة — انتظر ${waitText(err.info.retryInMs)}.`
        : `الرمز غير صحيح. تبقّى ${err.info.attemptsLeft} محاولات قبل التأخير.`);
    } else if (err instanceof VaultError && err.code === 'locked') {
      setMsg('unlockErr', `محاولات كثيرة. انتظر ${waitText(err.info.retryInMs)} ثم حاول.`);
    } else {
      vault.lock();
      setMsg('unlockErr', 'تعذّر فتح البيانات: ' + err.message);
    }
  } finally { busy($('btnUnlock'), false); }
});

$('btnForgot').addEventListener('click', () => { setMsg('fgErr', ''); showScreen('scrForgot'); });
$('btnFgBack').addEventListener('click', () => showScreen('scrLock'));
$('formForgot').addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = normalizePin($('fgPin1').value), b = normalizePin($('fgPin2').value);
  const problem = pinProblem(a);
  if (problem) return setMsg('fgErr', pinMessage('bad-pin-' + problem));
  if (a !== b) return setMsg('fgErr', 'الرمزان غير متطابقين.');
  busy($('btnFg'), true, 'جارٍ الاسترداد…');
  try {
    await vault.recover($('fgKey').value, a);
    repo = await Repo.open(store, vault.master);
    $('fgKey').value = $('fgPin1').value = $('fgPin2').value = '';
    setMsg('fgErr', '');
    enterApp();
  } catch (err) {
    setMsg('fgErr', err instanceof VaultError
      ? (err.code === 'bad-recovery' ? 'مفتاح الاسترداد غير صحيح. راجع الحروف.' : pinMessage(err.code))
      : 'حدث خطأ: ' + err.message);
  } finally { busy($('btnFg'), false); }
});

function lockApp() {
  vault.lock();
  repo = null;
  $('q').value = ''; activeCategory = null;
  for (const id of ['results', 'chips']) $(id).replaceChildren();
  $('resultsSection').hidden = true;
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  if (updateReady) { location.reload(); return; }
  showScreen('scrLock');
}

// ---------- القفل التلقائي ----------
let hiddenAt = 0, idleTimer = null;
function bumpIdle() {
  clearTimeout(idleTimer);
  if (vault.unlocked) idleTimer = setTimeout(() => vault.unlocked && lockApp(), IDLE_LOCK_MS);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (vault.unlocked && hiddenAt && Date.now() - hiddenAt > HIDDEN_LOCK_MS) lockApp();
  hiddenAt = 0;
});
for (const ev of ['pointerdown', 'keydown', 'scroll']) addEventListener(ev, bumpIdle, { passive: true });

// ---------- الشاشة الرئيسية ----------
function enterApp() {
  renderChips(); renderStats(); renderResults();
  showScreen('app');
  bumpIdle();
}
function el(tag, props = {}, ...kids) { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; }

function renderStats() {
  const docs = repo.list();
  $('sDocs').textContent = String(docs.length);
  $('sCats').textContent = String(new Set(docs.map((d) => d.category).filter(Boolean)).size);
  $('sSync').textContent = 'لم تتم بعد';
  $('sPending').textContent = '0';
}
function renderChips() {
  const counts = new Map();
  for (const d of repo.list()) if (d.category) counts.set(d.category, (counts.get(d.category) || 0) + 1);
  const box = $('chips'); box.replaceChildren();
  if (!counts.size) box.append(el('div', { className: 'empty' }, 'لا توجد تصنيفات بعد'));
  for (const [cat, n] of counts) {
    const b = el('button', { type: 'button', className: 'chip' }, cat, el('b', {}, String(n)));
    b.setAttribute('aria-pressed', String(activeCategory === cat));
    b.addEventListener('click', () => { activeCategory = activeCategory === cat ? null : cat; renderChips(); renderResults(); });
    box.append(b);
  }
  const dl = $('catList'); dl.replaceChildren(...[...counts.keys()].map((c) => el('option', { value: c })));
}
function renderResults() {
  const q = $('q').value.trim();
  $('searchBox').classList.toggle('has-text', q.length > 0);
  const section = $('resultsSection');
  if (!q && !activeCategory) { section.hidden = true; return; }
  const { results, partial } = repo.search(q, { category: activeCategory });
  section.hidden = false;
  $('resultsTitle').textContent = results.length ? `النتائج (${results.length})` : 'النتائج';
  $('partialNote').hidden = !partial;
  const box = $('results'); box.replaceChildren();
  if (!results.length) { box.append(el('div', { className: 'empty' }, 'لا توجد مستندات مطابقة')); return; }
  for (const r of results) {
    const d = repo.get(r.id);
    const del = el('button', { type: 'button', className: 'del' }, 'حذف');
    del.setAttribute('aria-label', 'حذف ' + d.name);
    del.addEventListener('click', async () => {
      if (!confirm(`حذف «${d.name}» نهائيًا من هذا الجهاز؟`)) return;
      await repo.remove(d.id); renderChips(); renderStats(); renderResults();
    });
    const when = d.date ? fmt.format(new Date(d.date)) : '';
    box.append(el('article', { className: 'result' }, del,
      el('h3', {}, d.name),
      el('div', { className: 'meta' }, el('span', {}, d.category), el('span', {}, when),
        el('span', { className: 'tags' }, ...d.tags.map((t) => el('span', {}, t)))),
      d.text ? el('p', {}, d.text) : ''));
  }
}
$('q').addEventListener('input', renderResults);
$('clear').addEventListener('click', () => { $('q').value = ''; $('q').focus(); renderResults(); });
$('btnLockNow').addEventListener('click', lockApp);

// ---------- إضافة وثيقة ----------
for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => $(b.dataset.close).close());
$('btnAdd').addEventListener('click', () => {
  $('formAdd').reset(); setMsg('addErr', ''); $('dlgAdd').showModal(); $('dName').focus();
});
$('formAdd').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('dName').value.trim();
  if (!name) return setMsg('addErr', 'اسم الوثيقة مطلوب.');
  try {
    await repo.put(newId(), {
      name, category: $('dCat').value, text: $('dText').value, date: new Date().toISOString().slice(0, 10),
      tags: $('dTags').value.split(/[,،\n]/),
    });
    $('dlgAdd').close(); renderChips(); renderStats(); renderResults();
  } catch (err) { setMsg('addErr', 'تعذّر الحفظ: ' + err.message); }
});

// ---------- الإعدادات ----------
$('btnSettings').addEventListener('click', async () => {
  $('btnRemoveDemo').hidden = !repo.list().some((d) => d.demo);
  let p = null; try { p = await navigator.storage?.persisted?.(); } catch { /* غير مدعوم */ }
  $('persistMsg').textContent = p === true ? 'حماية التخزين من الحذف التلقائي: مفعّلة.'
    : p === false ? 'تنبيه: قد يحذف الجهاز بيانات التطبيق إن قلّت المساحة. أضِفه للشاشة الرئيسية، ولا تعتمد على هذه النسخة وحدها.' : '';
  $('dlgSettings').showModal();
});
$('btnRemoveDemo').addEventListener('click', async () => {
  const n = await repo.removeWhere((d) => d.demo);
  renderChips(); renderStats(); renderResults();
  $('btnRemoveDemo').hidden = true;
  $('persistMsg').textContent = `حُذفت ${n} وثائق تجريبية.`;
});
$('btnChangePin').addEventListener('click', () => {
  $('dlgSettings').close(); $('formChangePin').reset(); setMsg('npErr', ''); $('dlgPin').showModal(); $('np1').focus();
});
$('formChangePin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = normalizePin($('np1').value), b = normalizePin($('np2').value);
  const problem = pinProblem(a);
  if (problem) return setMsg('npErr', pinMessage('bad-pin-' + problem));
  if (a !== b) return setMsg('npErr', 'الرمزان غير متطابقين.');
  try { await vault.changePin(a); $('dlgPin').close(); $('formChangePin').reset(); }
  catch (err) { setMsg('npErr', 'تعذّر التغيير: ' + err.message); }
});
$('btnWipe').addEventListener('click', async () => {
  if (!confirm('سيُمسح كل ما على هذا الجهاز نهائيًا: الوثائق والمفاتيح. ولا توجد نسخة على Drive بعد، ومفتاح الاسترداد لا يعيد وثائق مُسحت. هل أنت متأكد؟')) return;
  if (!confirm('تأكيد أخير: مسح كل البيانات؟')) return;
  await vault.reset();
  location.reload();
});

// ---------- الإقلاع ----------
async function boot() {
  try {
    showScreen((await vault.isSetup()) ? 'scrLock' : 'scrWelcome');
  } catch (err) {
    $('spinner').hidden = true;
    $('bootMsg').textContent = 'التخزين المحلي غير متاح في هذا المتصفح (ربما التصفح الخاص). افتح التطبيق في Safari عاديًا. التفاصيل: ' + err.message;
  }
}
boot();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* التطبيق يعمل بدونه */ });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;           // أول تثبيت: لا حاجة لإعادة التحميل
    updateReady = true;
    if (!vault.unlocked) location.reload(); // وإلا يُطبَّق التحديث عند القفل القادم
  });
}
