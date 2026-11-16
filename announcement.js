// announcement.js — 12/11 新制公告（全站 header 的公告鈕）
// 首頁已改為新制；只有彈窗標了 data-autoshow="true" 的頁面（首頁）會自動跳出一次，提醒 12/10 以前的訂單用舊制。
// 其他頁點 header 公告鈕才打開。
(function () {
    'use strict';

    // 2026/11/16 首頁改為新制，換新 key 讓看過舊公告的人再看一次
    const SEEN_KEY = 'shopee_fee_announcement_newhome_20261116_seen';

    // 新舊制計算機之間互跳時帶上目前的設定（兩版 query string 相容）
    function syncCarryQueryLinks() {
        document.querySelectorAll('a[data-carry-query]').forEach(a => {
            if (!a.dataset.baseHref) a.dataset.baseHref = a.getAttribute('href');
            a.href = a.dataset.baseHref + window.location.search;
        });
    }
    document.addEventListener('click', e => {
        if (e.target.closest && e.target.closest('a[data-carry-query]')) syncCarryQueryLinks();
    }, true);

    const modalEl = document.getElementById('feeUpdateModal');
    if (!modalEl || typeof bootstrap === 'undefined') return;

    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modalEl.addEventListener('show.bs.modal', syncCarryQueryLinks);

    const btn = document.getElementById('announcementBtn');
    if (btn) btn.addEventListener('click', () => modal.show());

    if (modalEl.dataset.autoshow !== 'true') return;

    let seen = false;
    try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { /* storage blocked */ }
    // 使用者關閉過一次才記錄，之後不再自動跳出
    modalEl.addEventListener('hidden.bs.modal', () => {
        try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* storage blocked */ }
    });
    if (!seen) modal.show();
})();
