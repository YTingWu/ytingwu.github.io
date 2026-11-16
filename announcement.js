// announcement.js — 2026/12/11 費率調整公告（全站 header 的公告鈕）
// 只有彈窗標了 data-autoshow="true" 的頁面（首頁）會自動跳出一次；其他頁點 header 公告鈕才打開。
// 12/11 合併新版後連同 partials/announcement-modal.html、header 的公告鈕一起移除。
(function () {
    'use strict';

    const SEEN_KEY = 'shopee_fee_announcement_20261211_seen';
    const modalEl = document.getElementById('feeUpdateModal');
    if (!modalEl || typeof bootstrap === 'undefined') return;

    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

    // 從計算機頁前往新版時帶上目前的設定（query string 與新版相容）
    function syncNewVersionLinks() {
        document.querySelectorAll('.new-version-link').forEach(a => {
            a.href = 'new.html' + window.location.search;
        });
    }
    document.querySelectorAll('.new-version-link').forEach(a => a.addEventListener('click', syncNewVersionLinks));
    modalEl.addEventListener('show.bs.modal', syncNewVersionLinks);

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
