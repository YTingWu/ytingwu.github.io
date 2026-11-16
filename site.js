// site.js — 全站共用 header 的行為（各頁都載入，需在 bootstrap.bundle 之後）
(function () {
    'use strict';

    // 深色模式：header 的按鈕，存在 localStorage 'theme'，全站共用
    const root = document.documentElement;
    const themeIcon = document.getElementById('themeIcon');
    function readTheme() {
        try { return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'; } catch (e) { return 'light'; }
    }
    function applyTheme(t) {
        root.setAttribute('data-theme', t);
        if (themeIcon) themeIcon.className = (t === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill') + ' fs-5';
    }
    applyTheme(readTheme());
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) themeToggle.addEventListener('click', () => {
        const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        try { localStorage.setItem('theme', next); } catch (e) { /* storage blocked */ }
    });
    // 其他分頁切換時同步
    window.addEventListener('storage', e => { if (e.key === 'theme') applyTheme(readTheme()); });

    if (typeof bootstrap === 'undefined') return;

    // 手機選單：點了導覽連結就收起來
    const navCollapse = document.getElementById('siteNavLinks');
    if (navCollapse) {
        navCollapse.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', () => {
                if (navCollapse.classList.contains('show')) {
                    bootstrap.Collapse.getOrCreateInstance(navCollapse, { toggle: false }).hide();
                }
            });
        });
    }

    // 計算機頁的 #events（舊書籤 index.html#events）：展開檔期清單並捲過去
    if (location.hash === '#events' && document.getElementById('events')) {
        window.addEventListener('load', () => setTimeout(() => {
            const details = document.getElementById('eventDayDetails');
            if (details) bootstrap.Collapse.getOrCreateInstance(details, { toggle: false }).show();
            document.getElementById('events').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100));
    }
})();
