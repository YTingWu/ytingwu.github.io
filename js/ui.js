// ui.js — 取代 Bootstrap JS 的小型互動元件（各頁都載入，放在其他 js 之前）
//
//   對話框   <dialog class="modal" id="x">…<button data-ui-close>…</dialog>
//            開啟：<button data-ui-open="#x">，或 UI.modal.show(el)
//            事件：el 會發 'ui:show'（開啟前）、'ui:hidden'（關閉後）
//   收合     <button data-ui-toggle="#x" aria-expanded="false"> + <div id="x" hidden>
//            UI.collapse.show(el) / hide(el) / toggle(el)
//   分頁     <div role="tablist"><button role="tab" aria-controls="p1" aria-selected="true">…
//            面板 <div role="tabpanel" id="p1">，非選取的面板加 hidden
//   tooltip  任何元素加 data-tip="說明（可含 HTML）"；觸控裝置點擊開關，其他 hover／focus
//   toast    UI.toast('訊息 HTML')
(function () {
    'use strict';

    const $ = (sel, root = document) => (typeof sel === 'string' ? root.querySelector(sel) : sel);

    // ---------- 對話框 ----------
    const modal = {
        show(el) {
            el = $(el);
            if (!el || el.open) return;
            el.dispatchEvent(new CustomEvent('ui:show'));
            el.showModal();
            // showModal 會把焦點放在第一個按鈕（通常是右上角的關閉），改放在對話框本身，避免一打開就出現 focus 框
            if (document.activeElement && document.activeElement.matches('[data-ui-close]')) {
                if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
                el.focus();
            }
        },
        hide(el) {
            el = $(el);
            if (el && el.open) el.close();
        },
    };
    document.addEventListener('close', e => {
        if (e.target.matches && e.target.matches('dialog.modal')) e.target.dispatchEvent(new CustomEvent('ui:hidden'));
    }, true);
    // 點背景關閉
    document.addEventListener('click', e => {
        const d = e.target;
        if (d instanceof HTMLDialogElement && d.classList.contains('modal') && d.open) {
            const r = d.getBoundingClientRect();
            const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
            if (!inside) d.close();
        }
    });

    // ---------- 收合 ----------
    function togglersFor(el) {
        return document.querySelectorAll(`[data-ui-toggle="#${CSS.escape(el.id)}"]`);
    }
    const collapse = {
        show(el) { el = $(el); if (!el) return; el.hidden = false; togglersFor(el).forEach(b => b.setAttribute('aria-expanded', 'true')); },
        hide(el) { el = $(el); if (!el) return; el.hidden = true; togglersFor(el).forEach(b => b.setAttribute('aria-expanded', 'false')); },
        toggle(el) { el = $(el); if (!el) return; el.hidden ? collapse.show(el) : collapse.hide(el); },
        isOpen(el) { el = $(el); return !!el && !el.hidden; },
    };

    // ---------- 分頁 ----------
    function selectTab(tab) {
        const list = tab.closest('[role="tablist"]');
        if (!list) return;
        list.querySelectorAll('[role="tab"]').forEach(t => {
            const on = t === tab;
            t.setAttribute('aria-selected', on ? 'true' : 'false');
            t.tabIndex = on ? 0 : -1;
            const panel = document.getElementById(t.getAttribute('aria-controls'));
            if (panel) panel.hidden = !on;
        });
        tab.dispatchEvent(new CustomEvent('ui:tab', { bubbles: true }));
    }

    // ---------- 委派點擊 ----------
    document.addEventListener('click', e => {
        const t = e.target.closest ? e.target : null;
        if (!t) return;
        const opener = t.closest('[data-ui-open]');
        if (opener) { e.preventDefault(); modal.show(opener.getAttribute('data-ui-open')); return; }
        const closer = t.closest('[data-ui-close]');
        if (closer) { const d = closer.closest('dialog'); if (d) d.close(); return; }
        const tog = t.closest('[data-ui-toggle]');
        if (tog) { e.preventDefault(); collapse.toggle(tog.getAttribute('data-ui-toggle')); return; }
        const tab = t.closest('[role="tab"]');
        if (tab && tab.closest('[role="tablist"]')) { e.preventDefault(); selectTab(tab); }
    });
    document.addEventListener('keydown', e => {
        const tab = e.target.closest && e.target.closest('[role="tab"]');
        if (!tab || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
        const tabs = [...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
        const next = tabs[(tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
        next.focus();
        selectTab(next);
    });

    // ---------- tooltip ----------
    const supportsPopover = typeof HTMLElement !== 'undefined' && HTMLElement.prototype.hasOwnProperty('popover');
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    let tipEl = null;
    let tipOwner = null;

    function ensureTip() {
        if (tipEl) return tipEl;
        tipEl = document.createElement('div');
        tipEl.className = 'tip';
        tipEl.setAttribute('role', 'tooltip');
        tipEl.id = 'ui-tip';
        if (supportsPopover) tipEl.popover = 'manual';
        else tipEl.style.cssText = 'display:none;z-index:2000';
        document.body.appendChild(tipEl);
        return tipEl;
    }
    function placeTip(owner) {
        const r = owner.getBoundingClientRect();
        const t = tipEl.getBoundingClientRect();
        const gap = 8;
        let top = r.top - t.height - gap;
        if (top < 8) top = r.bottom + gap;            // 上方放不下就放下方
        let left = r.left + r.width / 2 - t.width / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - t.width - 8));
        tipEl.style.top = `${top}px`;
        tipEl.style.left = `${left}px`;
    }
    function showTip(owner) {
        const html = owner.getAttribute('data-tip');
        if (!html) return;
        ensureTip();
        tipEl.innerHTML = html;
        tipOwner = owner;
        owner.setAttribute('aria-describedby', 'ui-tip');
        if (supportsPopover) { if (!tipEl.matches(':popover-open')) tipEl.showPopover(); }
        else tipEl.style.display = 'block';
        placeTip(owner);
    }
    function hideTip() {
        if (!tipEl || !tipOwner) return;
        tipOwner.removeAttribute('aria-describedby');
        tipOwner = null;
        if (supportsPopover) { if (tipEl.matches(':popover-open')) tipEl.hidePopover(); }
        else tipEl.style.display = 'none';
    }
    // 舊寫法 title= 轉成 data-tip，避免瀏覽器原生 title 一起跳出
    function upgradeTips(root = document) {
        root.querySelectorAll('[data-tip][title]').forEach(el => el.removeAttribute('title'));
        root.querySelectorAll('[data-tip]').forEach(el => {
            if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT)$/.test(el.tagName)) el.tabIndex = 0;
            if (!el.hasAttribute('role') && el.tagName === 'I') el.setAttribute('role', 'button');
            if (!el.hasAttribute('aria-label') && el.tagName === 'I') el.setAttribute('aria-label', '說明');
        });
    }
    if (isTouch) {
        document.addEventListener('click', e => {
            const owner = e.target.closest && e.target.closest('[data-tip]');
            if (owner) {
                // 說明圖示在 <label> 裡時，不要順便勾選選項
                e.preventDefault();
                e.stopPropagation();
                owner === tipOwner ? hideTip() : showTip(owner);
            } else hideTip();
        }, true);
    } else {
        document.addEventListener('mouseover', e => { const o = e.target.closest && e.target.closest('[data-tip]'); if (o && o !== tipOwner) showTip(o); });
        document.addEventListener('mouseout', e => { const o = e.target.closest && e.target.closest('[data-tip]'); if (o && !o.contains(e.relatedTarget)) hideTip(); });
        document.addEventListener('focusin', e => { const o = e.target.closest && e.target.closest('[data-tip]'); if (o) showTip(o); });
        document.addEventListener('focusout', e => { const o = e.target.closest && e.target.closest('[data-tip]'); if (o) hideTip(); });
        document.addEventListener('click', e => { if (e.target.closest && e.target.closest('label [data-tip]')) e.preventDefault(); }, true);
    }
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hideTip(); });
    window.addEventListener('scroll', hideTip, { passive: true, capture: true });

    // ---------- toast ----------
    function toast(html, { delay = 3000 } = {}) {
        let stack = document.getElementById('toastContainer');
        if (!stack) {
            stack = document.createElement('div');
            stack.id = 'toastContainer';
            document.body.appendChild(stack);
        }
        stack.className = 'toast-stack';
        const el = document.createElement('div');
        el.className = 'toast';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.innerHTML = `<div class="flex-1">${html}</div><button type="button" class="btn btn-icon btn-sm text-paper/70 hover:text-paper" aria-label="關閉"><i class="bi bi-x-lg"></i></button>`;
        const remove = () => el.remove();
        el.querySelector('button').addEventListener('click', remove);
        stack.appendChild(el);
        setTimeout(remove, delay);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => upgradeTips());
    else upgradeTips();

    window.UI = { modal, collapse, toast, upgradeTips, hideTip };
})();
