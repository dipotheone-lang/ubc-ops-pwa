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
      lang_toggle: 'العربية', online: 'Online', offline: 'Offline', authority: 'Authority Matrix (DoA)',
      procurement: 'Procurement', warehouse: 'Warehouse', finance: 'Finance', techoffice: 'Technical Office',
      submit: 'Submit for approval', new_doc: 'New', records: 'Records', line_items: 'Line items', add_line: '+ Add line',
      mr: 'Material Requisition', po: 'Purchase Order', grn: 'Goods Received', miv: 'Material Issue', stock: 'Stock',
      pv: 'Payment Voucher', rv: 'Receipt Voucher', expense: 'Expense', charter: 'Project Charter', vor: 'Variation Order',
      ipc: 'Interim Payment Cert', ncr: 'NCR', total: 'Total', date: 'Date', priority: 'Priority', submitted: 'Submitted ✓',
      view_approval: 'Approval', remove: 'Remove',
      bd: 'Business Dev', tendering: 'Tendering', construction: 'Construction', correspondence: 'Correspondence', prequal: 'Prequalification',
      opp: 'Opportunity', interaction: 'Interaction', tender: 'Tender', dsr: 'Daily Report', si: 'Site Instruction',
      letter: 'Letter', prq: 'Prequalification', award: 'Award', mark_lost: 'Mark Lost', won: 'Won', issue: 'Issue', advance: 'Advance',
      hr: 'Human Resources', assets: 'Asset & Equipment', assets_m: 'Asset & Equipment', hse: 'HSE',
      employee: 'Employee', leave: 'Leave', timesheet: 'Timesheet', appraisal: 'Appraisal',
      asset: 'Asset', maintenance: 'Maintenance', calibration: 'Calibration',
      hira: 'Risk Assessment', permit: 'Permit to Work', incident: 'Incident', inspection: 'Inspection',
      grp_commercial: 'Sales & Commercial', grp_projects: 'Projects & Delivery', grp_supply: 'Supply Chain',
      grp_finance: 'Finance', grp_people: 'People & Safety', grp_office: 'Office', grp_admin: 'Administration',
      notifications: 'Notifications', mark_all_read: 'Mark all read', no_notifications: 'No notifications',
      just_now: 'just now', m_ago: 'm', h_ago: 'h', d_ago: 'd', recent_activity: 'Recent activity', no_kpis: 'No metrics available yet.',
      stage: 'Stage', category: 'Category', roles: 'Roles', permissions: 'Permissions', permission: 'Permission',
      module: 'Module', entity: 'Entity', action: 'Action', scope: 'Scope', min: 'Min', max: 'Max',
      description: 'Description', signer_chain: 'Signer chain', bad_json: 'Invalid JSON', manage_roles: 'Manage roles',
      reset_password: 'Reset password', deactivate: 'Deactivate', activate: 'Activate', edit: 'Edit', phone: 'Phone',
      title: 'Title', language: 'Language', active_y: 'Active', inactive_y: 'Inactive', revoke: 'Revoke',
      lookups: 'Lookups', audit: 'Audit log', temp_pw_hint: 'Share this with the user — they must change it on first login.'
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
      lang_toggle: 'English', online: 'متصل', offline: 'غير متصل', authority: 'مصفوفة الصلاحيات',
      procurement: 'المشتريات', warehouse: 'المخازن', finance: 'المالية', techoffice: 'المكتب الفني',
      submit: 'إرسال للاعتماد', new_doc: 'جديد', records: 'السجلات', line_items: 'البنود', add_line: '+ إضافة بند',
      mr: 'طلب شراء', po: 'أمر توريد', grn: 'إذن استلام', miv: 'إذن صرف', stock: 'المخزون',
      pv: 'إذن صرف نقدي', rv: 'إذن استلام نقدي', expense: 'مصروف', charter: 'ميثاق المشروع', vor: 'أمر تغيير',
      ipc: 'مستخلص', ncr: 'تقرير عدم مطابقة', total: 'الإجمالي', date: 'التاريخ', priority: 'الأولوية', submitted: 'تم الإرسال ✓',
      view_approval: 'الاعتماد', remove: 'حذف',
      bd: 'تطوير الأعمال', tendering: 'العطاءات', construction: 'الإنشاءات', correspondence: 'المراسلات', prequal: 'التأهيل',
      opp: 'فرصة', interaction: 'تواصل', tender: 'عطاء', dsr: 'تقرير يومي', si: 'تعليمات موقع',
      letter: 'خطاب', prq: 'تأهيل', award: 'ترسية', mark_lost: 'خسارة', won: 'فوز', issue: 'إصدار', advance: 'ترقية',
      hr: 'الموارد البشرية', assets: 'الأصول والمعدات', assets_m: 'الأصول والمعدات', hse: 'السلامة والصحة المهنية',
      employee: 'موظف', leave: 'إجازة', timesheet: 'سجل الحضور', appraisal: 'تقييم أداء',
      asset: 'أصل', maintenance: 'صيانة', calibration: 'معايرة',
      hira: 'تقييم المخاطر', permit: 'تصريح عمل', incident: 'حادث', inspection: 'تفتيش',
      grp_commercial: 'المبيعات والتجاري', grp_projects: 'المشاريع والتنفيذ', grp_supply: 'سلسلة الإمداد',
      grp_finance: 'المالية', grp_people: 'الأفراد والسلامة', grp_office: 'المكتب', grp_admin: 'الإدارة',
      notifications: 'الإشعارات', mark_all_read: 'تحديد الكل كمقروء', no_notifications: 'لا توجد إشعارات',
      just_now: 'الآن', m_ago: ' د', h_ago: ' س', d_ago: ' ي', recent_activity: 'النشاط الأخير', no_kpis: 'لا توجد مؤشرات بعد.',
      stage: 'المرحلة', category: 'الفئة', roles: 'الأدوار', permissions: 'الصلاحيات', permission: 'صلاحية',
      module: 'الوحدة', entity: 'الكيان', action: 'الإجراء', scope: 'النطاق', min: 'الحد الأدنى', max: 'الحد الأقصى',
      description: 'الوصف', signer_chain: 'سلسلة الاعتماد', bad_json: 'صيغة JSON غير صحيحة', manage_roles: 'إدارة الأدوار',
      reset_password: 'إعادة تعيين كلمة المرور', deactivate: 'تعطيل', activate: 'تفعيل', edit: 'تعديل', phone: 'الهاتف',
      title: 'المسمى الوظيفي', language: 'اللغة', active_y: 'نشط', inactive_y: 'غير نشط', revoke: 'إلغاء',
      lookups: 'القوائم', audit: 'سجل التدقيق', temp_pw_hint: 'شاركها مع المستخدم — يجب تغييرها عند أول دخول.'
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
