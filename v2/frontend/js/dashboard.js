/**
 * dashboard.js — role-aware home dashboard.
 *
 * Exposes window.DASHBOARD.view() returning a Promise<node>, which app.js routes
 * the "dashboard" view to. One backend call (dashboard.summary) returns only the
 * KPIs/charts the user may see, the approval queue, and a recent-activity feed.
 * Charts are dependency-free CSS bars (no external libraries — keeps the PWA
 * offline-first and light).
 */
(function () {
  'use strict';
  var el = UI.el, t = I18N.t;
  function L(o) { return I18N.current() === 'ar' ? (o.label_ar || o.label_en) : (o.label_en || o.label_ar); }
  function go(v) { if (window.APP && window.APP.go) window.APP.go(v); }
  function fmt(n) { return (typeof n === 'number' ? n : Number(n) || 0).toLocaleString(); }

  function kpiCard(k) {
    var val = (typeof k.value === 'number') ? fmt(k.value) : k.value;
    var node = el('button', { class: 'kpi tone-' + (k.tone || 'default') + (k.link ? ' linked' : ''),
      onclick: k.link ? function () { go(k.link); } : null }, [
      el('div', { class: 'kpi-value', text: String(val) + (k.unit ? (' ' + k.unit) : '') }),
      el('div', { class: 'kpi-label', text: L(k) })
    ]);
    return node;
  }

  function barChart(title, data) {
    if (!data || !data.length) return null;
    var max = data.reduce(function (m, d) { return Math.max(m, Number(d.value) || 0); }, 0) || 1;
    var rows = data.map(function (d) {
      return el('div', { class: 'bar-row' }, [
        el('div', { class: 'bar-label', text: d.label }),
        el('div', { class: 'bar-track' }, [el('div', { class: 'bar-fill', style: 'width:' + Math.round((Number(d.value) || 0) / max * 100) + '%' })]),
        el('div', { class: 'bar-val', text: fmt(d.value) })
      ]);
    });
    return el('div', { class: 'card chart-card' }, [el('h3', { text: title })].concat(rows));
  }

  function actionLabel(a) {
    var k = 'act_' + a; var s = t(k);
    return s !== k ? s : String(a || '').replace(/_/g, ' ');
  }
  function recentFeed(rows) {
    if (!rows || !rows.length) return el('p', { class: 'muted', text: t('no_records') });
    var list = el('div', { class: 'feed' });
    rows.forEach(function (r) {
      list.appendChild(el('div', { class: 'feed-item' }, [
        el('span', { class: 'feed-dot' }),
        el('div', {}, [
          el('div', { class: 'feed-main', text: actionLabel(r.action) + ' · ' + (r.entity || r.module || '') + (r.amount ? (' · ' + fmt(r.amount)) : '') }),
          el('div', { class: 'feed-meta', text: (r.user_email || '') + ' · ' + String(r.ts || '').slice(0, 16).replace('T', ' ') })
        ])
      ]));
    });
    return list;
  }

  function view() {
    return API.act('dashboard.summary').then(function (d) {
      var user = (window.APP && window.APP.state && window.APP.state.user) || {};
      var wrap = el('div', { class: 'dash' });
      wrap.appendChild(el('div', { class: 'section-head' }, [
        el('h2', { text: t('welcome') + ' ' + (I18N.pick(user, 'full_name') || user.email || '') })
      ]));

      // KPI grid
      var grid = el('div', { class: 'kpi-grid' });
      (d.kpis || []).forEach(function (k) { grid.appendChild(kpiCard(k)); });
      if (!(d.kpis || []).length) grid.appendChild(el('p', { class: 'muted', text: t('no_kpis') }));
      wrap.appendChild(grid);

      // charts — render every chart the backend returns (auto-adapts to new modules)
      var charts = d.charts || {};
      var titles = {
        projects_status: t('projects') + ' · ' + t('status'),
        mr_status: t('mr') + ' · ' + t('status'),
        opp_stage: t('bd') + ' · ' + t('stage'),
        expense_category: t('expense') + ' · ' + t('category'),
        hr_dept: t('hr'), asset_status: t('assets') + ' · ' + t('status'), incident_type: t('hse')
      };
      var chartWrap = el('div', { class: 'chart-grid' });
      Object.keys(charts).forEach(function (key) {
        var n = barChart(titles[key] || key.replace(/_/g, ' '), charts[key]); if (n) chartWrap.appendChild(n);
      });
      if (chartWrap.childNodes.length) wrap.appendChild(chartWrap);

      // recent activity
      wrap.appendChild(el('div', { class: 'card' }, [
        el('h3', { text: t('recent_activity') }),
        recentFeed(d.recent)
      ]));
      return wrap;
    });
  }

  window.DASHBOARD = { view: view };
})();
