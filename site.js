// site.js — 全站共用 header 的行為（各頁都載入，需在 bootstrap.bundle 之後）
(function () {
    'use strict';
    if (typeof bootstrap === 'undefined') return;

    // 「活動日行事曆」：捲到 #events，並展開收合中的檔期清單
    function openEvents() {
        const section = document.getElementById('events');
        if (!section) return false;
        const details = document.getElementById('eventDayDetails');
        if (details) bootstrap.Collapse.getOrCreateInstance(details, { toggle: false }).show();
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return true;
    }

    const navCollapse = document.getElementById('siteNavLinks');

    document.querySelectorAll('.site-events-link').forEach(link => {
        link.addEventListener('click', e => {
            if (link.getAttribute('href') !== '#events') return; // 跨頁連結交給瀏覽器
            if (!document.getElementById('events')) return;
            e.preventDefault();
            history.replaceState(null, '', '#events');
            // 手機選單收合會讓內容往上移，等收完再捲動，否則會捲過頭
            if (navCollapse && navCollapse.classList.contains('show')) {
                navCollapse.addEventListener('hidden.bs.collapse', openEvents, { once: true });
            } else {
                openEvents();
            }
        });
    });

    // 手機選單：點了導覽連結就收起來
    if (navCollapse) {
        navCollapse.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', () => {
                if (navCollapse.classList.contains('show')) {
                    bootstrap.Collapse.getOrCreateInstance(navCollapse, { toggle: false }).hide();
                }
            });
        });
    }

    // 從其他頁帶 #events 進來
    if (location.hash === '#events') {
        window.addEventListener('load', () => setTimeout(openEvents, 100));
    }
})();
