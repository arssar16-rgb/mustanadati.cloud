// مزامنة بيانات التنظيم المشفّرة بين الأجهزة عبر ملف meta.enc على Drive (تحكّم تفاؤلي بالإصدار).
import { sealJSON, openJSON } from './crypto.js';
import { mergeRecordSets, resolveConflict } from './merge.js';
import { NetworkError, VersionConflictError } from './errors.js';

const NAME = 'meta.enc';
const clone = (x) => JSON.parse(JSON.stringify(x));

export class LocalState {
  constructor() {
    this.records = {};      // ما أراه على هذا الجهاز
    this.base = {};         // آخر حالة اتفق عليها الجهاز مع Drive
    this.lastSyncAt = null; // يُعرض للمستخدم دائمًا عند البحث دون اتصال
    this.conflicts = [];    // تبقى حتى تختار
  }
}

export function applyResolution(state, conflict, choice) {
  state.records = resolveConflict(state.records, conflict, choice);
  state.conflicts = state.conflicts.filter((c) => !(c.id === conflict.id && c.field === conflict.field));
}

export async function syncMeta(drive, master, state, { now = () => new Date().toISOString() } = {}) {
  if (state.conflicts.length) return { status: 'conflicts', conflicts: state.conflicts, lastSyncAt: state.lastSyncAt };
  const offline = () => ({ status: 'offline', lastSyncAt: state.lastSyncAt });

  for (let attempt = 0; attempt < 3; attempt++) {
    let remote;
    try { remote = await drive.getNamed(NAME); }
    catch (e) { if (e instanceof NetworkError) return offline(); throw e; }

    const remoteRecords = remote ? (await openJSON(master, 'meta', remote.bytes)).records : {};
    const { merged, conflicts } = mergeRecordSets(state.base, state.records, remoteRecords);
    state.records = merged;

    if (conflicts.length) {
      // ما رأيناه من البعيد يصبح الأساس، فيبقى اختيارك «المحلي» تعديلًا محليًا صحيحًا في المزامنة التالية
      state.base = clone(remoteRecords);
      state.conflicts = conflicts;
      return { status: 'conflicts', conflicts, lastSyncAt: state.lastSyncAt };
    }
    try {
      const sealed = await sealJSON(master, 'meta', { records: merged });
      await drive.putNamed(NAME, sealed, { ifVersion: remote ? remote.version : null });
      state.base = clone(merged);
      state.lastSyncAt = now();
      return { status: 'synced', lastSyncAt: state.lastSyncAt };
    } catch (e) {
      if (e instanceof VersionConflictError) continue; // جهاز آخر سبقنا: أعد السحب والدمج
      if (e instanceof NetworkError) return offline();
      throw e;
    }
  }
  return { status: 'retry-later', lastSyncAt: state.lastSyncAt };
}
