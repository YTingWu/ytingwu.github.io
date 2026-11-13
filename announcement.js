// announcement.js — 舊制頁面（index.html）的 2026/12/11 費率調整公告
// 每個瀏覽器只自動跳出一次；之後可點右上角公告 icon 再打開。12/11 合併新版後移除。
(function () {
    'use strict';

    const SEEN_KEY = 'shopee_fee_announcement_20261211_seen';
    const modalEl = document.getElementById('feeUpdateModal');
    if (!modalEl || typeof bootstrap === 'undefined') return;

    const modal = new bootstrap.Modal(modalEl);

    // 前往新版時帶上目前的設定（query string 與新版相容）
    function syncNewVersionLinks() {
        document.querySelectorAll('.new-version-link').forEach(a => {
            a.href = 'new.html' + window.location.search;
        });
    }
    document.querySelectorAll('.new-version-link').forEach(a => a.addEventListener('click', syncNewVersionLinks));
    modalEl.addEventListener('show.bs.modal', syncNewVersionLinks);

    const btn = document.getElementById('announcementBtn');
    if (btn) btn.addEventListener('click', () => modal.show());

    let seen = false;
    try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { /* storage blocked */ }
    // 使用者關閉過一次才記錄，之後不再自動跳出
    modalEl.addEventListener('hidden.bs.modal', () => {
        try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* storage blocked */ }
    });
    if (!seen) modal.show();
})();
