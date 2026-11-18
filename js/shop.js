// shop.js — 我的賣場介面（資料與計算在 shop-data.js、xlsx 在 shop-xlsx.js）
(function () {
    'use strict';
    const SD = window.ShopData;
    const SX = window.ShopXlsx;
    const QUICK_KEY = 'shopee_calculator_configs_v1'; // 快速計算的已存設定（storage-new.js）

    const LABELS = {
        seller: { general: '一般賣家', mall: '商城賣家', shop: '蝦皮小舖' },
        shipPlan: { ship1: '免運方案一', ship2: '免運方案二' },
        cashback: { '0': '不參加蝦幣回饋', '1.5': '蝦幣回饋 5%', '2.5': '蝦幣回饋 10%' },
        cashbackTerm: { long: '長期', short: '短期' },
        tax: { '0': '稅務：無', '1': '稅籍登記 1%', '5': '發票 5%', '5_plus': '蝦皮代開發票' },
    };

    // ---------- 儲存 ----------
    const memStore = new Map();
    const storage = (() => {
        try {
            const k = '__shop_test__';
            localStorage.setItem(k, '1');
            localStorage.removeItem(k);
            return localStorage;
        } catch (e) {
            return { getItem: k => (memStore.has(k) ? memStore.get(k) : null), setItem: (k, v) => memStore.set(k, String(v)), removeItem: k => memStore.delete(k), _mem: true };
        }
    })();

    let state = SD.emptyState();
    const ctx = { state, cats: {}, feeIndex: null };
    const ui = { expanded: new Set(), selected: new Set(), rpSelected: new Set(), tab: 'overview', ovSort: { key: null, dir: 1 }, ovPage: 1, ovPageSize: 10 };
    const OV_PAGE_SIZES = [10, 20, 50, 100];

    // ---------- 小工具 ----------
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const money = n => (n == null || !Number.isFinite(n)) ? '—' : (n < 0 ? '-$ ' : '$ ') + Math.abs(Math.round(n)).toLocaleString('zh-TW');
    const pct = n => (n == null || !Number.isFinite(n)) ? '—' : n.toFixed(1) + '%';
    // 總覽表格用：區間拆成兩行（最小值／～最大值），欄寬只需容納單一金額
    const rangeStack = (r, f) => !r ? '—' : (f(r.min) === f(r.max) ? `<span class="rg">${f(r.min)}</span>` : `<span class="rg">${f(r.min)}</span><span class="rg rg-to">～ ${f(r.max)}</span>`);
    const rangeOf = (r, f) => !r ? '—' : (f(r.min) === f(r.max) ? f(r.min) : `${f(r.min)} ～ ${f(r.max)}`);
    const fmtTime = t => { const d = new Date(t); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
    const modal = id => bootstrap.Modal.getOrCreateInstance($(id));

    function toast(msg) {
        $('shopToastBody').textContent = msg;
        bootstrap.Toast.getOrCreateInstance($('shopToast'), { delay: 3500 }).show();
    }

    function currentShop() {
        return state.shops.find(s => s.id === state.activeShopId) || state.shops[0] || null;
    }

    function save() {
        try {
            SD.saveState(storage, state);
            return true;
        } catch (e) {
            toast('儲存失敗：瀏覽器的儲存空間不足。請用「備份」匯出後刪除不需要的賣場。');
            return false;
        }
    }

    function download(name, data, type) {
        const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }

    function bufToB64(buf) {
        const bytes = new Uint8Array(buf);
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(s);
    }
    function b64ToBytes(b64) {
        const s = atob(b64);
        const out = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
        return out;
    }

    let confirmCb = null, confirmAltCb = null;
    function confirmBox(title, html, okText, cb, alt) {
        $('confirmModalTitle').textContent = title;
        $('confirmModalBody').innerHTML = html;
        $('confirmModalOk').textContent = okText || '確定';
        confirmCb = cb;
        const footer = $('confirmModalOk').parentElement;
        footer.querySelector('.confirm-alt')?.remove();
        confirmAltCb = null;
        if (alt) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn btn-outline-primary confirm-alt';
            b.textContent = alt.text;
            confirmAltCb = alt.cb;
            b.addEventListener('click', () => { modal('confirmModal').hide(); confirmAltCb && confirmAltCb(); });
            footer.insertBefore(b, $('confirmModalOk'));
        }
        modal('confirmModal').show();
    }

    let nameCb = null;
    function nameBox(title, value, cb) {
        $('nameModalTitle').textContent = title;
        $('nameModalInput').value = value || '';
        nameCb = cb;
        modal('nameModal').show();
        $('nameModal').addEventListener('shown.bs.modal', () => { $('nameModalInput').focus(); $('nameModalInput').select(); }, { once: true });
    }

    function quickSavedConfigs() {
        try { return JSON.parse(storage.getItem(QUICK_KEY) || '[]') || []; } catch (e) { return []; }
    }

    function catLeafName(path) { return path ? path[path.length - 1] : ''; }

    function feeDescription(p, shop) {
        const rate = SD.resolveRate(p, shop.settings.seller, ctx);
        if (p.fee.mode === 'manual') return { text: rate != null ? `手動 ${rate}%` : '未設定', rate, path: null };
        const path = SD.resolveFeePath(p, ctx);
        if (!path) return { text: '請選類別', rate: null, path: null };
        return { text: `${catLeafName(path)} ${rate}%`, rate, path };
    }

    // ---------- 初始化 ----------
    async function init() {
        if (storage._mem) $('storageWarning').classList.remove('d-none');
        state = SD.loadState(storage);
        ctx.state = state;
        try {
            const [fee, cats] = await Promise.all([
                fetch('fee-new.json').then(r => r.json()),
                fetch('shopee-categories.json').then(r => r.json()),
            ]);
            ctx.feeIndex = SD.buildFeeIndex(fee);
            ctx.cats = cats.categories || {};
        } catch (e) {
            ctx.feeIndex = SD.buildFeeIndex([]);
            toast('費率表載入失敗，請重新整理頁面');
        }
        bindEvents();
        bindBreakdownPopover();
        render();
        handleAddFromQuickCalc();

        window.addEventListener('storage', e => {
            if (e.key !== SD.STORAGE_KEY) return;
            state = SD.loadState(storage);
            ctx.state = state;
            render();
        });
        // 深色模式切換時同步 Bootstrap 主題
        new MutationObserver(() => {
            document.documentElement.setAttribute('data-bs-theme', document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
        }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    // ---------- 整頁 ----------
    function render() {
        const shop = currentShop();
        $('privacyBackupHint').classList.toggle('d-none', !shop);
        if (!shop) {
            $('onboarding').classList.remove('d-none');
            $('shopApp').classList.add('d-none');
            renderOnboarding();
            return;
        }
        state.activeShopId = shop.id;
        $('onboarding').classList.add('d-none');
        $('shopApp').classList.remove('d-none');
        $('shopSelect').innerHTML = state.shops.map(s => `<option value="${esc(s.id)}"${s.id === shop.id ? ' selected' : ''}>${esc(s.name)}（${s.products.length}）</option>`).join('');
        renderSettings();
        renderOverview();
        renderReprice();
    }

    function renderOnboarding() {
        const cfgs = quickSavedConfigs();
        $('obFromSavedWrap').classList.toggle('d-none', cfgs.length === 0);
        $('obFromSaved').innerHTML = '<option value="">預設值（建立後可到「賣場設定」修改）</option>' +
            cfgs.map(c => `<option value="${esc(c.id)}">沿用已存設定：${esc(c.title)}</option>`).join('');
    }

    function createShop(name, settings) {
        const s = SD.newShop(name, settings);
        state.shops.push(s);
        state.activeShopId = s.id;
        save();
        return s;
    }

    // ---------- 商品總覽 ----------
    function overviewRows(shop) {
        const q = $('ovSearch').value.trim().toLowerCase();
        const filter = $('ovFilter').value;
        const low = Number(shop.settings.lowMargin) || 0;
        let rows = shop.products.map((p, i) => ({ p, i, pm: SD.productMetrics(shop, p, ctx) }));
        if (q) rows = rows.filter(r => (r.p.name + ' ' + (r.p.note || '')).toLowerCase().includes(q));
        rows = rows.filter(({ p, pm }) => {
            if (filter === 'loss') return pm.regularProfit && (pm.regularProfit.min < 0 || pm.eventProfit.min < 0);
            if (filter === 'low') return pm.regularMargin && pm.regularMargin.min < low;
            if (filter === 'incomplete') return pm.missingCost || pm.missingRate;
            if (filter === 'missing') return p.missingInLastImport;
            return true;
        });
        const { key: sortKey, dir } = ui.ovSort;
        const key = {
            name: r => r.p.name || null,
            cost: r => r.p.cost ?? null,
            price: r => r.pm.price ? r.pm.price.min : null,
            profit: r => r.pm.regularProfit ? r.pm.regularProfit.min : null,
            eventProfit: r => r.pm.eventProfit ? r.pm.eventProfit.min : null,
        }[sortKey];
        if (key) {
            // 沒有值的（待補進價、未選類別）不論升降冪都排最後；同值維持加入順序
            rows.sort((a, b) => {
                const x = key(a), y = key(b);
                if (x == null || y == null) return (x == null) - (y == null) || a.i - b.i;
                const c = sortKey === 'name' ? String(x).localeCompare(String(y), 'zh-Hant') : x - y;
                return c * dir || a.i - b.i;
            });
        }
        return rows;
    }

    function numCell(cls, label, profit, margin, low, isShop, bd) {
        if (isShop && cls === 'c-evt') return `<div class="${cls} ov-num"><span class="mlabel">${label}</span><span class="text-muted small">小舖無加收</span></div>`;
        if (!profit) return `<div class="${cls} ov-num"><span class="mlabel">${label}</span>${bd ? bdTrigger('—') : '—'}</div>`;
        const loss = profit.min < 0;
        const lowM = margin && margin.min < low;
        const val = `<span class="ov-money${loss ? ' ov-loss' : ''}">${rangeStack(profit, money)}</span>` +
            `<span class="pct"><span class="${lowM && !loss ? 'ov-low' : ''}${loss ? 'ov-loss' : ''}">${rangeOf(margin, pct)}</span></span>`;
        return `<div class="${cls} ov-num"><span class="mlabel">${label}</span>${bd ? bdTrigger(val) : val}</div>`;
    }

    const bdTrigger = val => `<button type="button" class="ov-bd-trigger" aria-haspopup="dialog" aria-expanded="false" title="費用拆解">${val}</button>`;

    function renderOverview() {
        const shop = currentShop();
        if (!shop) return;
        const low = Number(shop.settings.lowMargin) || 0;
        const isShop = shop.settings.seller === 'shop';

        // 摘要
        const sum = SD.shopSummary(shop, ctx);
        const curFilter = $('ovFilter').value;
        const card = (label, value, cls, filter) => {
            const body = `<div class="label">${label}${filter ? ' <i class="bi bi-funnel"></i>' : ''}</div><div class="value ${cls || ''}">${value}</div>`;
            return `<div class="col-6 col-md">` + (filter
                ? `<button type="button" class="summary-card summary-card-btn${curFilter === filter ? ' active' : ''}" data-action="card-filter" data-filter="${filter}" aria-pressed="${curFilter === filter}" title="${curFilter === filter ? '取消篩選' : '只列出這些商品'}">${body}</button>`
                : `<div class="summary-card">${body}</div>`) + `</div>`;
        };
        $('summaryCards').innerHTML = card('商品數', sum.count) +
            card('虧本商品', sum.loss, sum.loss ? 'text-danger' : '', 'loss') +
            card('平均利潤率（一般日）', pct(sum.avgRegular)) +
            (isShop ? '' : card('平均利潤率（促銷檔期）', pct(sum.avgEvent))) +
            card('待補進價／類別', sum.incomplete, sum.incomplete ? 'text-warning' : '', 'incomplete');

        const st = shop.settings;
        const parts = [LABELS.seller[st.seller]];
        if (!isShop) parts.push(LABELS.shipPlan[st.shipPlan], st.cashback === '0' ? LABELS.cashback['0'] : `${LABELS.cashback[st.cashback]}（${LABELS.cashbackTerm[st.cashbackTerm]}）`);
        parts.push(LABELS.tax[st.tax]);
        $('settingsLine').innerHTML = `<i class="bi bi-sliders"></i><span class="settings-text">${esc(parts.join(' · '))}</span><a href="#" data-action="goto-settings">修改</a>`;

        const rows = overviewRows(shop);
        const pages = Math.max(1, Math.ceil(rows.length / ui.ovPageSize));
        ui.ovPage = Math.min(Math.max(1, ui.ovPage), pages);
        const pageStart = (ui.ovPage - 1) * ui.ovPageSize;
        const pageRows = rows.slice(pageStart, pageStart + ui.ovPageSize);
        renderOvHead(shop.products.length > 0);
        renderOvPager(rows.length, pages);
        // 全展開／全收合：對象是目前篩選後所有多規格商品（跨頁），全部已展開才顯示「全部收合」
        const multiIds = rows.filter(r => r.p.variations.length > 1).map(r => r.p.id);
        const allOpen = multiIds.length > 0 && multiIds.every(id => ui.expanded.has(id));
        const exBtn = $('ovExpandAll');
        exBtn.classList.toggle('d-none', !multiIds.length);
        exBtn.dataset.mode = allOpen ? 'collapse' : 'expand';
        exBtn.setAttribute('aria-pressed', String(allOpen));
        exBtn.innerHTML = allOpen ? '<i class="bi bi-arrows-collapse"></i> 規格全部收合' : '<i class="bi bi-arrows-expand"></i> 規格全部展開';
        ui.ovMultiIds = multiIds;
        $('ovCount').textContent = rows.length === shop.products.length ? `${rows.length} 個商品` : `列出 ${rows.length}／${shop.products.length} 個商品`;
        if (!shop.products.length) {
            $('ovList').innerHTML = `<div class="text-center text-muted py-4"><p class="mb-3">還沒有商品。從蝦皮賣家中心的商品檔匯入最快，也可以手動新增。</p>` +
                `<div class="d-flex flex-wrap justify-content-center gap-2">` +
                `<button class="btn btn-primary" data-action="import-shopee"><i class="bi bi-file-earmark-spreadsheet"></i> 從蝦皮匯入</button>` +
                `<button class="btn btn-outline-secondary" data-action="product-new"><i class="bi bi-plus-lg"></i> 新增商品</button>` +
                `<button class="btn btn-outline-secondary" data-action="import-saved"><i class="bi bi-save"></i> 從快速計算已存設定匯入</button></div></div>`;
        } else if (!rows.length) {
            $('ovList').innerHTML = `<div class="text-center text-muted py-4">沒有符合條件的商品</div>`;
        } else {
            $('ovList').innerHTML = pageRows.map(({ p, pm }) => {
                const fee = feeDescription(p, shop);
                const badges = [];
                const chip = (cls, icon, text, title) => `<span class="ov-chip${cls ? ' ' + cls : ''}"${title ? ` title="${esc(title)}"` : ''}>${icon ? `<i class="bi bi-${icon}" aria-hidden="true"></i>` : ''}${text}</span>`;
                if (pm.missingCost) badges.push(chip('ov-chip-warn', 'exclamation-triangle-fill', '待補進價'));
                if (fee.rate == null) badges.push(chip('ov-chip-warn', 'exclamation-triangle-fill', '請選類別'));
                if (p.fee.needsReview) badges.push(chip('ov-chip-warn', 'exclamation-triangle-fill', '請重選類別'));
                if (pm.hasDraft) badges.push(chip('ov-chip-info', 'pencil-fill', '調價中'));
                if (p.missingInLastImport) badges.push(chip('ov-chip-muted', 'cloud-slash', '本次未匯入'));
                if (p.variations.length > 1) badges.push(chip('', 'layers', `${p.variations.length} 個規格`));
                if (fee.rate != null) badges.push(chip('', 'tag', esc(fee.text), fee.path ? fee.path.join(' > ') : ''));
                if (p.preorder !== '0' && !isShop) badges.push(chip('', 'clock-history', `預購 ${p.preorder}%`));
                if (p.frozen && !isShop) badges.push(chip('', 'snow', '冷凍'));
                if (p.shopeeItemId) badges.push(chip('ov-chip-shopee', 'link-45deg', '蝦皮', '從蝦皮匯入的商品'));
                const others = state.shops.length > 1;
                // 單一規格：不展開，商品列的淨利直接浮出費用拆解
                const single = p.variations.length === 1;
                const sm = single ? pm.rows[0].m : null;
                const bd = single && sm.hasRate;
                return `<div class="ov-item" data-pid="${p.id}">
  <div class="ov-row ov-bd-scope${single ? ' ov-row-single' : ''}"${single ? '' : ` data-action="toggle-detail"`} data-pid="${p.id}">${bd ? `<template class="ov-bd-tpl">${breakdownHtml(shop, p, p.variations[0], sm)}</template>` : ''}
    <div class="c-chk"><input type="checkbox" class="form-check-input ov-chk" data-pid="${p.id}" ${ui.selected.has(p.id) ? 'checked' : ''} aria-label="選取"></div>
    <div class="c-name"><div class="ov-name">${esc(p.name || '（未命名）')}</div><div class="ov-sub">${badges.join('')}${p.note ? `<span class="ov-note">${esc(p.note)}</span>` : ''}</div></div>
    <div class="c-cost ov-cost"><span class="mlabel">進價</span><input type="number" class="form-control form-control-sm ov-cost-input" data-pid="${p.id}" value="${p.cost ?? ''}" placeholder="待補" min="0" step="any" aria-label="進價"></div>
    <div class="c-price ov-num"><span class="mlabel">售價</span><span class="ov-money">${rangeStack(pm.price, money)}</span></div>
    ${numCell('c-reg', '一般日淨利', pm.regularProfit, pm.regularMargin, low, isShop, bd)}
    ${numCell('c-evt', '促銷檔期淨利', pm.eventProfit, pm.eventMargin, low, isShop, bd)}
    <div class="c-act"><div class="dropdown">
      <button class="btn btn-sm btn-link text-secondary" data-bs-toggle="dropdown" aria-label="更多操作"><i class="bi bi-three-dots-vertical"></i></button>
      <ul class="dropdown-menu dropdown-menu-end">
        <li><button class="dropdown-item" data-action="product-edit" data-pid="${p.id}"><i class="bi bi-pencil"></i> 編輯</button></li>
        ${single ? `<li><a class="dropdown-item" href="index.html?${SD.quickCalcQuery(shop, p, p.variations[0], ctx)}" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-right"></i> 在快速計算開啟</a></li>` : ''}
        <li><button class="dropdown-item" data-action="product-copy" data-pid="${p.id}"><i class="bi bi-copy"></i> 複製</button></li>
        ${others ? `<li><button class="dropdown-item" data-action="product-move" data-pid="${p.id}"><i class="bi bi-box-arrow-right"></i> 搬到其他賣場</button></li>
        <li><button class="dropdown-item" data-action="product-copyto" data-pid="${p.id}"><i class="bi bi-files"></i> 複製到其他賣場</button></li>` : ''}
        <li><hr class="dropdown-divider"></li>
        <li><button class="dropdown-item text-danger" data-action="product-delete" data-pid="${p.id}"><i class="bi bi-trash"></i> 刪除</button></li>
      </ul></div></div>
  </div>
  ${!single && ui.expanded.has(p.id) ? detailHtml(shop, p, pm) : ''}
</div>`;
            }).join('');
        }
        updateBulkUi(pageRows);
        updatePendingBadge();
    }

    function ovPageRows() {
        const start = (ui.ovPage - 1) * ui.ovPageSize;
        return overviewRows(currentShop()).slice(start, start + ui.ovPageSize);
    }

    function renderOvHead(show) {
        const head = $('ovHead');
        head.classList.toggle('d-none', !show);
        head.querySelectorAll('.ov-sort').forEach(b => {
            const on = ui.ovSort.key === b.dataset.key;
            const icon = !on ? 'bi-chevron-expand' : ui.ovSort.dir > 0 ? 'bi-caret-up-fill' : 'bi-caret-down-fill';
            b.classList.toggle('active', on);
            b.querySelector('i').className = `bi ${icon}`;
            b.setAttribute('aria-sort', !on ? 'none' : ui.ovSort.dir > 0 ? 'ascending' : 'descending');
            b.title = !on ? '點擊由低到高排序' : ui.ovSort.dir > 0 ? '目前由低到高，點擊改由高到低' : '目前由高到低，點擊恢復加入順序';
        });
    }

    function renderOvPager(total, pages) {
        const pager = $('ovPager');
        if (!total) { pager.innerHTML = ''; return; }
        const cur = ui.ovPage;
        // 頁碼：首尾＋目前頁前後各一頁，中間用…
        const nums = [...new Set([1, cur - 1, cur, cur + 1, pages])].filter(x => x >= 1 && x <= pages).sort((a, b) => a - b);
        const items = [];
        const btn = (page, label, { disabled = false, active = false, aria = '' } = {}) =>
            `<li class="page-item${disabled ? ' disabled' : ''}${active ? ' active' : ''}"><button type="button" class="page-link" data-action="ov-page" data-page="${page}"${disabled ? ' disabled' : ''}${active ? ' aria-current="page"' : ''}${aria ? ` aria-label="${aria}"` : ''}>${label}</button></li>`;
        items.push(btn(cur - 1, '<i class="bi bi-chevron-left"></i>', { disabled: cur <= 1, aria: '上一頁' }));
        nums.forEach((x, k) => {
            if (k && x - nums[k - 1] > 1) items.push('<li class="page-item disabled"><span class="page-link">…</span></li>');
            items.push(btn(x, x, { active: x === cur }));
        });
        items.push(btn(cur + 1, '<i class="bi bi-chevron-right"></i>', { disabled: cur >= pages, aria: '下一頁' }));
        pager.innerHTML = `<div class="ov-pager-size"><label for="ovPageSize">每頁</label>` +
            `<select class="form-select form-select-sm" id="ovPageSize">${OV_PAGE_SIZES.map(x => `<option value="${x}"${x === ui.ovPageSize ? ' selected' : ''}>${x}</option>`).join('')}</select>` +
            `<span>筆，共 ${total} 筆</span></div>` +
            (pages > 1 ? `<nav aria-label="商品分頁"><ul class="pagination pagination-sm mb-0">${items.join('')}</ul></nav>` : '');
    }

    function breakdownHtml(shop, p, v, m) {
        const isShop = shop.settings.seller === 'shop';
        const line = (label, a, b) => `<tr><td>${label}</td><td class="text-end">${a}</td>${isShop ? '' : `<td class="text-end">${b}</td>`}</tr>`;
        const R = m.regular, E = m.event;
        const cost = m.hasCost ? money(p.costTax === 'exc' ? m.cost * 1.05 : m.cost) : '待補';
        return `<table class="table table-sm mb-0"><thead><tr><th>費用拆解：${esc(v.name || p.name)}（售價 ${money(m.price)}）</th><th class="text-end">一般日</th>${isShop ? '' : '<th class="text-end">促銷檔期</th>'}</tr></thead><tbody>` +
            line(`成交手續費`, `${money(R.transFee)} <small>(${R.transPct}%)</small>`, `${money(E.transFee)} <small>(${E.transPct}%)</small>`) +
            line(`金流與系統處理費 (${m.settings.paymentPct}%)`, money(R.payFee), money(E.payFee)) +
            (isShop ? '' : line(esc(R.shipLabel || '免運活動服務費'), money(R.shipFee), money(E.shipFee))) +
            (R.cashFee ? line('蝦幣回饋', money(R.cashFee), money(E.cashFee)) : '') +
            (R.preFee ? line(`預購訂單服務費`, money(R.preFee), money(E.preFee)) : '') +
            (shop.settings.tax !== '0' ? line('應繳稅額', money(R.payableTax), money(E.payableTax)) : '') +
            (R.agentFee ? line('代開發票', money(R.agentFee), money(E.agentFee)) : '') +
            line('<strong>合計扣除</strong>', `<strong>${money(R.totalDeduction)}</strong>`, `<strong>${money(E.totalDeduction)}</strong>`) +
            line(`進價${p.costTax === 'exc' ? '（未稅，現金支出 ×1.05）' : ''}`, cost, cost) +
            line('<strong>淨利</strong>', m.hasCost ? `<strong class="${R.profit < 0 ? 'ov-loss' : ''}">${money(R.profit)}</strong>` : '—', m.hasCost ? `<strong class="${E.profit < 0 ? 'ov-loss' : ''}">${money(E.profit)}</strong>` : '—') +
            '</tbody></table>';
    }

    function detailHtml(shop, p, pm) {
        const isShop = shop.settings.seller === 'shop';
        // 淨利欄：桌機 hover、手機點擊時浮出該規格的費用拆解（見 bindBreakdownPopover）
        const profitCell = (v, m, ok, r) => {
            const val = ok ? `${money(r.profit)}<br><small>${pct(r.margin)}</small>` : '—';
            const cls = ok && r.profit < 0 ? 'ov-loss' : '';
            if (!m.hasRate) return `<td class="text-end ${cls}">${val}</td>`;
            return `<td class="text-end ${cls}">${bdTrigger(val)}</td>`;
        };
        const varRows = pm.rows.map(({ v, m }) => {
            const ok = m.hasCost && m.hasRate;
            return `<tr class="ov-bd-scope">
<td>${esc(v.name || '（單一規格）')}${v.draft ? ' <span class="badge bg-info text-dark status-pill">調價中</span>' : ''}${m.hasRate ? `<template class="ov-bd-tpl">${breakdownHtml(shop, p, v, m)}</template>` : ''}</td>
<td class="text-end">${money(m.price)}</td>
<td class="text-end">${v.stock ?? '—'}</td>
<td style="width: 110px;"><input type="number" class="form-control form-control-sm ov-vcost-input" data-pid="${p.id}" data-vid="${v.id}" value="${v.cost ?? ''}" placeholder="${p.cost != null ? '同商品' : '待補'}" min="0" step="any" aria-label="規格進價"></td>
${profitCell(v, m, ok, m.regular)}
${isShop ? '' : profitCell(v, m, ok, m.event)}
<td class="text-end"><a class="btn btn-sm btn-link p-0" href="index.html?${SD.quickCalcQuery(shop, p, v, ctx)}" target="_blank" rel="noopener" title="在快速計算開啟"><i class="bi bi-box-arrow-up-right"></i></a></td>
</tr>`;
        }).join('');
        const noRate = pm.rows.some(r => !r.m.hasRate)
            ? `<div class="small text-warning"><i class="bi bi-exclamation-triangle"></i> 還沒有成交手續費率，請<a href="#" data-action="product-edit" data-pid="${p.id}">選類別</a>。</div>` : '';
        const catInfo = p.fee.mode !== 'manual' && p.fee.catLabel ? `<div class="small text-muted mt-1">蝦皮分類：${esc(p.fee.catId)} ${esc(p.fee.catLabel)}</div>` : '';
        return `<div class="ov-detail"><div class="table-responsive"><table class="table table-sm align-middle mb-2">
<thead><tr><th>規格</th><th class="text-end">售價</th><th class="text-end">庫存</th><th>進價（覆寫）</th><th class="text-end">一般日淨利</th>${isShop ? '' : '<th class="text-end">促銷檔期淨利</th>'}<th></th></tr></thead>
<tbody>${varRows}</tbody></table></div>
${noRate}${catInfo}</div>`;
    }

    // ---------- 費用拆解浮動選單 ----------
    function bindBreakdownPopover() {
        const pop = document.createElement('div');
        pop.className = 'ov-bd-pop';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', '費用拆解');
        pop.hidden = true;
        document.body.appendChild(pop);
        const hoverMq = window.matchMedia('(hover: hover) and (pointer: fine)');
        let cur = null, hideTimer = null;

        const place = trig => {
            const GAP = 6, M = 8;
            const r = trig.getBoundingClientRect();
            const vw = document.documentElement.clientWidth, vh = window.innerHeight;
            pop.style.maxHeight = `${vh - M * 2}px`;
            pop.style.maxWidth = `${vw - M * 2}px`;
            const w = pop.offsetWidth, h = pop.offsetHeight;
            const below = vh - r.bottom - GAP - M, above = r.top - GAP - M;
            let top = h <= below ? r.bottom + GAP : h <= above ? r.top - GAP - h : (below >= above ? vh - M - h : M);
            top = Math.max(M, Math.min(top, vh - M - h));
            let left = Math.min(r.right - w, vw - M - w);
            left = Math.max(M, left);
            pop.style.top = `${top}px`;
            pop.style.left = `${left}px`;
        };
        const show = trig => {
            clearTimeout(hideTimer);
            if (cur === trig) return;
            const tpl = trig.closest('.ov-bd-scope')?.querySelector('template.ov-bd-tpl');
            if (!tpl) return;
            if (cur) cur.setAttribute('aria-expanded', 'false');
            cur = trig;
            trig.setAttribute('aria-expanded', 'true');
            pop.innerHTML = tpl.innerHTML;
            pop.hidden = false;
            pop.scrollTop = 0;
            place(trig);
        };
        const hide = () => {
            clearTimeout(hideTimer);
            if (cur) cur.setAttribute('aria-expanded', 'false');
            cur = null;
            pop.hidden = true;
        };
        const hideSoon = () => { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 150); };

        document.addEventListener('mouseover', e => {
            if (!hoverMq.matches) return;
            const trig = e.target.closest('.ov-bd-trigger');
            if (trig) show(trig);
            else if (pop.contains(e.target)) clearTimeout(hideTimer);
            else if (cur) hideSoon();
        });
        document.addEventListener('click', e => {
            const trig = e.target.closest('.ov-bd-trigger');
            if (trig) { cur === trig && !hoverMq.matches ? hide() : show(trig); return; }
            if (cur && !pop.contains(e.target)) hide();
        });
        document.addEventListener('focusin', e => {
            const trig = e.target.closest('.ov-bd-trigger');
            if (trig && hoverMq.matches) show(trig);
        });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && cur) { const t = cur; hide(); t.focus(); } });
        // 位置是 fixed，頁面捲動或縮放就收起（捲動浮動選單本身不算）
        window.addEventListener('scroll', e => { if (cur && !(e.target instanceof Node && pop.contains(e.target))) hide(); }, true);
        window.addEventListener('resize', () => { if (cur) hide(); });
        // 列表重繪後原觸發元素已不在 DOM
        new MutationObserver(() => { if (cur && !cur.isConnected) hide(); }).observe(document.body, { childList: true, subtree: true });
    }

    function updateBulkUi(rows) {
        const shop = currentShop();
        const ids = new Set(shop.products.map(p => p.id));
        [...ui.selected].forEach(id => { if (!ids.has(id)) ui.selected.delete(id); });
        const n = ui.selected.size;
        $('bulkDeleteBtn').classList.toggle('d-none', n === 0);
        $('bulkDeleteBtn').querySelector('span').textContent = n;
        const visible = (rows || []).map(r => r.p.id);
        const all = visible.length > 0 && visible.every(id => ui.selected.has(id));
        document.querySelectorAll('.ov-select-all').forEach(el => { el.checked = all; });
    }

    // ---------- 商品編輯 ----------
    let editing = null; // { pid|null, fee }
    function openProductModal(pid) {
        const shop = currentShop();
        const p = pid ? shop.products.find(x => x.id === pid) : SD.newProduct();
        editing = { pid: pid || null, fee: { ...p.fee }, shopee: !!p.shopeeItemId, prodInv: p.hasProdInv ?? null };
        $('productModalTitle').textContent = pid ? '編輯商品' : '新增商品';
        $('pmName').value = p.name;
        $('pmNote').value = p.note || '';
        $('pmCost').value = p.cost ?? '';
        $('pmCostInc').checked = p.costTax !== 'exc';
        $('pmPrice').value = p.variations[0].price || '';
        $('pmPriceWrap').classList.toggle('d-none', editing.shopee);
        $('pmPriceShopee').classList.toggle('d-none', !editing.shopee);
        document.querySelector(`input[name="pmPre"][value="${p.preorder || '0'}"]`).checked = true;
        renderPmProdInv();
        $('pmFrozen').checked = !!p.frozen;
        $('pmManualRate').value = p.fee.mode === 'manual' && p.fee.manualRate != null ? p.fee.manualRate : '';
        renderPmFee();
        modal('productModal').show();
    }

    // 商品進項發票：沒單獨設定（null）時勾選框顯示賣場預設值
    function renderPmProdInv() {
        const def = !!currentShop().settings.hasProdInv;
        $('pmProdInv').checked = editing.prodInv ?? def;
        $('pmProdInvHint').innerHTML = editing.prodInv == null
            ? `（跟隨賣場設定）`
            : `（已單獨設定，<a href="#" id="pmProdInvReset">改回跟隨賣場</a>）`;
    }

    function renderPmFee() {
        const shop = currentShop();
        const fake = { fee: editing.fee };
        const rate = SD.resolveRate(fake, shop.settings.seller, ctx);
        let text;
        if (editing.fee.mode === 'manual') text = rate != null ? `手動輸入 ${rate}%` : '未設定';
        else {
            const path = SD.resolveFeePath(fake, ctx);
            text = path ? `${path.join(' > ')}（${rate}%）` : '請選類別';
            if (editing.fee.mode === 'auto') text = '依蝦皮分類：' + text;
        }
        $('pmFeeText').textContent = text;
        $('pmFeeText').title = text;
    }

    function saveProductModal() {
        const shop = currentShop();
        const num = v => (v === '' || v == null ? null : Number(v));
        const fields = {
            name: $('pmName').value.trim(),
            note: $('pmNote').value.trim(),
            cost: num($('pmCost').value),
            costTax: $('pmCostInc').checked ? 'inc' : 'exc',
            preorder: document.querySelector('input[name="pmPre"]:checked').value,
            hasProdInv: editing.prodInv,
            frozen: $('pmFrozen').checked,
            fee: { ...editing.fee, needsReview: editing.fee.needsReview && editing.fee.mode === 'manual' },
        };
        if (!fields.name) { $('pmName').focus(); toast('請輸入商品名稱'); return; }
        if (fields.cost != null && (!Number.isFinite(fields.cost) || fields.cost < 0)) { toast('進價格式不對'); return; }
        let p;
        if (editing.pid) {
            p = shop.products.find(x => x.id === editing.pid);
            Object.assign(p, fields);
        } else {
            p = SD.newProduct(fields);
            shop.products.unshift(p);
        }
        if (!editing.shopee) p.variations[0].price = Math.max(0, Math.round(Number($('pmPrice').value) || 0));
        save();
        modal('productModal').hide();
        renderOverview();
        toast(editing.pid ? '已儲存' : '已新增商品');
    }

    // ---------- 類別選擇 ----------
    let catCb = null;
    function openCatPicker(hint, initialQuery, cb) {
        catCb = cb;
        $('catModalHint').textContent = hint || '';
        $('catSearch').value = initialQuery || '';
        renderCatList();
        modal('catModal').show();
        $('catModal').addEventListener('shown.bs.modal', () => $('catSearch').focus(), { once: true });
    }

    function renderCatList() {
        const shop = currentShop();
        const mall = shop && shop.settings.seller === 'mall';
        const q = $('catSearch').value.trim().toLowerCase();
        const terms = q.split(/\s+/).filter(Boolean);
        let list = ctx.feeIndex.list;
        if (terms.length) list = list.filter(l => { const t = l.path.join(' ').toLowerCase(); return terms.every(x => t.includes(x)); });
        const shown = list.slice(0, 120);
        $('catList').innerHTML = shown.map((l, i) => `<button type="button" class="list-group-item list-group-item-action" data-cat-index="${ctx.feeIndex.list.indexOf(l)}">
<div class="d-flex justify-content-between gap-2"><strong>${esc(catLeafName(l.path))}</strong><span class="text-nowrap">${mall ? l.mall : l.general}%</span></div>
<div class="cat-path">${esc(l.path.join(' > '))}</div></button>`).join('') +
            (list.length > shown.length ? `<div class="small text-muted p-2">還有 ${list.length - shown.length} 筆，請輸入關鍵字縮小範圍</div>` : '') +
            (!list.length ? '<div class="small text-muted p-2">找不到符合的類別</div>' : '');
    }

    // ---------- 已存設定匯入 ----------
    function openSavedModal() {
        const cfgs = quickSavedConfigs();
        $('savedList').innerHTML = cfgs.length ? cfgs.map(c => `<label class="list-group-item d-flex gap-2 align-items-start">
<input class="form-check-input mt-1 saved-chk" type="checkbox" value="${esc(c.id)}">
<span><strong>${esc(c.title)}</strong> ${c.rates === 'new' ? '<span class="badge bg-danger">12/11 新制</span>' : '<span class="badge bg-secondary">舊制</span>'}<br><small class="text-muted">${esc(c.summary || '')} · ${esc(c.date || '')}</small></span></label>`).join('')
            : '<div class="text-muted small p-2">快速計算還沒有已存的設定。</div>';
        $('savedApply').disabled = !cfgs.length;
        modal('savedModal').show();
    }

    function applySaved() {
        const shop = currentShop();
        const ids = [...document.querySelectorAll('.saved-chk:checked')].map(x => x.value);
        if (!ids.length) { toast('請勾選要匯入的設定'); return; }
        const cfgs = quickSavedConfigs().filter(c => ids.includes(String(c.id)));
        cfgs.forEach(c => shop.products.push(SD.productFromSavedConfig(c)));
        save();
        modal('savedModal').hide();
        renderOverview();
        toast(`已匯入 ${cfgs.length} 個商品，請記得重選類別`);
    }

    // ---------- 從快速計算加入 ----------
    let addCtx = null;
    function handleAddFromQuickCalc() {
        const q = new URLSearchParams(location.search);
        if (q.get('add') !== '1') return;
        history.replaceState({}, '', location.pathname);
        const qs = SD.settingsFromQuery(q);
        const cost = parseFloat(q.get('cost')) || 0;
        const sell = parseFloat(q.get('sell')) || 0;
        const p = SD.productFromQuery(q, `進價 $${Math.round(cost)} 售價 $${Math.round(sell)}`);
        addCtx = { q, qs, p };
        $('adName').value = p.name;
        $('adTarget').innerHTML = state.shops.map(s => `<option value="${esc(s.id)}"${s.id === state.activeShopId ? ' selected' : ''}>${esc(s.name)}</option>`).join('') +
            '<option value="__new__">＋ 用快速計算目前的設定建立新賣場</option>';
        if (!state.shops.length) $('adTarget').value = '__new__';
        $('adSummary').innerHTML = `進價 ${money(cost)}（${p.costTax === 'exc' ? '未稅' : '含稅'}）· 售價 ${money(p.variations[0].price)} · 成交手續費 ${p.fee.manualRate}%` +
            (p.preorder !== '0' ? ` · 預購 ${p.preorder}%` : '') + (p.frozen ? ' · 冷凍' : '');
        renderAddDiff();
        modal('addModal').show();
    }

    function settingValueLabel(key, v) {
        if (key === 'hasProdInv' || key === 'hasFeeInv' || key === 'first5') return v ? '是' : '否';
        return (LABELS[key] && LABELS[key][v]) || String(v);
    }

    function renderAddDiff() {
        const target = state.shops.find(s => s.id === $('adTarget').value);
        if (!target) { $('adDiff').innerHTML = '<div class="small text-muted">新賣場會沿用快速計算目前的賣家類型、免運方案、蝦幣回饋、稅務與分期設定。</div>'; return; }
        const diff = SD.settingsDiff(addCtx.qs, target.settings);
        $('adDiff').innerHTML = diff.length
            ? `<div class="alert alert-warning small mb-0"><div class="mb-1"><i class="bi bi-exclamation-triangle"></i> 快速計算的設定和「${esc(target.name)}」不同，獲利會依賣場設定重算：</div><ul class="mb-0 ps-3">${diff.map(d => `<li>${d.label}：快速計算「${esc(settingValueLabel(d.key, d.from))}」→ 賣場「${esc(settingValueLabel(d.key, d.to))}」</li>`).join('')}</ul></div>`
            : '<div class="small text-success"><i class="bi bi-check-circle"></i> 賣場設定和快速計算相同。</div>';
    }

    function applyAdd() {
        const name = $('adName').value.trim();
        if (!name) { toast('請輸入商品名稱'); return; }
        let target = state.shops.find(s => s.id === $('adTarget').value);
        if (!target) target = createShop('我的賣場' + (state.shops.length ? ' ' + (state.shops.length + 1) : ''), addCtx.qs);
        addCtx.p.name = name;
        target.products.unshift(addCtx.p);
        state.activeShopId = target.id;
        save();
        modal('addModal').hide();
        render();
        toast(`已加入「${target.name}」`);
    }

    // ---------- 從蝦皮匯入 ----------
    const im = { files: [], b64: null, fileTime: null, plan: null, targetId: null, catPicks: {}, keepDrafts: true };

    function openImport() {
        Object.assign(im, { files: [], b64: null, plan: null, targetId: currentShop().id, catPicks: {}, keepDrafts: true });
        $('imFiles').value = '';
        $('imFileStatus').innerHTML = '';
        $('imPlan').innerHTML = '';
        $('imApply').disabled = true;
        $('imGuide').open = !currentShop().products.some(p => p.shopeeItemId);
        modal('importModal').show();
    }

    async function onImportFiles(fileList) {
        const files = [...fileList];
        const parsed = [];
        const status = [];
        im.b64 = null;
        for (const f of files) {
            try {
                const buf = await f.arrayBuffer();
                const r = await SX.parseShopeeXlsx(buf, f.name);
                if (!r.type) { status.push(`<div class="im-file text-danger"><i class="bi bi-x-circle"></i> ${esc(f.name)}：不是「價格及庫存」或「備貨天數」模板</div>`); continue; }
                if (parsed.some(x => x.type === r.type)) { status.push(`<div class="im-file text-warning"><i class="bi bi-exclamation-circle"></i> ${esc(f.name)}：重複的${r.type === 'sales' ? '「價格及庫存」' : '「備貨天數」'}，只用第一份</div>`); continue; }
                parsed.push(r);
                if (r.type === 'sales') { im.b64 = bufToB64(buf); im.fileTime = SX.fileTimestamp(f.name); }
                const ft = SX.fileTimestamp(f.name);
                const old = ft && Date.now() - ft > SD.STALE_MS;
                status.push(`<div class="im-file text-success"><i class="bi bi-check-circle"></i> ${esc(f.name)}：${r.type === 'sales' ? '價格及庫存' : '備貨天數'}，${r.rows.length} 個規格（蝦皮賣場 ${esc(r.shopId || '?')}${ft ? `，${fmtTime(ft)} 下載` : ''}）</div>` +
                    (old && r.type === 'sales' ? `<div class="im-file text-warning"><i class="bi bi-clock-history"></i> 這份檔案是 ${fmtTime(ft)} 從蝦皮下載的，已超過 24 小時，庫存可能已經變動；要調價或改庫存的話建議重新下載。</div>` : ''));
            } catch (e) {
                status.push(`<div class="im-file text-danger"><i class="bi bi-x-circle"></i> ${esc(f.name)}：${esc(e.message)}</div>`);
            }
        }
        const has = t => parsed.some(x => x.type === t);
        if (parsed.length && !has('sales')) status.push('<div class="im-file text-warning"><i class="bi bi-exclamation-triangle"></i> 缺「價格及庫存」：新商品需要它才有售價；只更新既有商品的分類／備貨天數可以不用。</div>');
        if (parsed.length && !has('dts')) status.push('<div class="im-file text-warning"><i class="bi bi-exclamation-triangle"></i> 缺「備貨天數」：新商品需要它才能對應手續費率；只更新既有商品的售價／庫存可以不用。</div>');
        $('imFileStatus').innerHTML = status.join('');
        im.files = parsed;
        im.catPicks = {};
        // 檔案的蝦皮賣場已綁在別的賣場 → 預設匯入那裡
        const fileShopId = (parsed[0] || {}).shopId;
        const bound = fileShopId && state.shops.find(s => s.shopeeShopId === fileShopId);
        im.targetId = bound ? bound.id : currentShop().id;
        renderImportPlan();
    }

    function renderImportPlan() {
        if (!im.files.length) { $('imPlan').innerHTML = ''; $('imApply').disabled = true; return; }
        const fileShopId = im.files[0].shopId;
        const target = im.targetId === '__new__' ? SD.newShop('蝦皮賣場 ' + (fileShopId || ''), currentShop().settings) : state.shops.find(s => s.id === im.targetId);
        const plan = SD.planImport(target, im.files, ctx);
        im.plan = plan;
        const out = [];
        out.push(`<div class="mb-2"><label class="form-label small mb-1" for="imTarget">匯入到</label><select class="form-select form-select-sm" id="imTarget">${state.shops.map(s => `<option value="${esc(s.id)}"${s.id === im.targetId ? ' selected' : ''}>${esc(s.name)}${s.shopeeShopId ? `（蝦皮賣場 ${esc(s.shopeeShopId)}）` : ''}</option>`).join('')}<option value="__new__"${im.targetId === '__new__' ? ' selected' : ''}>＋ 建立新賣場（沿用目前賣場的設定）</option></select></div>`);
        plan.errors.forEach(e => out.push(`<div class="alert alert-danger small py-2">${esc(e)}</div>`));
        plan.warnings.forEach(w => out.push(`<div class="alert alert-warning small py-2"><i class="bi bi-exclamation-triangle"></i> ${esc(w.text)}</div>`));
        out.push(`<table class="table table-sm im-table mb-2"><tbody>
<tr><td>新增商品</td><td class="text-end">${plan.add.length}</td></tr>
<tr><td>更新既有商品（售價、庫存、名稱、分類、備貨天數以新檔為準；進價、備註、手動類別保留）</td><td class="text-end">${plan.update.length}</td></tr>
${plan.missing.length ? `<tr><td>這次檔案沒有的商品（保留，標示「本次未匯入」）</td><td class="text-end">${plan.missing.length}</td></tr>` : ''}
${plan.needOther.length ? `<tr class="text-warning"><td>新商品缺另一份檔案，這次不會新增</td><td class="text-end">${plan.needOther.length}</td></tr>` : ''}
</tbody></table>`);
        const cs = plan.catStats;
        if (plan.dts) out.push(`<div class="small text-muted mb-2">手續費類別自動對應：完全相同 ${cs.exact}、套用上層類別費率 ${cs.parent}${cs.alias ? `、別名 ${cs.alias}` : ''}${cs.override ? `、沿用你指定的 ${cs.override}` : ''}${cs.none ? `、<span class="text-warning">對不到 ${cs.none}</span>` : ''}</div>`);
        if (plan.unmatched.length) {
            out.push(`<div class="alert alert-warning small py-2"><div class="mb-1">以下蝦皮分類對不到費率表，請選擇對應的類別（之後同一個分類會自動套用）；不選的話商品會標「請選類別」。</div>
${plan.unmatched.map(u => `<div class="d-flex flex-wrap align-items-center gap-2 py-1 border-top"><span class="flex-grow-1">${esc(u.path ? u.path.join(' > ') : u.label)} <span class="text-muted">（${esc(u.catId)}，${u.count} 個商品）</span>${im.catPicks[u.catId] ? `<br><span class="text-success"><i class="bi bi-check"></i> ${esc(im.catPicks[u.catId].join(' > '))}</span>` : ''}</span><button type="button" class="btn btn-sm btn-outline-secondary" data-action="im-pick" data-cat="${esc(u.catId)}">選類別</button></div>`).join('')}</div>`);
        }
        if (plan.pendingDrafts.length) {
            out.push(`<div class="alert alert-info small py-2"><div class="mb-1">有 ${plan.pendingDrafts.length} 個規格的調價／庫存修改還沒匯出：</div>
<div class="form-check"><input class="form-check-input" type="radio" name="imKeep" id="imKeep1" value="1" ${im.keepDrafts ? 'checked' : ''}><label class="form-check-label" for="imKeep1">保留修改（仍會出現在「調價與庫存」）</label></div>
<div class="form-check"><input class="form-check-input" type="radio" name="imKeep" id="imKeep0" value="0" ${im.keepDrafts ? '' : 'checked'}><label class="form-check-label" for="imKeep0">捨棄修改，以蝦皮最新資料為準</label></div></div>`);
        }
        if (plan.exportedMatched.length) out.push(`<div class="small text-success mb-1"><i class="bi bi-check-circle"></i> ${plan.exportedMatched.length} 個已匯出的修改在蝦皮已生效，會清除標記。</div>`);
        if (plan.exportedMismatched.length) {
            out.push(`<div class="alert alert-warning small py-2"><div class="mb-1"><i class="bi bi-exclamation-triangle"></i> ${plan.exportedMismatched.length} 個已匯出的修改和蝦皮目前的值不同，可能還沒上傳或上傳失敗（請看蝦皮回傳檔的「失敗原因」欄）。這些修改會改回「待匯出」：</div>
<ul class="mb-0 ps-3">${plan.exportedMismatched.slice(0, 8).map(({ product, v, row }) => `<li>${esc(product.name.slice(0, 30))} ${esc(v.name)}：修改 ${v.draft.price != null ? money(v.draft.price) : ''}${v.draft.stock != null ? ` 庫存 ${v.draft.stock}` : ''}，蝦皮 ${money(row.price)} 庫存 ${row.stock}</li>`).join('')}${plan.exportedMismatched.length > 8 ? '<li>…</li>' : ''}</ul></div>`);
        }
        $('imPlan').innerHTML = out.join('');
        $('imApply').disabled = plan.errors.length > 0 || (plan.add.length + plan.update.length) === 0;
    }

    function applyImport() {
        const plan = im.plan;
        if (!plan || plan.errors.length) return;
        const snapshot = JSON.stringify(state); // 存檔失敗時整個還原，不留半套
        let target;
        if (im.targetId === '__new__') {
            target = SD.newShop('蝦皮賣場 ' + (plan.fileShopId || ''), currentShop().settings);
            state.shops.push(target);
            im.plan = SD.planImport(target, im.files, ctx);
        } else target = state.shops.find(s => s.id === im.targetId);
        SD.applyImportPlan(target, im.plan, ctx, { keepPendingDrafts: im.keepDrafts, catPicks: im.catPicks, salesFileB64: im.b64, salesFileTime: im.fileTime });
        state.activeShopId = target.id;
        if (!save()) {
            // 多半是原檔太大：不存原檔再試一次
            target.salesFile = null;
            if (save()) toast('已匯入，但瀏覽器空間不足，沒有保存「價格及庫存」原檔；要產生批次更新檔時請重新上傳。');
            else {
                state = JSON.parse(snapshot);
                ctx.state = state;
                render();
                toast('匯入失敗：瀏覽器儲存空間不足，資料沒有變動。請先用「備份」匯出，再刪除不需要的賣場。');
                return;
            }
        } else toast(`已匯入：新增 ${plan.add.length}、更新 ${plan.update.length}`);
        modal('importModal').hide();
        render();
    }

    // ---------- 調價與庫存 ----------
    function repriceItems(shop) {
        const q = $('rpSearch').value.trim().toLowerCase();
        const filter = $('rpFilter').value;
        const groups = [];
        for (const p of shop.products) {
            if (!p.shopeeItemId) continue;
            const matchP = !q || p.name.toLowerCase().includes(q);
            const vs = p.variations.filter(v => {
                if (q && !matchP && !(v.name || '').toLowerCase().includes(q)) return false;
                if (filter === 'changed') return v.draft && v.draft.status === 'pending';
                if (filter === 'exported') return v.draft && v.draft.status === 'exported';
                if (filter === 'loss') { const m = SD.variationMetrics(shop, p, v, ctx); return m.hasCost && m.hasRate && (m.regular.profit < 0 || m.event.profit < 0); }
                return true;
            });
            if (vs.length) groups.push({ p, vs });
        }
        return groups;
    }

    function rpCells(shop, p, v, price) {
        const m = SD.variationMetrics(shop, p, v, ctx, price);
        const ok = m.hasCost && m.hasRate;
        const cell = (r) => ok ? `<span class="${r.profit < 0 ? 'ov-loss' : ''}">${money(r.profit)}</span><span class="pct d-block small">${pct(r.margin)}</span>` : '<span class="text-muted small">' + (m.hasRate ? '待補進價' : '請選類別') + '</span>';
        return { reg: '<span class="mlabel">一般日</span>' + cell(m.regular), evt: shop.settings.seller === 'shop' ? '' : '<span class="mlabel">促銷檔期</span>' + cell(m.event), m };
    }

    function renderReprice() {
        const shop = currentShop();
        if (!shop) return;
        const hasShopee = shop.products.some(p => p.shopeeItemId);
        $('rpEmpty').classList.toggle('d-none', hasShopee);
        $('rpBody').classList.toggle('d-none', !hasShopee);
        $('rpFooter').classList.toggle('d-none', !hasShopee);
        updatePendingBadge();
        if (!hasShopee) return;

        if (shop.salesFile) {
            const stale = SD.isStale(shop);
            const ft = shop.salesFile.fileTime;
            $('rpFreshness').innerHTML = `<div class="alert ${stale ? 'alert-warning' : 'alert-light border'} py-2 mb-0"><i class="bi bi-clock-history"></i> 售價與庫存來自 <strong>${fmtTime(SD.salesDataTime(shop))}</strong> ${ft ? '從蝦皮下載' : '匯入'}的「價格及庫存」檔。` +
                (stale ? ' 已超過 24 小時，期間的訂單可能讓庫存變少；建議先到蝦皮重新下載、匯入後再改。' : '') +
                ` <a href="#" data-action="import-shopee">重新匯入</a></div>`;
        } else {
            $('rpFreshness').innerHTML = `<div class="alert alert-warning py-2 mb-0"><i class="bi bi-exclamation-triangle"></i> 還沒有「價格及庫存」原檔，產生批次更新檔前請先<a href="#" data-action="import-shopee">匯入</a>。</div>`;
        }

        const groups = repriceItems(shop);
        const isShop = shop.settings.seller === 'shop';
        const vids = new Set(shop.products.flatMap(p => p.variations.map(v => v.id)));
        [...ui.rpSelected].forEach(id => { if (!vids.has(id)) ui.rpSelected.delete(id); });
        $('rpList').innerHTML = groups.length ? groups.map(({ p, vs }) => `<div class="rp-group">${esc(p.name)} <span class="text-muted fw-normal small">${p.cost != null ? '進價 ' + money(p.cost) : '待補進價'}</span></div>` +
            vs.map(v => {
                const c = rpCells(shop, p, v);
                const d = v.draft;
                const pill = d ? (d.status === 'exported' ? '<span class="badge bg-secondary status-pill">已匯出，待蝦皮更新</span>' : '<span class="badge bg-warning text-dark status-pill">待匯出</span>') : '';
                return `<div class="rp-row" data-pid="${p.id}" data-vid="${v.id}">
<div class="c-chk"><input type="checkbox" class="form-check-input rp-chk" data-vid="${v.id}" ${ui.rpSelected.has(v.id) ? 'checked' : ''} aria-label="選取"></div>
<div class="c-name">${esc(v.name || '（單一規格）')} ${pill}</div>
<div class="c-cost small">${money(SD.variationCost(p, v))}</div>
<div class="c-price"><span class="mlabel">售價</span><input type="number" class="form-control form-control-sm rp-price ${d && d.price != null ? 'changed' : ''}" value="${SD.effectivePrice(v)}" min="1" max="499999" step="1" data-pid="${p.id}" data-vid="${v.id}" aria-label="售價">${d && d.price != null ? `<div class="orig">原 ${money(v.price)}</div>` : ''}</div>
<div class="c-stock"><span class="mlabel">庫存</span><input type="number" class="form-control form-control-sm rp-stock ${d && d.stock != null ? 'changed' : ''}" value="${d && d.stock != null ? d.stock : (v.stock ?? '')}" min="0" step="1" data-pid="${p.id}" data-vid="${v.id}" aria-label="庫存">${d && d.stock != null ? `<div class="orig">原 ${v.stock ?? '—'}</div>` : ''}</div>
<div class="c-reg ov-num">${c.reg}</div>
<div class="c-evt ov-num">${isShop ? '' : c.evt}</div>
</div>`;
            }).join('')).join('') : '<div class="text-center text-muted py-4">沒有符合條件的規格</div>';

        const visible = groups.flatMap(g => g.vs.map(v => v.id));
        $('rpSelectAll').checked = visible.length > 0 && visible.every(id => ui.rpSelected.has(id));
        $('rpSelCount').textContent = ui.rpSelected.size;
        updateRpFooter();
    }

    function updateRpFooter() {
        const shop = currentShop();
        const pending = SD.pendingChanges(shop).length;
        const exported = shop.products.reduce((n, p) => n + p.variations.filter(v => v.draft && v.draft.status === 'exported').length, 0);
        $('rpFooterText').innerHTML = `<strong>${pending}</strong> 個規格待匯出` + (exported ? ` · ${exported} 個已匯出、待蝦皮更新` : '');
        $('rpFooter').querySelector('button').disabled = pending === 0;
        updatePendingBadge();
    }

    function updatePendingBadge() {
        const shop = currentShop();
        const n = shop ? SD.pendingChanges(shop).length : 0;
        $('pendingBadge').textContent = n;
        $('pendingBadge').classList.toggle('d-none', n === 0);
    }

    function findVar(pid, vid) {
        const p = currentShop().products.find(x => x.id === pid);
        return p ? { p, v: p.variations.find(x => x.id === vid) } : {};
    }

    function refreshRpRow(row) {
        const shop = currentShop();
        const { p, v } = findVar(row.dataset.pid, row.dataset.vid);
        if (!v) return;
        const priceInput = row.querySelector('.rp-price');
        const typed = parseInt(priceInput.value, 10);
        const c = rpCells(shop, p, v, Number.isFinite(typed) ? typed : SD.effectivePrice(v));
        row.querySelector('.c-reg').innerHTML = c.reg;
        row.querySelector('.c-evt').innerHTML = shop.settings.seller === 'shop' ? '' : c.evt;
    }

    function commitRp(input) {
        const field = input.classList.contains('rp-price') ? 'price' : 'stock';
        const { v } = findVar(input.dataset.pid, input.dataset.vid);
        if (!v) return;
        const raw = input.value.trim();
        const val = raw === '' ? (field === 'price' ? v.price : v.stock) : Math.round(Number(raw));
        if (!Number.isFinite(val)) return;
        SD.setDraft(v, field, val);
        save();
        renderReprice();
        renderOverviewSoon();
    }

    let ovTimer = null;
    function renderOverviewSoon() { clearTimeout(ovTimer); ovTimer = setTimeout(renderOverview, 50); }

    function selectedVariations() {
        const shop = currentShop();
        const out = [];
        for (const p of shop.products) for (const v of p.variations) if (ui.rpSelected.has(v.id) && p.shopeeItemId) out.push({ p, v });
        return out;
    }

    function roundPrice(x, mode) {
        let n;
        if (mode === '10') n = Math.round(x / 10) * 10;
        else if (mode === '9') n = Math.round(x / 10) * 10 - 1;
        else n = Math.round(x);
        return Math.max(1, n);
    }

    function rpAdjust() {
        const sel = selectedVariations();
        if (!sel.length) { toast('請先勾選規格'); return; }
        const val = parseFloat($('rpAdjValue').value);
        if (!Number.isFinite(val)) { toast('請輸入調整數字'); return; }
        const type = $('rpAdjType').value, mode = $('rpRound').value;
        let skipped = 0;
        sel.forEach(({ v }) => {
            const base = v.price; // 以蝦皮目前售價為基準，重複套用不會累加
            if (!(base >= 1)) { skipped++; return; }
            SD.setDraft(v, 'price', roundPrice(type === 'pct' ? base * (1 + val / 100) : base + val, mode));
        });
        save();
        renderReprice();
        renderOverviewSoon();
        toast(`已調整 ${sel.length - skipped} 個規格（以蝦皮原價為基準）` + (skipped ? `，${skipped} 個沒有原價而略過` : ''));
    }

    function rpMargin() {
        const shop = currentShop();
        const sel = selectedVariations();
        if (!sel.length) { toast('請先勾選規格'); return; }
        const margin = parseFloat($('rpMargin').value);
        if (!Number.isFinite(margin)) { toast('請輸入目標利潤率'); return; }
        const isEvent = $('rpMarginScenario').value === 'event';
        let ok = 0, skip = 0;
        sel.forEach(({ p, v }) => {
            const price = SD.requiredPrice(shop, p, v, ctx, margin, isEvent);
            if (price) { SD.setDraft(v, 'price', price); ok++; } else skip++;
        });
        save();
        renderReprice();
        renderOverviewSoon();
        toast(`已回推 ${ok} 個規格的售價` + (skip ? `，${skip} 個缺進價或類別而略過` : ''));
    }

    function rpStock() {
        const sel = selectedVariations();
        if (!sel.length) { toast('請先勾選規格'); return; }
        const n = parseInt($('rpStock').value, 10);
        if (!Number.isInteger(n) || n < 0) { toast('庫存要是 0 以上的整數'); return; }
        sel.forEach(({ v }) => SD.setDraft(v, 'stock', n));
        save();
        renderReprice();
        toast(`已設定 ${sel.length} 個規格的庫存`);
    }

    function rpRestore(all) {
        const shop = currentShop();
        const targets = all
            ? shop.products.flatMap(p => p.variations.filter(v => v.draft))
            : selectedVariations().map(x => x.v).filter(v => v.draft);
        if (!targets.length) { toast('沒有可以恢復的修改'); return; }
        const doIt = () => { targets.forEach(v => { v.draft = null; }); save(); renderReprice(); renderOverviewSoon(); toast(`已恢復 ${targets.length} 個規格`); };
        if (all) confirmBox('全部恢復', `<p class="mb-0">要取消 ${targets.length} 個規格的修改（含已匯出、待蝦皮更新的標記），回到蝦皮匯入的售價與庫存嗎？</p>`, '全部恢復', doIt);
        else doIt();
    }

    // ---------- 產生批次更新檔 ----------
    // 原檔裡找得到的待匯出規格（找不到的：規格在蝦皮已刪除、或原檔是另一次匯出）
    let exportCtx = null;
    async function openExport() {
        const shop = currentShop();
        const all = SD.pendingChanges(shop);
        let inFile = null;
        if (shop.salesFile) {
            try { inFile = await SX.salesVariationIds(b64ToBytes(shop.salesFile.b64)); } catch (e) { inFile = null; }
        }
        const changes = inFile ? all.filter(c => inFile.has(c.v.shopeeVarId)) : [];
        const skipped = inFile ? all.filter(c => !inFile.has(c.v.shopeeVarId)) : [];
        const problems = SD.validateChanges(shop, changes);
        exportCtx = { changes };
        const out = [];
        if (!shop.salesFile || !inFile) out.push('<div class="alert alert-danger small">找不到可用的「價格及庫存」原檔，請先重新匯入。</div>');
        else if (SD.isStale(shop)) out.push(`<div class="alert alert-warning small"><i class="bi bi-clock-history"></i> 資料來自 ${fmtTime(SD.salesDataTime(shop))}，已超過 24 小時。下表每一列的庫存都會寫回檔案，期間若有賣出可能造成超賣；建議先到蝦皮重新下載、匯入後再產生。</div>`);
        if (problems.length) {
            out.push(`<div class="alert alert-danger small"><div class="mb-1">以下問題要先修正（蝦皮會拒收）：</div><ul class="mb-0 ps-3">${problems.map(x => `<li>${esc(x.product.name.slice(0, 40))}${x.v ? ' ' + esc(x.v.name) : ''}：${esc(x.text)}</li>`).join('')}</ul></div>`);
        }
        if (skipped.length) {
            out.push(`<div class="alert alert-secondary small"><div class="mb-1">${skipped.length} 個修改不在目前保存的「價格及庫存」原檔裡（可能已在蝦皮刪除），這次不會匯出，修改仍保留：</div><ul class="mb-0 ps-3">${skipped.slice(0, 8).map(({ product, v }) => `<li>${esc(product.name.slice(0, 40))} ${esc(v.name)}</li>`).join('')}${skipped.length > 8 ? '<li>…</li>' : ''}</ul></div>`);
        }
        if (changes.length) {
            out.push(`<p class="small mb-1">檔案只會包含下列 <strong>${changes.length}</strong> 個規格，其他規格不會出現在檔案裡，蝦皮也不會更動。</p>
<p class="small text-warning-emphasis mb-2"><i class="bi bi-exclamation-triangle"></i> 蝦皮的批次模板規定<strong>售價和庫存都必填</strong>，所以只改售價的規格，庫存也會照下表的數字（匯入當時的庫存）寫回；只改庫存的規格，售價同理。</p>`);
            out.push(`<div class="table-responsive"><table class="table table-sm small align-middle"><thead><tr><th>商品／規格</th><th class="text-end">寫入售價</th><th class="text-end">一般日淨利</th><th class="text-end">寫入庫存</th></tr></thead><tbody>` +
                changes.map(({ product, v }) => {
                    const before = SD.variationMetrics(shop, product, v, ctx, v.price);
                    const after = SD.variationMetrics(shop, product, v, ctx);
                    const ok = after.hasCost && after.hasRate;
                    const d = v.draft;
                    return `<tr><td>${esc(product.name.slice(0, 40))}<br><span class="text-muted">${esc(v.name || '（單一規格）')}</span></td>
<td class="text-end text-nowrap">${d.price != null ? `${money(v.price)} → <strong>${money(d.price)}</strong>` : `${money(v.price)}<br><small class="text-muted">匯入時的售價</small>`}</td>
<td class="text-end text-nowrap">${ok ? (d.price != null ? `${money(before.regular.profit)} → <strong class="${after.regular.profit < 0 ? 'ov-loss' : ''}">${money(after.regular.profit)}</strong>` : money(after.regular.profit)) : '—'}</td>
<td class="text-end text-nowrap">${d.stock != null ? `${v.stock ?? '—'} → <strong>${d.stock}</strong>` : `${v.stock ?? '—'}<br><small class="text-muted">匯入時的庫存</small>`}</td></tr>`;
                }).join('') + '</tbody></table></div>');
        }
        out.push(`<div class="small text-muted"><i class="bi bi-info-circle"></i> 下載後到蝦皮賣家中心 →「我的商品」→「批次工具」→「批次更新」→ 上傳檔案。上傳後蝦皮會回傳結果，失敗的列會寫在「失敗原因」欄。下次從蝦皮匯入時，已生效的修改會自動清除標記。</div>`);
        $('exportBody').innerHTML = out.join('');
        $('exportOk').disabled = !inFile || problems.length > 0 || !changes.length;
        modal('exportModal').show();
    }

    async function doExport() {
        const shop = currentShop();
        const changes = exportCtx ? exportCtx.changes : [];
        if (!changes.length) return;
        const map = new Map(changes.map(({ v }) => [v.shopeeVarId, { price: SD.effectivePrice(v), stock: v.draft.stock != null ? v.draft.stock : v.stock }]));
        $('exportOk').disabled = true;
        try {
            const { bytes } = await SX.buildSalesUpdate(b64ToBytes(shop.salesFile.b64), map);
            // 先把「已匯出」存起來，存不了就不下載，避免重新整理後又被當成待匯出
            const prev = changes.map(({ v }) => v.draft.status);
            SD.markExported(changes);
            if (!save()) {
                changes.forEach(({ v }, i) => { v.draft.status = prev[i]; });
                $('exportOk').disabled = false;
                return;
            }
            const d = new Date();
            const p = n => String(n).padStart(2, '0');
            const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
            download(`mass_update_sales_info_${shop.shopeeShopId || 'shop'}_${ts}.xlsx`, new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
            modal('exportModal').hide();
            renderReprice();
            renderOverviewSoon();
            toast(`已下載批次更新檔（${changes.length} 個規格）`);
        } catch (e) {
            toast('產生失敗：' + e.message);
            $('exportOk').disabled = false;
        }
    }

    // ---------- 賣場設定 ----------
    function renderSettings() {
        const shop = currentShop();
        if (!shop) return;
        const st = shop.settings;
        const f = $('settingsForm');
        ['seller', 'shipPlan', 'cashback', 'cashbackTerm', 'tax'].forEach(name => {
            const el = f.querySelector(`input[name="${name}"][value="${st[name]}"]`);
            if (el) el.checked = true;
        });
        $('stProdInv').checked = !!st.hasProdInv;
        $('stFeeInv').checked = !!st.hasFeeInv;
        $('stFirst5').checked = !!st.first5;
        $('stLowMargin').value = st.lowMargin;
        const isShop = st.seller === 'shop';
        f.querySelectorAll('.st-not-shop').forEach(el => el.classList.toggle('d-none', isShop));
        f.querySelectorAll('.st-only-shop').forEach(el => el.classList.toggle('d-none', !isShop));
        $('stCashTermWrap').classList.toggle('d-none', st.cashback === '0');
        $('stFeeInvWrap').classList.toggle('d-none', !(st.tax === '5' || st.tax === '5_plus'));
        $('stShopeeId').textContent = shop.shopeeShopId ? `已綁定蝦皮賣場 ID：${shop.shopeeShopId}（匯入其他賣場的檔案時會提醒）` : '';
    }

    function onSettingsChange() {
        const shop = currentShop();
        const f = $('settingsForm');
        const st = shop.settings;
        ['seller', 'shipPlan', 'cashback', 'cashbackTerm', 'tax'].forEach(name => {
            const el = f.querySelector(`input[name="${name}"]:checked`);
            if (el) st[name] = el.value;
        });
        st.hasProdInv = $('stProdInv').checked;
        st.hasFeeInv = $('stFeeInv').checked;
        st.first5 = $('stFirst5').checked;
        const lm = parseFloat($('stLowMargin').value);
        st.lowMargin = Number.isFinite(lm) ? lm : 5;
        save();
        renderSettings();
        renderOverview();
        renderReprice();
    }

    // ---------- 備份 ----------
    function exportBackup() {
        const data = { app: 'shopee-fee-myshop', version: 1, exportedAt: new Date().toISOString(), state };
        const d = new Date();
        download(`我的賣場備份-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`, JSON.stringify(data), 'application/json');
    }

    async function importBackup(file) {
        let data;
        try { data = JSON.parse(await file.text()); } catch (e) { toast('不是有效的備份檔'); return; }
        const incoming = data && data.app === 'shopee-fee-myshop' ? data.state : null;
        if (!incoming || !Array.isArray(incoming.shops)) { toast('不是「我的賣場」的備份檔'); return; }
        SD.migrateShops(incoming.shops);
        const n = incoming.shops.length;
        const products = incoming.shops.reduce((a, s) => a + (s.products || []).length, 0);
        confirmBox('從備份還原', `<p>備份裡有 ${n} 個賣場、${products} 個商品（${esc(data.exportedAt || '')}）。</p><p class="small text-muted mb-0">「取代」會刪掉目前這台裝置上的所有賣場資料；「合併」會把備份的賣場加在後面。</p>`, '取代目前資料', () => {
            state = { ...SD.emptyState(), ...incoming, catOverrides: incoming.catOverrides || {} };
            ctx.state = state;
            save();
            render();
            toast('已從備份還原');
        }, {
            text: '合併', cb: () => {
                incoming.shops.forEach(s => { s.id = SD.uid(); state.shops.push(s); });
                state.catOverrides = { ...(incoming.catOverrides || {}), ...state.catOverrides };
                save();
                render();
                toast(`已加入 ${n} 個賣場`);
            },
        });
    }

    // ---------- 商品操作 ----------
    function cloneProduct(p, keepShopee) {
        const c = JSON.parse(JSON.stringify(p));
        c.id = SD.uid();
        c.variations.forEach(v => { v.id = SD.uid(); });
        if (!keepShopee) {
            c.shopeeItemId = null;
            c.variations.forEach(v => { v.shopeeVarId = null; v.draft = null; });
            c.missingInLastImport = false;
        }
        return c;
    }

    let moveCtx = null;
    function openMove(pid, copy) {
        const shop = currentShop();
        const others = state.shops.filter(s => s.id !== shop.id);
        moveCtx = { pid, copy };
        $('moveModalTitle').textContent = copy ? '複製到其他賣場' : '搬到其他賣場';
        $('moveTarget').innerHTML = others.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
        modal('moveModal').show();
    }

    function applyMove() {
        const shop = currentShop();
        const target = state.shops.find(s => s.id === $('moveTarget').value);
        const p = shop.products.find(x => x.id === moveCtx.pid);
        if (!target || !p) return;
        const clash = p.shopeeItemId && target.products.some(x => x.shopeeItemId === p.shopeeItemId);
        const c = cloneProduct(p, !clash);
        target.products.unshift(c);
        if (!moveCtx.copy) shop.products = shop.products.filter(x => x.id !== p.id);
        save();
        modal('moveModal').hide();
        render();
        toast((moveCtx.copy ? '已複製到' : '已搬到') + `「${target.name}」` + (clash ? '（目標賣場已有同一個蝦皮商品，這份改為手動商品）' : ''));
    }

    // ---------- 事件 ----------
    function bindEvents() {
        document.addEventListener('click', e => {
            const t = e.target.closest('[data-action]');
            if (!t) return;
            const a = t.dataset.action;
            const shop = currentShop();
            if (a === 'toggle-detail') {
                if (e.target.closest('input, button, a, .dropdown, label')) return;
                const pid = t.dataset.pid;
                ui.expanded.has(pid) ? ui.expanded.delete(pid) : ui.expanded.add(pid);
                renderOverview();
                return;
            }
            if (a === 'ov-expand-all') {
                const ids = ui.ovMultiIds || [];
                if (t.dataset.mode === 'collapse') ids.forEach(id => ui.expanded.delete(id));
                else ids.forEach(id => ui.expanded.add(id));
                renderOverview();
                return;
            }
            if (t.tagName === 'A') e.preventDefault();
            switch (a) {
                case 'shop-new': nameBox('新增賣場', '我的賣場 ' + (state.shops.length + 1), name => { createShop(name, shop ? shop.settings : null); render(); }); break;
                case 'shop-rename': nameBox('重新命名', shop.name, name => { shop.name = name; save(); render(); }); break;
                case 'shop-delete': confirmBox('刪除賣場', `<p class="mb-0">確定要刪除「${esc(shop.name)}」和其中 ${shop.products.length} 個商品嗎？刪除後無法復原（可先用「備份」匯出）。</p>`, '刪除', () => {
                    state.shops = state.shops.filter(s => s.id !== shop.id);
                    state.activeShopId = state.shops[0] ? state.shops[0].id : null;
                    save(); render(); toast('已刪除賣場');
                }); break;
                case 'backup-export': exportBackup(); break;
                case 'backup-import': $('backupFile').click(); break;
                case 'csv-export': download(`${shop.name}-商品.csv`, SD.shopCsv(shop, ctx), 'text/csv;charset=utf-8'); break;
                case 'product-new': openProductModal(null); break;
                case 'product-edit': openProductModal(t.dataset.pid); break;
                case 'product-copy': {
                    const p = shop.products.find(x => x.id === t.dataset.pid);
                    const c = cloneProduct(p, false);
                    c.name = p.name + '（複製）';
                    shop.products.splice(shop.products.indexOf(p) + 1, 0, c);
                    save(); renderOverview(); toast('已複製' + (p.shopeeItemId ? '（複本不連結蝦皮商品）' : ''));
                    break;
                }
                case 'product-move': openMove(t.dataset.pid, false); break;
                case 'product-copyto': openMove(t.dataset.pid, true); break;
                case 'product-delete': {
                    const p = shop.products.find(x => x.id === t.dataset.pid);
                    confirmBox('刪除商品', `<p class="mb-0">確定要刪除「${esc(p.name)}」嗎？</p>`, '刪除', () => {
                        shop.products = shop.products.filter(x => x.id !== p.id);
                        save(); render(); toast('已刪除');
                    });
                    break;
                }
                case 'bulk-delete': {
                    const ids = [...ui.selected];
                    confirmBox('刪除商品', `<p class="mb-0">確定要刪除勾選的 ${ids.length} 個商品嗎？</p>`, '刪除', () => {
                        shop.products = shop.products.filter(x => !ui.selected.has(x.id));
                        ui.selected.clear();
                        save(); render(); toast(`已刪除 ${ids.length} 個商品`);
                    });
                    break;
                }
                case 'ov-sort': {
                    // 同一欄：由低到高 → 由高到低 → 恢復加入順序
                    const k = t.dataset.key, cur = ui.ovSort;
                    ui.ovSort = cur.key !== k ? { key: k, dir: 1 } : cur.dir > 0 ? { key: k, dir: -1 } : { key: null, dir: 1 };
                    ui.ovPage = 1;
                    renderOverview();
                    break;
                }
                case 'ov-page': ui.ovPage = Number(t.dataset.page); renderOverview(); $('ovHead').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); break;
                case 'goto-settings': bootstrap.Tab.getOrCreateInstance(document.querySelector('[data-tab="settings"]')).show(); break;
                case 'card-filter': {
                    const f = $('ovFilter');
                    f.value = f.value === t.dataset.filter ? 'all' : t.dataset.filter;
                    ui.ovPage = 1;
                    renderOverview();
                    break;
                }
                case 'import-shopee': openImport(); break;
                case 'import-saved': openSavedModal(); break;
                case 'im-pick': {
                    const catId = t.dataset.cat;
                    const u = im.plan.unmatched.find(x => x.catId === catId);
                    const hint = `蝦皮分類：${u.path ? u.path.join(' > ') : u.label}`;
                    modal('importModal').hide();
                    openCatPicker(hint, u.path ? u.path[u.path.length - 1].slice(0, 4) : '', path => { im.catPicks[catId] = path; });
                    $('catModal').addEventListener('hidden.bs.modal', () => { modal('importModal').show(); renderImportPlan(); }, { once: true });
                    break;
                }
                case 'rp-adjust': rpAdjust(); break;
                case 'rp-margin': rpMargin(); break;
                case 'rp-stock': rpStock(); break;
                case 'rp-restore-selected': rpRestore(false); break;
                case 'rp-restore-all': rpRestore(true); break;
                case 'export-open': openExport(); break;
            }
        });

        // 首次使用
        $('obCreate').addEventListener('click', () => {
            const name = $('obName').value.trim() || '我的賣場';
            const id = $('obFromSaved').value;
            let settings = null;
            if (id) {
                const cfg = quickSavedConfigs().find(c => String(c.id) === id);
                if (cfg) settings = SD.settingsFromQuery(new URLSearchParams(cfg.data || {}));
            }
            createShop(name, settings);
            render();
            toast('已建立賣場，接著加入商品');
        });

        $('shopSelect').addEventListener('change', e => { state.activeShopId = e.target.value; ui.ovPage = 1; ui.selected.clear(); ui.rpSelected.clear(); save(); render(); });
        $('nameModalOk').addEventListener('click', () => { const v = $('nameModalInput').value.trim(); if (!v) return; modal('nameModal').hide(); nameCb && nameCb(v); });
        $('nameModalInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('nameModalOk').click(); });
        $('confirmModalOk').addEventListener('click', () => { modal('confirmModal').hide(); confirmCb && confirmCb(); });
        $('backupFile').addEventListener('change', e => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; });

        // 總覽
        ['ovSearch', 'ovFilter'].forEach(id => $(id).addEventListener(id === 'ovSearch' ? 'input' : 'change', () => { ui.ovPage = 1; renderOverview(); }));
        $('ovPager').addEventListener('change', e => {
            if (e.target.id !== 'ovPageSize') return;
            ui.ovPageSize = Number(e.target.value) || 10;
            ui.ovPage = 1;
            renderOverview();
        });
        $('ovList').addEventListener('change', e => {
            const shop = currentShop();
            if (e.target.classList.contains('ov-chk')) {
                e.target.checked ? ui.selected.add(e.target.dataset.pid) : ui.selected.delete(e.target.dataset.pid);
                updateBulkUi(ovPageRows());
            } else if (e.target.classList.contains('ov-cost-input')) {
                const p = shop.products.find(x => x.id === e.target.dataset.pid);
                const v = e.target.value.trim();
                p.cost = v === '' ? null : Math.max(0, Number(v));
                save(); renderOverview(); renderReprice();
            } else if (e.target.classList.contains('ov-vcost-input')) {
                const { v } = findVar(e.target.dataset.pid, e.target.dataset.vid);
                const val = e.target.value.trim();
                v.cost = val === '' ? null : Math.max(0, Number(val));
                save(); renderOverview(); renderReprice();
            }
        });
        document.querySelectorAll('.ov-select-all').forEach(el => el.addEventListener('change', e => {
            ovPageRows().forEach(r => e.target.checked ? ui.selected.add(r.p.id) : ui.selected.delete(r.p.id));
            renderOverview();
        }));
        // 設定摘要：在「賣場設定」分頁與表單重複，隱藏
        document.querySelector('.shop-tabs').addEventListener('shown.bs.tab', e => {
            $('settingsLine').classList.toggle('d-none', e.target.dataset.tab === 'settings');
        });

        // 商品編輯
        $('pmSave').addEventListener('click', saveProductModal);
        $('pmPickCat').addEventListener('click', () => {
            modal('productModal').hide();
            const q = editing.fee.mode !== 'manual' ? catLeafName(SD.resolveFeePath({ fee: editing.fee }, ctx) || []) : '';
            openCatPicker('選擇後依賣場類型自動帶入一般或商城費率，費率表更新時會跟著更新。', q, path => {
                editing.fee = { ...editing.fee, mode: 'category', path, needsReview: false };
                $('pmManualRate').value = '';
            });
            $('catModal').addEventListener('hidden.bs.modal', () => { renderPmFee(); modal('productModal').show(); }, { once: true });
        });
        $('pmProdInv').addEventListener('change', e => { editing.prodInv = e.target.checked; renderPmProdInv(); });
        $('pmProdInvHint').addEventListener('click', e => {
            if (e.target.id !== 'pmProdInvReset') return;
            e.preventDefault();
            editing.prodInv = null;
            renderPmProdInv();
        });
        $('pmManualRate').addEventListener('input', e => {
            const n = parseFloat(e.target.value);
            if (Number.isFinite(n)) editing.fee = { ...editing.fee, mode: 'manual', manualRate: n, needsReview: false };
            renderPmFee();
        });

        // 類別選擇
        $('catSearch').addEventListener('input', renderCatList);
        $('catList').addEventListener('click', e => {
            const b = e.target.closest('[data-cat-index]');
            if (!b) return;
            const leaf = ctx.feeIndex.list[Number(b.dataset.catIndex)];
            const cb = catCb;
            catCb = null;
            if (cb) cb(leaf.path);
            modal('catModal').hide();
        });

        // 已存設定、加入
        $('savedApply').addEventListener('click', applySaved);
        $('adTarget').addEventListener('change', renderAddDiff);
        $('adOk').addEventListener('click', applyAdd);
        $('moveOk').addEventListener('click', applyMove);

        // 蝦皮匯入
        $('imFiles').addEventListener('change', e => onImportFiles(e.target.files));
        $('imPlan').addEventListener('change', e => {
            if (e.target.id === 'imTarget') { im.targetId = e.target.value; renderImportPlan(); }
            if (e.target.name === 'imKeep') im.keepDrafts = e.target.value === '1';
        });
        $('imApply').addEventListener('click', applyImport);

        // 調價
        $('rpList').addEventListener('input', e => {
            if (e.target.classList.contains('rp-price')) refreshRpRow(e.target.closest('.rp-row'));
        });
        $('rpList').addEventListener('change', e => {
            if (e.target.classList.contains('rp-chk')) {
                e.target.checked ? ui.rpSelected.add(e.target.dataset.vid) : ui.rpSelected.delete(e.target.dataset.vid);
                $('rpSelCount').textContent = ui.rpSelected.size;
            } else if (e.target.classList.contains('rp-price') || e.target.classList.contains('rp-stock')) commitRp(e.target);
        });
        ['rpSearch', 'rpFilter'].forEach(id => $(id).addEventListener(id === 'rpSearch' ? 'input' : 'change', renderReprice));
        $('rpSelectAll').addEventListener('change', e => {
            repriceItems(currentShop()).forEach(g => g.vs.forEach(v => e.target.checked ? ui.rpSelected.add(v.id) : ui.rpSelected.delete(v.id)));
            renderReprice();
        });
        $('exportOk').addEventListener('click', doExport);

        // 設定
        $('settingsForm').addEventListener('change', onSettingsChange);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
