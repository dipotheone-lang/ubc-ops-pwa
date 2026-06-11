/**
 * i18n.js — bilingual AR/EN strings + RTL direction control.
 * Arabic is the default (operational reality). Toggle persists in localStorage.
 */
(function () {
  'use strict';
  var STR = {
    en: {
      app: 'UBC Operations', login: 'Sign in', email: 'Email', password: 'Password',
      logout: 'Sign out', dashboard: 'Dashboard', approvals: 'Approvals', masters: 'Master Data',
      clients: 'Clients', suppliers: 'Suppliers', projects: 'Projects', admin: 'Administration',
      users: 'Users', settings: 'Settings', save: 'Save', cancel: 'Cancel', create: 'Create',
      add: 'Add', name_en: 'Name (EN)', name_ar: 'Name (AR)', sector: 'Sector', status: 'Status',
      code: 'Code', client: 'Client', value: 'Contract Value', currency: 'Currency',
      pending_approvals: 'Pending approvals', approve: 'Approve', reject: 'Reject', comment: 'Comment',
      amount: 'Amount', domain: 'Domain', initiator: 'Initiator', step: 'Step', role: 'Role',
      assign_role: 'Assign role', temp_password: 'Temporary password', change_password: 'Change password',
      old_password: 'Current password', new_password: 'New password', welcome: 'Welcome',
      no_records: 'No records.', loading: 'Loading…', signing_in: 'Signing in…', server_url: 'API URL (/exec)',
      must_reset: 'You must set a new password before continuing.', supplier: 'Supplier', project: 'Project',
      full_name: 'Full name', role_label: 'Role', create_user: 'Create user', actions: 'Actions',
      lang_toggle: 'العربية', online: 'Online', offline: 'Offline', authority: 'Authority Matrix (DoA)'
    },
    ar: {
      app: 'عمليات الأخوة المتحدين', login: 'تسجيل الدخول', email: 'البريد الإلكتروني', password: 'كلمة المرور',
      logout: 'تسجيل الخروج', dashboard: 'الرئيسية', approvals: 'الموافقات', masters: 'البيانات الأساسية',
      clients: 'العملاء', suppliers: 'الموردون', projects: 'المشاريع', admin: 'الإدارة',
      users: 'المستخدمون', settings: 'الإعدادات', save: 'حفظ', cancel: 'إلغاء', create: 'إنشاء',
      add: 'إضافة', name_en: 'الاسم (إنجليزي)', name_ar: 'الاسم (عربي)', sector: 'القطاع', status: 'الحالة',
      code: 'الكود', client: 'العميل', value: 'قيمة العقد', currency: 'العملة',
      pending_approvals: 'الموافقات المعلقة', approve: 'اعتماد', reject: 'رفض', comment: 'تعليق',
      amount: 'المبلغ', domain: 'النوع', initiator: 'مقدم الطلب', step: 'الخطوة', role: 'الدور',
      assign_role: 'إسناد دور', temp_password: 'كلمة مرور مؤقتة', change_password: 'تغيير كلمة المرور',
      old_password: 'كلمة المرور الحالية', new_password: 'كلمة المرور الجديدة', welcome: 'أهلاً',
      no_records: 'لا توجد سجلات.', loading: 'جارٍ التحميل…', signing_in: 'جارٍ تسجيل الدخول…', server_url: 'رابط الخادم (‎/exec‎)',
      must_reset: 'يجب تعيين كلمة مرور جديدة قبل المتابعة.', supplier: 'مورد', project: 'مشروع',
      full_name: 'الاسم الكامل', role_label: 'الدور', create_user: 'إنشاء مستخدم', actions: 'إجراءات',
      lang_toggle: 'English', online: 'متصل', offline: 'غير متصل', authority: 'مصفوفة الصلاحيات'
    }
  };

  var lang = localStorage.getItem('ubc_lang') || 'ar';

  function t(key) { return (STR[lang] && STR[lang][key]) || (STR.en[key]) || key; }
  function setLang(l) {
    lang = (l === 'ar') ? 'ar' : 'en';
    localStorage.setItem('ubc_lang', lang);
    applyDir();
  }
  function toggle() { setLang(lang === 'ar' ? 'en' : 'ar'); }
  function current() { return lang; }
  function applyDir() {
    document.documentElement.lang = lang;
    document.documentElement.dir = (lang === 'ar') ? 'rtl' : 'ltr';
  }
  /** Pick the right bilingual field from a record (…_ar / …_en). */
  function pick(rec, base) {
    if (!rec) return '';
    var ar = rec[base + '_ar'], en = rec[base + '_en'];
    if (lang === 'ar') return ar || en || '';
    return en || ar || '';
  }

  window.I18N = { t: t, setLang: setLang, toggle: toggle, current: current, applyDir: applyDir, pick: pick };
})();
