// تنظيف الملفات المؤقتة المحلية: بعد التحقق من اكتمال الرفع فقط، ولا يمس المعلّق ولا الفهرس.
export async function cleanupTemp(drive, store) {
  const removed = [], kept = [];
  for (const it of store.list()) {
    if (it.kind === 'index') { kept.push({ id: it.id, reason: 'index-protected' }); continue; }
    if (it.state !== 'verified') { kept.push({ id: it.id, reason: 'not-verified:' + it.state }); continue; }
    let st = null;
    try { st = await drive.stat(it.remoteId); } catch { kept.push({ id: it.id, reason: 'remote-unreachable' }); continue; }
    // إعادة تحقق مستقلة من Drive قبل الحذف: وجود الملف وحجمه وبصمته
    if (!st || st.size !== it.bytes.length || st.sha256 !== it.sha256) { kept.push({ id: it.id, reason: 'remote-mismatch' }); continue; }
    store.delete(it.id);
    removed.push(it.id);
  }
  return { removed, kept };
}
