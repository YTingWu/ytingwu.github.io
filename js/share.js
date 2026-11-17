// share.js — 文章頁的分享按鈕
// 標記：<div class="article-share" data-share> 內放 [data-share-native] 與 [data-share-copy] 兩個按鈕。
// 分享：有 navigator.share（多數手機瀏覽器）就叫出系統分享選單；不支援的瀏覽器隱藏這顆，只留複製連結。
// 分享的網址取 <link rel="canonical">，標題取 og:title，避免帶到 query／hash。
(function () {
    'use strict';

    const blocks = document.querySelectorAll('[data-share]');
    if (!blocks.length) return;

    const canonical = document.querySelector('link[rel="canonical"]');
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const url = canonical ? canonical.href : location.href.split(/[?#]/)[0];
    const title = ogTitle ? ogTitle.content : document.title;
    const canShare = typeof navigator.share === 'function';

    function track(method) {
        if (typeof gtag === 'function') gtag('event', 'share', { method: method, content_type: 'article', item_id: url });
    }

    function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text);
        }
        // 舊瀏覽器或非 https：用隱藏的 textarea 複製
        return new Promise((resolve, reject) => {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
            document.body.removeChild(ta);
            ok ? resolve() : reject(new Error('copy failed'));
        });
    }

    blocks.forEach(block => {
        const nativeBtn = block.querySelector('[data-share-native]');
        const copyBtn = block.querySelector('[data-share-copy]');
        const status = block.querySelector('[data-share-status]');
        let timer = null;

        function flash(message) {
            if (!status) return;
            status.textContent = message;
            status.classList.add('show');
            clearTimeout(timer);
            timer = setTimeout(() => {
                status.classList.remove('show');
                status.textContent = '';
            }, 2000);
        }

        if (nativeBtn) {
            if (!canShare) {
                nativeBtn.hidden = true;
            } else {
                nativeBtn.addEventListener('click', () => {
                    navigator.share({ title: title, url: url })
                        .then(() => track('web_share'))
                        .catch(err => {
                            // 使用者自己關掉選單（AbortError）不用提示
                            if (err && err.name === 'AbortError') return;
                            flash('無法開啟分享，請改用複製連結');
                        });
                });
            }
        }

        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                copyText(url)
                    .then(() => { flash('已複製連結'); track('copy_link'); })
                    .catch(() => flash('複製失敗，請長按網址列複製'));
            });
        }
    });
})();
