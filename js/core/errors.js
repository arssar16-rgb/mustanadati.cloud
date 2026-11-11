// أخطاء مشتركة بين النواة والمحاكي والمهايئ الحقيقي لاحقًا
export class NetworkError extends Error {
  constructor(m = 'انقطع الاتصال') { super(m); this.name = 'NetworkError'; }
}
export class DriveFullError extends Error {
  constructor(m = 'مساحة Google Drive ممتلئة') { super(m); this.name = 'DriveFullError'; }
}
export class SessionExpiredError extends Error {
  constructor(m = 'انتهت جلسة الرفع') { super(m); this.name = 'SessionExpiredError'; }
}
export class VersionConflictError extends Error {
  constructor(m = 'تغيّر الملف على Drive أثناء الحفظ') { super(m); this.name = 'VersionConflictError'; }
}
export class VerifyError extends Error {
  constructor(m = 'فشل التحقق من اكتمال الرفع') { super(m); this.name = 'VerifyError'; }
}
export class CryptoError extends Error {
  constructor(m = 'فشل فك التشفير: مفتاح خاطئ أو بيانات معدَّلة') { super(m); this.name = 'CryptoError'; }
}
