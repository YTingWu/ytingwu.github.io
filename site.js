// site.js — 全站共用 header 的行為（各頁都載入，需在 bootstrap.bundle 之後）
(function () {
    'use strict';
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
