// site.js — 全站共用 header 的行為（各頁都載入，需在 ui.js 之後）
(function () {
    'use strict';

    // 深色模式：沒手動選過就跟隨系統；按過 header 的按鈕就記在 localStorage 'theme'，全站共用
    const root = document.documentElement;
    const themeIcon = document.getElementById('themeIcon');
    const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    function savedTheme() {
        try { const t = localStorage.getItem('theme'); return t === 'dark' || t === 'light' ? t : null; } catch (e) { return null; }
    }
    function readTheme() {
        return savedTheme() || (media && media.matches ? 'dark' : 'light');
    }
    function applyTheme(t) {
        root.setAttribute('data-theme', t);
        if (themeIcon) themeIcon.className = t === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill';
    }
    applyTheme(readTheme());
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) themeToggle.addEventListener('click', () => {
        const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        try { localStorage.setItem('theme', next); } catch (e) { /* storage blocked */ }
    });
    // 其他分頁切換時同步；系統深淺色改變時（沒手動選過）跟著變
    window.addEventListener('storage', e => { if (e.key === 'theme') applyTheme(readTheme()); });
    if (media && media.addEventListener) media.addEventListener('change', () => { if (!savedTheme()) applyTheme(readTheme()); });

    // 置頂 header 的高度給其他固定元素用（計算機頁的懸浮摘要列要接在 header 下方）
    const siteHeader = document.querySelector('.site-header');
    if (siteHeader) {
        const setHeaderH = () => root.style.setProperty('--site-header-h', siteHeader.offsetHeight + 'px');
        // 懸浮摘要列只蓋住內容區，不要壓到左邊的側邊欄
        const content = document.getElementById('page-content-wrapper');
        const update = () => {
            setHeaderH();
            if (content) root.style.setProperty('--content-left', content.getBoundingClientRect().left + 'px');
        };
        update();
        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(update);
            ro.observe(siteHeader);
            if (content) ro.observe(content);
        } else {
            window.addEventListener('resize', update);
        }
    }

    // 手機選單：漢堡按鈕開關，點了導覽連結就收起來
    const navToggle = document.getElementById('siteNavToggle');
    const navLinks = document.getElementById('siteNavLinks');
    if (navToggle && navLinks) {
        const setOpen = open => {
            navLinks.classList.toggle('is-open', open);
            navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            navToggle.setAttribute('aria-label', open ? '關閉選單' : '開啟選單');
        };
        navToggle.addEventListener('click', () => setOpen(!navLinks.classList.contains('is-open')));
        navLinks.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setOpen(false)));
    }

    // 計算機頁的 #events（舊書籤 index.html#events）：展開檔期清單並捲過去
    if (location.hash === '#events' && document.getElementById('events')) {
        window.addEventListener('load', () => setTimeout(() => {
            const details = document.getElementById('eventDayDetails');
            if (details && window.UI) UI.collapse.show(details);
            document.getElementById('events').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100));
    }
})();
