// shop.js — 我的賣場介面（資料與計算在 shop-data.js、xlsx 在 shop-xlsx.js）
(function () {
    'use strict';
    const SD = window.ShopData;
    const SX = window.ShopXlsx;

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
    const ui = {
        tab: null, // own／shopee／settings
        own: { sort: { key: null, dir: 1 }, page: 1, size: 10, selected: new Set() }, // selected：商品 id
        sp: { page: 1, size: 10, selected: new Set(), panel: null },                  // selected：規格 id；panel：展開中的批次調整
    };
    const PAGE_SIZES = [10, 20, 50, 100];
    const TAB_KEY = 'shopee_myshop_tab'; // 記住上次停留的分頁

    // ---------- 小工具 ----------
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const money = n => (n == null || !Number.isFinite(n)) ? '—' : (n < 0 ? '-$ ' : '$ ') + Math.abs(Math.round(n)).toLocaleString('zh-TW');
    const pct = n => (n == null || !Number.isFinite(n)) ? '—' : n.toFixed(1) + '%';
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
        // 快速計算以前存的（新制）設定搬進自建商品；快速計算頁也會做，誰先開誰搬
        let mig = { moved: 0 };
        try { mig = SD.migrateQuickConfigsInStorage(storage); } catch (e) { /* 搬不了不影響賣場頁 */ }
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
        if (mig.moved) { showTab('own'); toast(`快速計算的 ${mig.moved} 筆已存設定已搬到「${mig.shopName}」的自建商品，獲利改依賣場設定計算`); }

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
            return;
        }
        state.activeShopId = shop.id;
        $('onboarding').classList.add('d-none');
        $('shopApp').classList.remove('d-none');
        $('shopSelect').innerHTML = state.shops.map(s => `<option value="${esc(s.id)}"${s.id === shop.id ? ' selected' : ''}>${esc(s.name)}（${s.products.length}）</option>`).join('');
        renderSettingsLine(shop);
        renderSettings();
        renderOwn();
        renderShopee();
        if (!ui.tab) {
            let saved = null;
            try { saved = storage.getItem(TAB_KEY); } catch (e) { /* 無法讀取就用預設 */ }
            showTab(['own', 'shopee', 'settings'].includes(saved) ? saved : (shop.products.some(p => p.shopeeItemId) ? 'shopee' : 'own'));
        }
    }

    function showTab(name) {
        const btn = document.querySelector(`.shop-tabs [data-tab="${name}"]`);
        if (btn) bootstrap.Tab.getOrCreateInstance(btn).show();
    }

    function renderSettingsLine(shop) {
        const st = shop.settings;
        const isShop = st.seller === 'shop';
        const parts = [LABELS.seller[st.seller]];
        if (!isShop) parts.push(LABELS.shipPlan[st.shipPlan], st.cashback === '0' ? LABELS.cashback['0'] : `${LABELS.cashback[st.cashback]}（${LABELS.cashbackTerm[st.cashbackTerm]}）`);
        parts.push(LABELS.tax[st.tax]);
        $('settingsLine').innerHTML = `<i class="bi bi-sliders"></i><span class="settings-text">${esc(parts.join(' · '))}</span><a href="#" data-action="goto-settings">修改</a>`;
    }

    function createShop(name, settings) {
        const s = SD.newShop(name, settings);
        state.shops.push(s);
        state.activeShopId = s.id;
        save();
        return s;
    }

    // ---------- 共用：摘要卡片、淨利格、分頁、表頭排序 ----------
    function cardsHtml(scope, items, curFilter) {
        return items.map(({ label, value, cls, filter }) => {
            const body = `<div class="label">${label}${filter ? ' <i class="bi bi-funnel" aria-hidden="true"></i>' : ''}</div><div class="value ${cls || ''}">${value}</div>`;
            return `<div class="col-6 col-md">` + (filter
                ? `<button type="button" class="summary-card summary-card-btn${curFilter === filter ? ' active' : ''}" data-action="card-filter" data-scope="${scope}" data-filter="${filter}" aria-pressed="${curFilter === filter}" title="${curFilter === filter ? '取消篩選' : '只列出這些'}">${body}</button>`
                : `<div class="summary-card">${body}</div>`) + `</div>`;
        }).join('');
    }

    const bdTrigger = val => `<button type="button" class="ov-bd-trigger" aria-haspopup="dialog" aria-expanded="false" title="費用拆解">${val}</button>`;

    // 單一規格某情境的淨利格（金額＋利潤率）；有費率時可浮出費用拆解
    function profitCell(m, r, low) {
        if (!m.hasRate) return '<span class="sx-missing">請選類別</span>';
        if (!m.hasCost) return '<span class="sx-missing">待補進價</span>';
        const loss = r.profit < 0;
        const lowM = !loss && r.margin != null && r.margin < low;
        return bdTrigger(`<span class="ov-money${loss ? ' ov-loss' : ''}">${money(r.profit)}</span><span class="pct"><span class="${loss ? 'ov-loss' : lowM ? 'ov-low' : ''}">${pct(r.margin)}</span></span>`);
    }

    // 規格層級的篩選條件（自建商品＝唯一規格）
    function matchVarFilter(filter, p, v, m, low) {
        const ok = m.hasCost && m.hasRate;
        if (filter === 'loss') return ok && (m.regular.profit < 0 || m.event.profit < 0);
        if (filter === 'low') return ok && m.regular.margin != null && m.regular.margin < low;
        if (filter === 'incomplete') return !ok;
        if (filter === 'changed') return !!(v.draft && v.draft.status === 'pending');
        if (filter === 'exported') return !!(v.draft && v.draft.status === 'exported');
        if (filter === 'missing') return !!p.missingInLastImport;
        return true;
    }

    function pagerHtml(scope, st, total, pages) {
        if (!total) return '';
        const cur = st.page;
        // 頁碼：首尾＋目前頁前後各一頁，中間用…
        const nums = [...new Set([1, cur - 1, cur, cur + 1, pages])].filter(x => x >= 1 && x <= pages).sort((a, b) => a - b);
        const items = [];
        const btn = (page, label, { disabled = false, active = false, aria = '' } = {}) =>
            `<li class="page-item${disabled ? ' disabled' : ''}${active ? ' active' : ''}"><button type="button" class="page-link" data-action="page" data-scope="${scope}" data-page="${page}"${disabled ? ' disabled' : ''}${active ? ' aria-current="page"' : ''}${aria ? ` aria-label="${aria}"` : ''}>${label}</button></li>`;
        items.push(btn(cur - 1, '<i class="bi bi-chevron-left"></i>', { disabled: cur <= 1, aria: '上一頁' }));
        nums.forEach((x, k) => {
            if (k && x - nums[k - 1] > 1) items.push('<li class="page-item disabled"><span class="page-link">…</span></li>');
            items.push(btn(x, x, { active: x === cur }));
        });
        items.push(btn(cur + 1, '<i class="bi bi-chevron-right"></i>', { disabled: cur >= pages, aria: '下一頁' }));
        return `<div class="ov-pager-size"><label for="${scope}PageSize">每頁</label>` +
            `<select class="form-select form-select-sm page-size" id="${scope}PageSize" data-scope="${scope}">${PAGE_SIZES.map(x => `<option value="${x}"${x === st.size ? ' selected' : ''}>${x}</option>`).join('')}</select>` +
            `<span>筆，共 ${total} ${scope === 'sp' ? '個商品' : '筆'}</span></div>` +
            (pages > 1 ? `<nav aria-label="分頁"><ul class="pagination pagination-sm mb-0">${items.join('')}</ul></nav>` : '');
    }

    function paginate(st, rows) {
        const pages = Math.max(1, Math.ceil(rows.length / st.size));
        st.page = Math.min(Math.max(1, st.page), pages);
        const start = (st.page - 1) * st.size;
        return { pages, pageRows: rows.slice(start, start + st.size) };
    }

    function sortTh(key, label, cls) {
        const s = ui.own.sort, on = s.key === key;
        const icon = !on ? 'bi-chevron-expand' : s.dir > 0 ? 'bi-caret-up-fill' : 'bi-caret-down-fill';
        const title = !on ? '點擊由低到高排序' : s.dir > 0 ? '目前由低到高，點擊改由高到低' : '目前由高到低，點擊恢復加入順序';
        return `<button type="button" class="ov-sort${on ? ' active' : ''}${cls ? ' ' + cls : ''}" data-action="own-sort" data-key="${key}" aria-sort="${!on ? 'none' : s.dir > 0 ? 'ascending' : 'descending'}" title="${title}">${label}<i class="bi ${icon}" aria-hidden="true"></i></button>`;
    }

    const chip = (cls, icon, text, title) => `<span class="ov-chip${cls ? ' ' + cls : ''}"${title ? ` title="${esc(title)}"` : ''}>${icon ? `<i class="bi bi-${icon}" aria-hidden="true"></i>` : ''}${text}</span>`;

    function productChips(shop, p) {
        const isShop = shop.settings.seller === 'shop';
        const fee = feeDescription(p, shop);
        const out = [];
        if (fee.rate == null) out.push(chip('ov-chip-warn', 'exclamation-triangle-fill', '請選類別'));
        if (p.fee.needsReview) out.push(chip('ov-chip-warn', 'exclamation-triangle-fill', '請重選類別'));
        if (p.missingInLastImport) out.push(chip('ov-chip-muted', 'cloud-slash', '本次未匯入'));
        if (fee.rate != null) out.push(chip('', 'tag', esc(fee.text), fee.path ? fee.path.join(' > ') : ''));
        if (p.preorder !== '0' && !isShop) out.push(chip('', 'clock-history', `預購 ${p.preorder}%`));
        if (p.frozen && !isShop) out.push(chip('', 'snow', '冷凍'));
        return out.join('') + (p.note ? `<span class="ov-note">${esc(p.note)}</span>` : '');
    }

    // 商品的 ⋯ 選單；表格在橫向捲動容器裡，選單改用 fixed 定位才不會被裁掉
    function productMenu(shop, p) {
        const others = state.shops.length > 1;
        const own = !p.shopeeItemId;
        const single = p.variations.length === 1;
        return `<div class="dropdown sx-menu">
  <button class="btn btn-sm btn-link text-secondary" data-bs-toggle="dropdown" data-bs-popper-config='{"strategy":"fixed"}' aria-expanded="false" aria-label="更多操作：${esc(p.name)}"><i class="bi bi-three-dots-vertical"></i></button>
  <ul class="dropdown-menu dropdown-menu-end">
    <li><button class="dropdown-item" data-action="product-edit" data-pid="${p.id}"><i class="bi bi-pencil"></i> 編輯${own ? '' : '（類別、預購、發票…）'}</button></li>
    ${single ? `<li><a class="dropdown-item" href="index.html?${SD.quickCalcQuery(shop, p, p.variations[0], ctx)}" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-right"></i> 在快速計算開啟</a></li>` : ''}
    ${own ? `<li><button class="dropdown-item" data-action="product-copy" data-pid="${p.id}"><i class="bi bi-copy"></i> 複製</button></li>` : ''}
    ${others ? `<li><button class="dropdown-item" data-action="product-move" data-pid="${p.id}"><i class="bi bi-box-arrow-right"></i> 搬到其他賣場</button></li>
    <li><button class="dropdown-item" data-action="product-copyto" data-pid="${p.id}"><i class="bi bi-files"></i> 複製到其他賣場</button></li>` : ''}
    <li><hr class="dropdown-divider"></li>
    <li><button class="dropdown-item text-danger" data-action="product-delete" data-pid="${p.id}"><i class="bi bi-trash"></i> 刪除${own ? '' : '整個商品'}</button></li>
  </ul></div>`;
    }

    const ownProducts = shop => shop.products.filter(p => !p.shopeeItemId);
    const shopeeProducts = shop => shop.products.filter(p => p.shopeeItemId);

    // ---------- 自建商品 ----------
    function ownRows(shop) {
        const q = $('ownSearch').value.trim().toLowerCase();
        const filter = $('ownFilter').value;
        const low = Number(shop.settings.lowMargin) || 0;
        let rows = ownProducts(shop).map((p, i) => ({ p, i, m: SD.variationMetrics(shop, p, p.variations[0], ctx) }));
        if (q) rows = rows.filter(r => (r.p.name + ' ' + (r.p.note || '')).toLowerCase().includes(q));
        rows = rows.filter(r => matchVarFilter(filter, r.p, r.p.variations[0], r.m, low));
        const { key: sortKey, dir } = ui.own.sort;
        const ok = r => r.m.hasCost && r.m.hasRate;
        const key = {
            name: r => r.p.name || null,
            cost: r => r.p.cost ?? null,
            price: r => r.m.price,
            profit: r => ok(r) ? r.m.regular.profit : null,
            eventProfit: r => ok(r) ? r.m.event.profit : null,
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

    function renderOwn() {
        const shop = currentShop();
        if (!shop) return;
        const low = Number(shop.settings.lowMargin) || 0;
        const isShop = shop.settings.seller === 'shop';
        const all = ownProducts(shop);
        const ids = new Set(all.map(p => p.id));
        [...ui.own.selected].forEach(id => { if (!ids.has(id)) ui.own.selected.delete(id); });

        const sum = SD.variationSummary(shop, all, ctx);
        const filter = $('ownFilter').value;
        $('ownCards').innerHTML = cardsHtml('own', [
            { label: '商品數', value: sum.products },
            { label: '虧本商品', value: sum.loss, cls: sum.loss ? 'text-danger' : '', filter: 'loss' },
            { label: '平均利潤率（一般日）', value: pct(sum.avgRegular) },
            ...(isShop ? [] : [{ label: '平均利潤率（促銷檔期）', value: pct(sum.avgEvent) }]),
            { label: '待補進價／類別', value: sum.incomplete, cls: sum.incomplete ? 'text-warning' : '', filter: 'incomplete' },
        ], filter);

        const rows = ownRows(shop);
        const { pages, pageRows } = paginate(ui.own, rows);
        $('ownPager').innerHTML = pagerHtml('own', ui.own, rows.length, pages);
        $('ownCount').textContent = !all.length ? '' : rows.length === all.length ? `${all.length} 個商品` : `列出 ${rows.length}／${all.length} 個商品`;
        const n = ui.own.selected.size;
        $('ownBulkDelete').classList.toggle('d-none', n === 0);
        $('ownBulkDelete').querySelector('span').textContent = n;

        if (!all.length) {
            $('ownBody').innerHTML = `<div class="sp-empty"><i class="bi bi-box-seam sp-empty-icon" aria-hidden="true"></i><h2 class="h6 fw-bold mb-1">還沒有自建商品</h2>` +
                `<p class="small text-muted mb-3">還沒上架、想先試算的商品，或不在蝦皮賣的商品放這裡；和快速計算左側的列表是同一份。蝦皮匯入的商品在「蝦皮商品」分頁。</p>` +
                `<div class="d-flex flex-wrap justify-content-center gap-2"><button class="btn btn-primary" data-action="product-new"><i class="bi bi-plus-lg"></i> 新增商品</button>` +
                `<a class="btn btn-outline-secondary" href="index.html"><i class="bi bi-calculator"></i> 到快速計算試算後儲存</a></div></div>`;
            return;
        }
        if (!rows.length) { $('ownBody').innerHTML = '<div class="text-center text-muted py-4">沒有符合條件的商品</div>'; return; }

        const allChecked = pageRows.every(r => ui.own.selected.has(r.p.id));
        const head = `<tr>
<th class="sx-sticky sx-c-name"><div class="sx-namecell"><input class="form-check-input own-all" type="checkbox" ${allChecked ? 'checked' : ''} aria-label="全選本頁商品" title="全選本頁商品">${sortTh('name', '商品')}</div></th>
<th class="sx-c-in">${sortTh('cost', '進價')}</th>
<th class="sx-c-in">${sortTh('price', '售價')}</th>
<th class="sx-c-num">${sortTh('profit', '一般日淨利', 'justify-content-end')}</th>
${isShop ? '' : `<th class="sx-c-num">${sortTh('eventProfit', '促銷檔期淨利', 'justify-content-end')}</th>`}
<th class="sx-c-act"><span class="visually-hidden">操作</span></th></tr>`;
        const body = pageRows.map(({ p, m }) => {
            const v = p.variations[0];
            return `<tr class="ov-bd-scope" data-pid="${p.id}">
<td class="sx-sticky sx-c-name"><div class="sx-namecell"><input type="checkbox" class="form-check-input own-chk" data-pid="${p.id}" ${ui.own.selected.has(p.id) ? 'checked' : ''} aria-label="選取 ${esc(p.name)}">
<div class="sx-name-main"><div class="ov-name" title="${esc(p.name)}">${esc(p.name || '（未命名）')}</div><div class="ov-sub">${productChips(shop, p)}</div></div></div>${m.hasRate ? `<template class="ov-bd-tpl">${breakdownHtml(shop, p, v, m)}</template>` : ''}</td>
<td class="sx-c-in"><input type="number" class="form-control form-control-sm sx-input own-cost${m.hasCost ? '' : ' sx-input-missing'}" data-pid="${p.id}" value="${p.cost ?? ''}" placeholder="待補" min="0" step="any" aria-label="進價"></td>
<td class="sx-c-in"><input type="number" class="form-control form-control-sm sx-input own-price" data-pid="${p.id}" value="${v.price || ''}" min="0" step="1" aria-label="售價"></td>
<td class="sx-c-num c-reg">${profitCell(m, m.regular, low)}</td>
${isShop ? '' : `<td class="sx-c-num c-evt">${profitCell(m, m.event, low)}</td>`}
<td class="sx-c-act">${productMenu(shop, p)}</td></tr>`;
        }).join('');
        $('ownBody').innerHTML = `<div class="sx-scroll"><table class="sx-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
    }

    // ---------- 蝦皮商品 ----------
    function spGroups(shop) {
        const q = $('spSearch').value.trim().toLowerCase();
        const filter = $('spFilter').value;
        const low = Number(shop.settings.lowMargin) || 0;
        const groups = [];
        for (const p of shopeeProducts(shop)) {
            const matchP = !q || p.name.toLowerCase().includes(q);
            const vs = [];
            for (const v of p.variations) {
                if (q && !matchP && !(v.name || '').toLowerCase().includes(q)) continue;
                const m = SD.variationMetrics(shop, p, v, ctx);
                if (matchVarFilter(filter, p, v, m, low)) vs.push({ v, m });
            }
            if (vs.length) groups.push({ p, vs });
        }
        return groups;
    }

    function spVarRow(shop, p, v, m, low, isShop) {
        const d = v.draft;
        const pill = d ? (d.status === 'exported'
            ? '<span class="ov-chip ov-chip-muted sx-pill" title="已匯出，等蝦皮更新後重新匯入就會清除"><i class="bi bi-cloud-arrow-up" aria-hidden="true"></i>已匯出</span>'
            : '<span class="ov-chip ov-chip-info sx-pill"><i class="bi bi-pencil-fill" aria-hidden="true"></i>待匯出</span>') : '';
        return `<tr class="sx-var ov-bd-scope" data-pid="${p.id}" data-vid="${v.id}">
<td class="sx-sticky sx-c-name"><div class="sx-namecell"><input type="checkbox" class="form-check-input sp-chk" data-vid="${v.id}" ${ui.sp.selected.has(v.id) ? 'checked' : ''} aria-label="選取規格 ${esc(v.name || '單一規格')}">
<div class="sx-name-main"><span class="sx-var-name">${esc(v.name || '（單一規格）')}</span>${pill}</div></div>${m.hasRate ? `<template class="ov-bd-tpl">${breakdownHtml(shop, p, v, m)}</template>` : ''}</td>
<td class="sx-c-in"><input type="number" class="form-control form-control-sm sx-input sp-cost${m.hasCost ? '' : ' sx-input-missing'}" data-pid="${p.id}" data-vid="${v.id}" value="${v.cost ?? ''}" placeholder="待補" min="0" step="any" aria-label="進價"></td>
<td class="sx-c-in"><input type="number" class="form-control form-control-sm sx-input sp-price${d && d.price != null ? ' changed' : ''}" data-pid="${p.id}" data-vid="${v.id}" value="${SD.effectivePrice(v)}" min="1" max="499999" step="1" aria-label="售價">${d && d.price != null ? `<div class="orig">原 ${money(v.price)}</div>` : ''}</td>
<td class="sx-c-in sx-c-stock"><input type="number" class="form-control form-control-sm sx-input sp-stock${d && d.stock != null ? ' changed' : ''}" data-pid="${p.id}" data-vid="${v.id}" value="${d && d.stock != null ? d.stock : (v.stock ?? '')}" min="0" step="1" aria-label="庫存">${d && d.stock != null ? `<div class="orig">原 ${v.stock ?? '—'}</div>` : ''}</td>
<td class="sx-c-num c-reg">${profitCell(m, m.regular, low)}</td>
${isShop ? '' : `<td class="sx-c-num c-evt">${profitCell(m, m.event, low)}</td>`}
</tr>`;
    }

    function renderShopee() {
        const shop = currentShop();
        if (!shop) return;
        const all = shopeeProducts(shop);
        const has = all.length > 0;
        $('spEmpty').classList.toggle('d-none', has);
        $('spBody').classList.toggle('d-none', !has);
        $('rpFooter').classList.toggle('d-none', !has);
        const vids = new Set(all.flatMap(p => p.variations.map(v => v.id)));
        [...ui.sp.selected].forEach(id => { if (!vids.has(id)) ui.sp.selected.delete(id); });
        updatePendingBadge();
        if (!has) { ui.sp.panel = null; renderSpPanel(); updateSpSelection(); return; }

        const low = Number(shop.settings.lowMargin) || 0;
        const isShop = shop.settings.seller === 'shop';
        const sum = SD.variationSummary(shop, all, ctx);
        const filter = $('spFilter').value;
        $('spCards').innerHTML = cardsHtml('sp', [
            { label: '商品／規格', value: `${sum.products}<span class="value-sub">／${sum.variations}</span>` },
            { label: '虧本規格', value: sum.loss, cls: sum.loss ? 'text-danger' : '', filter: 'loss' },
            { label: '平均利潤率（一般日）', value: pct(sum.avgRegular) },
            ...(isShop ? [] : [{ label: '平均利潤率（促銷檔期）', value: pct(sum.avgEvent) }]),
            { label: '待補進價／類別', value: sum.incomplete, cls: sum.incomplete ? 'text-warning' : '', filter: 'incomplete' },
        ], filter);

        if (shop.salesFile) {
            const stale = SD.isStale(shop);
            const ft = shop.salesFile.fileTime;
            $('spFreshness').innerHTML = `<div class="sp-fresh${stale ? ' sp-fresh-stale' : ''}"><i class="bi bi-clock-history" aria-hidden="true"></i><span>售價與庫存來自 <strong>${fmtTime(SD.salesDataTime(shop))}</strong> ${ft ? '從蝦皮下載' : '匯入'}的檔案` +
                (stale ? '，已超過 24 小時，期間的訂單可能讓庫存變少；建議重新下載、匯入後再改。' : '。') + `</span></div>`;
        } else {
            $('spFreshness').innerHTML = `<div class="sp-fresh sp-fresh-stale"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i><span>還沒有「價格及庫存」原檔，產生批次更新檔前請先<a href="#" data-action="import-shopee">重新匯入</a>。</span></div>`;
        }

        const groups = spGroups(shop);
        const { pages, pageRows } = paginate(ui.sp, groups);
        $('spPager').innerHTML = pagerHtml('sp', ui.sp, groups.length, pages);
        const shownVars = groups.reduce((n, g) => n + g.vs.length, 0);
        $('spCount').textContent = filter === 'all' && !$('spSearch').value.trim() ? `${sum.products} 個商品、${sum.variations} 個規格` : `列出 ${groups.length} 個商品、${shownVars} 個規格`;

        if (!groups.length) {
            $('spList').innerHTML = '<div class="text-center text-muted py-4">沒有符合條件的規格</div>';
        } else {
            const pageVids = pageRows.flatMap(g => g.vs.map(x => x.v.id));
            const allChecked = pageVids.length > 0 && pageVids.every(id => ui.sp.selected.has(id));
            const cols = isShop ? 5 : 6;
            const head = `<tr>
<th class="sx-sticky sx-c-name"><div class="sx-namecell"><input class="form-check-input sp-all" type="checkbox" ${allChecked ? 'checked' : ''} aria-label="全選本頁規格" title="全選本頁規格"><span>商品／規格</span></div></th>
<th class="sx-c-in">進價</th><th class="sx-c-in">售價</th><th class="sx-c-in sx-c-stock">庫存</th>
<th class="sx-c-num">一般日淨利</th>${isShop ? '' : '<th class="sx-c-num">促銷檔期淨利</th>'}</tr>`;
            const body = pageRows.map(({ p, vs }) => {
                const gChecked = vs.every(x => ui.sp.selected.has(x.v.id));
                // 標題列跨滿整列；內層 sticky，手機橫滑時名稱與 ⋯ 留在畫面上
                return `<tr class="sx-group" data-pid="${p.id}">
<td colspan="${cols}" class="sx-group-cell"><div class="sx-namecell sx-group-inner"><input type="checkbox" class="form-check-input sp-gchk" data-pid="${p.id}" ${gChecked ? 'checked' : ''} aria-label="選取「${esc(p.name)}」列出的所有規格" title="選取這個商品列出的所有規格">
<div class="sx-name-main"><div class="ov-name" title="${esc(p.name)}">${esc(p.name)}</div><div class="ov-sub">${productChips(shop, p)}</div></div>${productMenu(shop, p)}</div></td></tr>` +
                    vs.map(({ v, m }) => spVarRow(shop, p, v, m, low, isShop)).join('');
            }).join('');
            $('spList').innerHTML = `<div class="sx-scroll"><table class="sx-table sx-table-sp"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
        }
        updateSpSelection();
        updateRpFooter();
    }

    // 勾選數量變動：批次選單的可用項目、取消勾選、展開中面板的數字
    function updateSpSelection() {
        const n = ui.sp.selected.size;
        $('spSelCount').textContent = n;
        $('spSelCount').classList.toggle('d-none', n === 0);
        $('spBatchHeader').textContent = n ? `已勾選 ${n} 個規格` : '先在表格勾選規格';
        document.querySelectorAll('#spBatchMenu [data-need-sel]').forEach(b => { b.disabled = n === 0; });
        $('spClearSel').classList.toggle('d-none', n === 0);
        const c = $('spPanelCount');
        if (c) c.textContent = n;
        if (ui.sp.panel && n === 0) { ui.sp.panel = null; renderSpPanel(); }
    }

    const PANELS = {
        adjust: {
            title: '漲跌％／加減金額', icon: 'percent',
            body: `<div class="input-group input-group-sm sp-panel-group">
  <select class="form-select" id="spAdjType" aria-label="調整方式"><option value="pct">漲跌 %</option><option value="amt">加減 $</option></select>
  <input type="number" class="form-control" id="spAdjValue" placeholder="例 5 或 -10" step="any" aria-label="調整數字">
  <select class="form-select" id="spRound" aria-label="取整"><option value="1">取到個位</option><option value="10">取到十位</option><option value="9">尾數 9</option></select>
</div>`, hint: '以蝦皮匯入的原價為基準，重複套用不會累加。', ok: '套用',
        },
        margin: {
            title: '依目標利潤率回推售價', icon: 'bullseye',
            body: `<div class="input-group input-group-sm sp-panel-group">
  <span class="input-group-text">目標利潤率</span>
  <input type="number" class="form-control" id="spMargin" value="10" step="any" aria-label="目標利潤率">
  <span class="input-group-text">%</span>
  <select class="form-select" id="spMarginScenario" aria-label="情境"><option value="regular">一般日</option><option value="event">促銷檔期</option></select>
</div>`, hint: '缺進價或類別的規格會略過。', ok: '回推售價',
        },
        stock: {
            title: '設定庫存', icon: 'box',
            body: `<div class="input-group input-group-sm sp-panel-group sp-panel-narrow"><span class="input-group-text">庫存</span><input type="number" class="form-control" id="spStock" min="0" step="1" aria-label="庫存"></div>`,
            hint: '', ok: '設定',
        },
        cost: {
            title: '設定進價', icon: 'cash-coin',
            body: `<div class="input-group input-group-sm sp-panel-group sp-panel-narrow"><span class="input-group-text">進價 $</span><input type="number" class="form-control" id="spCost" min="0" step="any" aria-label="進價"></div>`,
            hint: '進價只用來算獲利，不會寫進蝦皮檔案，設定後直接生效。', ok: '設定',
        },
    };

    function renderSpPanel() {
        const el = $('spPanel');
        const def = ui.sp.panel && PANELS[ui.sp.panel];
        el.classList.toggle('d-none', !def);
        if (!def) { el.innerHTML = ''; return; }
        el.innerHTML = `<div class="sp-panel-head"><i class="bi bi-${def.icon}" aria-hidden="true"></i><strong>${def.title}</strong><span class="text-muted">· 套用到勾選的 <span id="spPanelCount">${ui.sp.selected.size}</span> 個規格</span>
<button type="button" class="btn-close btn-close-sm ms-auto" data-action="sp-panel-close" aria-label="收起"></button></div>
<form class="sp-panel-body" id="spPanelForm" onsubmit="return false">${def.body}<button type="submit" class="btn btn-primary btn-sm">${def.ok}</button><button type="button" class="btn btn-outline-secondary btn-sm" data-action="sp-panel-close">取消</button></form>
${def.hint ? `<div class="small text-muted mt-1">${def.hint}</div>` : ''}`;
        el.querySelector('input')?.focus();
    }

    function applySpPanel() {
        const done = { adjust: spAdjust, margin: spMargin, stock: spStock, cost: spCost }[ui.sp.panel]?.();
        if (done) { ui.sp.panel = null; renderSpPanel(); }
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
        document.querySelectorAll('#productModal .pm-own-only').forEach(el => el.classList.toggle('d-none', editing.shopee));
        $('pmShopeeHint').classList.toggle('d-none', !editing.shopee);
        $('pmCostIncHint').classList.toggle('d-none', !editing.shopee);
        document.querySelector(`input[name="pmPre"][value="${p.preorder || '0'}"]`).checked = true;
        renderPmProdInv();
        $('pmFrozen').checked = !!p.frozen;
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

    // 成交手續費：輸入框顯示目前費率（與快速計算相同）；選了類別時下方註明類別，直接改數字就變成手動費率
    function renderPmFee() {
        const shop = currentShop();
        const fake = { fee: editing.fee };
        const rate = SD.resolveRate(fake, shop.settings.seller, ctx);
        if (document.activeElement !== $('pmRate')) $('pmRate').value = rate != null ? rate : '';
        let text = '', warn = false;
        if (editing.fee.mode === 'manual') {
            if (editing.fee.needsReview) { text = '舊設定只有費率數字，建議按「查詢」重選類別'; warn = true; }
        } else {
            const path = SD.resolveFeePath(fake, ctx);
            if (path) text = `${editing.fee.mode === 'auto' ? '依蝦皮分類：' : '類別：'}${path.join(' > ')}`;
            else { text = '對不到費率表的類別，請按「查詢」選擇或直接輸入費率'; warn = true; }
        }
        $('pmFeeText').textContent = text;
        $('pmFeeText').title = text;
        $('pmFeeText').classList.toggle('text-warning-emphasis', warn);
        $('pmFeeText').classList.toggle('text-muted', !warn);
    }

    function saveProductModal() {
        const shop = currentShop();
        const num = v => (v === '' || v == null ? null : Number(v));
        const fields = {
            name: $('pmName').value.trim(),
            note: $('pmNote').value.trim(),
            costTax: $('pmCostInc').checked ? 'inc' : 'exc',
            preorder: document.querySelector('input[name="pmPre"]:checked').value,
            hasProdInv: editing.prodInv,
            frozen: $('pmFrozen').checked,
            fee: { ...editing.fee, needsReview: editing.fee.needsReview && editing.fee.mode === 'manual' },
        };
        if (!fields.name) { $('pmName').focus(); toast('請輸入商品名稱'); return; }
        // 蝦皮商品的進價在規格上，編輯視窗不碰
        if (!editing.shopee) {
            fields.cost = num($('pmCost').value);
            if (fields.cost != null && (!Number.isFinite(fields.cost) || fields.cost < 0)) { toast('進價格式不對'); return; }
        }
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
        render();
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
<div class="form-check"><input class="form-check-input" type="radio" name="imKeep" id="imKeep1" value="1" ${im.keepDrafts ? 'checked' : ''}><label class="form-check-label" for="imKeep1">保留修改（仍會出現在「蝦皮商品」）</label></div>
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
        showTab('shopee');
    }

    // ---------- 蝦皮商品：修改與批次調整 ----------
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

    // 打字中即時重算該列淨利（售價欄）
    function refreshPriceRow(input) {
        const shop = currentShop();
        const row = input.closest('tr');
        const p = shop.products.find(x => x.id === input.dataset.pid);
        if (!p || !row) return;
        const v = input.dataset.vid ? p.variations.find(x => x.id === input.dataset.vid) : p.variations[0];
        const typed = parseInt(input.value, 10);
        const m = SD.variationMetrics(shop, p, v, ctx, Number.isFinite(typed) ? typed : SD.effectivePrice(v));
        const low = Number(shop.settings.lowMargin) || 0;
        row.querySelector('.c-reg').innerHTML = profitCell(m, m.regular, low);
        const evt = row.querySelector('.c-evt');
        if (evt) evt.innerHTML = profitCell(m, m.event, low);
    }

    function commitSpDraft(input) {
        const field = input.classList.contains('sp-price') ? 'price' : 'stock';
        const { v } = findVar(input.dataset.pid, input.dataset.vid);
        if (!v) return;
        const raw = input.value.trim();
        const val = raw === '' ? (field === 'price' ? v.price : v.stock) : Math.round(Number(raw));
        if (!Number.isFinite(val)) return;
        SD.setDraft(v, field, val);
        save();
        renderShopee();
    }

    const numOrNull = raw => { const s = String(raw).trim(); if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? Math.max(0, n) : undefined; };

    function selectedVariations() {
        const out = [];
        for (const p of shopeeProducts(currentShop())) for (const v of p.variations) if (ui.sp.selected.has(v.id)) out.push({ p, v });
        return out;
    }

    function roundPrice(x, mode) {
        let n;
        if (mode === '10') n = Math.round(x / 10) * 10;
        else if (mode === '9') n = Math.round(x / 10) * 10 - 1;
        else n = Math.round(x);
        return Math.max(1, n);
    }

    // 以下批次動作：成功回傳 true（收起面板）
    function spAdjust() {
        const sel = selectedVariations();
        const val = parseFloat($('spAdjValue').value);
        if (!Number.isFinite(val)) { toast('請輸入調整數字'); $('spAdjValue').focus(); return false; }
        const type = $('spAdjType').value, mode = $('spRound').value;
        let skipped = 0;
        sel.forEach(({ v }) => {
            const base = v.price; // 以蝦皮目前售價為基準，重複套用不會累加
            if (!(base >= 1)) { skipped++; return; }
            SD.setDraft(v, 'price', roundPrice(type === 'pct' ? base * (1 + val / 100) : base + val, mode));
        });
        save();
        renderShopee();
        toast(`已調整 ${sel.length - skipped} 個規格（以蝦皮原價為基準）` + (skipped ? `，${skipped} 個沒有原價而略過` : ''));
        return true;
    }

    function spMargin() {
        const shop = currentShop();
        const sel = selectedVariations();
        const margin = parseFloat($('spMargin').value);
        if (!Number.isFinite(margin)) { toast('請輸入目標利潤率'); $('spMargin').focus(); return false; }
        const isEvent = $('spMarginScenario').value === 'event';
        let ok = 0, skip = 0;
        sel.forEach(({ p, v }) => {
            const price = SD.requiredPrice(shop, p, v, ctx, margin, isEvent);
            if (price) { SD.setDraft(v, 'price', price); ok++; } else skip++;
        });
        save();
        renderShopee();
        toast(`已回推 ${ok} 個規格的售價` + (skip ? `，${skip} 個缺進價或類別而略過` : ''));
        return true;
    }

    function spStock() {
        const sel = selectedVariations();
        const n = Number($('spStock').value);
        if ($('spStock').value.trim() === '' || !Number.isInteger(n) || n < 0) { toast('庫存要是 0 以上的整數'); $('spStock').focus(); return false; }
        sel.forEach(({ v }) => SD.setDraft(v, 'stock', n));
        save();
        renderShopee();
        toast(`已設定 ${sel.length} 個規格的庫存`);
        return true;
    }

    function spCost() {
        const sel = selectedVariations();
        const n = numOrNull($('spCost').value);
        if (n === undefined || n === null) { toast('請輸入進價'); $('spCost').focus(); return false; }
        sel.forEach(({ v }) => { v.cost = n; });
        save();
        renderShopee();
        toast(`已設定 ${sel.length} 個規格的進價`);
        return true;
    }

    function spRestore(all) {
        const shop = currentShop();
        const targets = all
            ? shop.products.flatMap(p => p.variations.filter(v => v.draft))
            : selectedVariations().map(x => x.v).filter(v => v.draft);
        if (!targets.length) { toast('沒有可以恢復的修改'); return; }
        const doIt = () => { targets.forEach(v => { v.draft = null; }); save(); renderShopee(); toast(`已恢復 ${targets.length} 個規格`); };
        if (all) confirmBox('全部恢復', `<p class="mb-0">要取消 ${targets.length} 個規格的修改（含已匯出、待蝦皮更新的標記），回到蝦皮匯入的售價與庫存嗎？</p>`, '全部恢復', doIt);
        else doIt();
    }

    function spDeleteSelected() {
        const shop = currentShop();
        const sel = selectedVariations();
        if (!sel.length) return;
        const byP = new Map();
        sel.forEach(({ p, v }) => { if (!byP.has(p)) byP.set(p, []); byP.get(p).push(v); });
        const list = [...byP].slice(0, 8).map(([p, vs]) => `<li>${esc(p.name.slice(0, 40))}：${vs.length === p.variations.length ? '<strong>整個商品</strong>' : vs.map(v => esc(v.name || '（單一規格）')).join('、')}</li>`).join('');
        confirmBox('刪除勾選的規格', `<p>要刪除 ${sel.length} 個規格嗎？規格全部被刪的商品會整個刪掉。</p><ul class="small ps-3">${list}${byP.size > 8 ? '<li>…</li>' : ''}</ul>` +
            `<p class="small text-muted mb-0">只刪這裡的資料，不影響蝦皮。下次匯入時這些規格會再出現，填過的進價不會保留。</p>`, '刪除', () => {
            const r = SD.deleteVariations(shop, sel.map(x => x.v.id));
            ui.sp.selected.clear();
            save(); render();
            toast(`已刪除 ${r.variations} 個規格` + (r.products ? `（${r.products} 個商品整個刪除）` : ''));
        });
    }

    function spClear() {
        const shop = currentShop();
        const n = shopeeProducts(shop).length;
        confirmBox('一鍵清除蝦皮資料', `<p>會清除「${esc(shop.name)}」的 <strong>${n} 個蝦皮商品</strong>（含你填的進價與還沒匯出的調價）、保存的「價格及庫存」原檔，以及綁定的蝦皮賣場 ID，回到上傳檔案的畫面。</p>` +
            `<p class="small text-muted mb-0">自建商品與賣場設定不受影響。清除後無法復原，需要的話請先用右上「⋯」選單匯出備份。</p>`, '清除', () => {
            SD.clearShopee(shop);
            ui.sp.selected.clear();
            ui.sp.panel = null;
            save(); render(); renderSpPanel();
            toast('已清除蝦皮資料');
        });
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
            renderShopee();
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
        if (document.activeElement !== $('stName')) $('stName').value = shop.name;
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

    function onSettingsChange(e) {
        const shop = currentShop();
        if (e && e.target.id === 'stName') {
            const name = $('stName').value.trim();
            if (!name) { $('stName').value = shop.name; toast('賣場名稱不能空白'); return; }
            if (name === shop.name) return;
            shop.name = name;
            save();
            render();
            toast('已更新賣場名稱');
            return;
        }
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
        render();
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
        // 蝦皮商品保留連結（自建商品沒有規格，不能把多規格商品變成自建商品）；目標賣場已有同一個就不做
        if (p.shopeeItemId && target.products.some(x => x.shopeeItemId === p.shopeeItemId)) {
            toast(`「${target.name}」已經有這個蝦皮商品`);
            return;
        }
        const c = cloneProduct(p, true);
        target.products.unshift(c);
        if (!moveCtx.copy) shop.products = shop.products.filter(x => x.id !== p.id);
        save();
        modal('moveModal').hide();
        render();
        toast((moveCtx.copy ? '已複製到' : '已搬到') + `「${target.name}」`);
    }

    // ---------- 事件 ----------
    function bindEvents() {
        document.addEventListener('click', e => {
            const t = e.target.closest('[data-action]');
            if (!t) return;
            const a = t.dataset.action;
            const shop = currentShop();
            if (t.tagName === 'A') e.preventDefault();
            switch (a) {
                case 'shop-new': nameBox('新增賣場', '我的賣場 ' + (state.shops.length + 1), name => { createShop(name, shop ? shop.settings : null); render(); }); break;
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
                    save(); renderOwn(); toast('已複製');
                    break;
                }
                case 'product-move': openMove(t.dataset.pid, false); break;
                case 'product-copyto': openMove(t.dataset.pid, true); break;
                case 'product-delete': {
                    const p = shop.products.find(x => x.id === t.dataset.pid);
                    confirmBox('刪除商品', `<p class="mb-0">確定要刪除「${esc(p.name)}」嗎？${p.shopeeItemId ? '<br><small class="text-muted">只刪這裡的資料，下次匯入時會再出現，填過的進價不會保留。</small>' : ''}</p>`, '刪除', () => {
                        shop.products = shop.products.filter(x => x.id !== p.id);
                        save(); render(); toast('已刪除');
                    });
                    break;
                }
                case 'own-bulk-delete': {
                    const ids = [...ui.own.selected];
                    confirmBox('刪除商品', `<p class="mb-0">確定要刪除勾選的 ${ids.length} 個商品嗎？</p>`, '刪除', () => {
                        shop.products = shop.products.filter(x => !ui.own.selected.has(x.id));
                        ui.own.selected.clear();
                        save(); render(); toast(`已刪除 ${ids.length} 個商品`);
                    });
                    break;
                }
                case 'own-sort': {
                    // 同一欄：由低到高 → 由高到低 → 恢復加入順序
                    const k = t.dataset.key, cur = ui.own.sort;
                    ui.own.sort = cur.key !== k ? { key: k, dir: 1 } : cur.dir > 0 ? { key: k, dir: -1 } : { key: null, dir: 1 };
                    ui.own.page = 1;
                    renderOwn();
                    break;
                }
                case 'page': {
                    const sc = t.dataset.scope;
                    ui[sc].page = Number(t.dataset.page);
                    sc === 'own' ? renderOwn() : renderShopee();
                    $(sc === 'own' ? 'ownSelBar' : 'spCount').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                    break;
                }
                case 'goto-settings': showTab('settings'); break;
                case 'card-filter': {
                    const sc = t.dataset.scope;
                    const f = $(sc === 'own' ? 'ownFilter' : 'spFilter');
                    f.value = f.value === t.dataset.filter ? 'all' : t.dataset.filter;
                    ui[sc].page = 1;
                    sc === 'own' ? renderOwn() : renderShopee();
                    break;
                }
                case 'import-shopee': openImport(); break;
                case 'im-pick': {
                    const catId = t.dataset.cat;
                    const u = im.plan.unmatched.find(x => x.catId === catId);
                    const hint = `蝦皮分類：${u.path ? u.path.join(' > ') : u.label}`;
                    modal('importModal').hide();
                    openCatPicker(hint, u.path ? u.path[u.path.length - 1].slice(0, 4) : '', path => { im.catPicks[catId] = path; });
                    $('catModal').addEventListener('hidden.bs.modal', () => { modal('importModal').show(); renderImportPlan(); }, { once: true });
                    break;
                }
                case 'sp-panel': if (!t.disabled) { ui.sp.panel = t.dataset.panel; renderSpPanel(); } break;
                case 'sp-panel-close': ui.sp.panel = null; renderSpPanel(); $('spBatchBtn').focus(); break;
                case 'sp-restore-selected': spRestore(false); break;
                case 'sp-restore-all': spRestore(true); break;
                case 'sp-delete-selected': spDeleteSelected(); break;
                case 'sp-clear': spClear(); break;
                case 'sp-clear-selection': ui.sp.selected.clear(); renderShopee(); break;
                case 'export-open': openExport(); break;
            }
        });

        // 首次使用
        $('obCreate').addEventListener('click', () => {
            const name = $('obName').value.trim() || '我的賣場';
            createShop(name, null);
            render();
            toast('已建立賣場，接著加入商品');
        });

        $('shopSelect').addEventListener('change', e => {
            state.activeShopId = e.target.value;
            ui.own.page = 1; ui.sp.page = 1; ui.own.selected.clear(); ui.sp.selected.clear(); ui.sp.panel = null;
            save(); render(); renderSpPanel();
        });
        $('nameModalOk').addEventListener('click', () => { const v = $('nameModalInput').value.trim(); if (!v) return; modal('nameModal').hide(); nameCb && nameCb(v); });
        $('nameModalInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('nameModalOk').click(); });
        $('confirmModalOk').addEventListener('click', () => { modal('confirmModal').hide(); confirmCb && confirmCb(); });
        $('backupFile').addEventListener('change', e => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; });

        // 自建商品
        ['ownSearch', 'ownFilter'].forEach(id => $(id).addEventListener(id === 'ownSearch' ? 'input' : 'change', () => { ui.own.page = 1; renderOwn(); }));
        $('ownBody').addEventListener('input', e => { if (e.target.classList.contains('own-price')) refreshPriceRow(e.target); });
        $('ownBody').addEventListener('change', e => {
            const t = e.target;
            const p = t.dataset.pid && currentShop().products.find(x => x.id === t.dataset.pid);
            if (t.classList.contains('own-all')) {
                const sel = ui.own.selected;
                paginate(ui.own, ownRows(currentShop())).pageRows.forEach(r => t.checked ? sel.add(r.p.id) : sel.delete(r.p.id));
                renderOwn();
            } else if (t.classList.contains('own-chk')) {
                t.checked ? ui.own.selected.add(p.id) : ui.own.selected.delete(p.id);
                renderOwn();
            } else if (t.classList.contains('own-cost')) {
                const n = numOrNull(t.value);
                if (n === undefined) return;
                p.cost = n;
                save(); renderOwn();
            } else if (t.classList.contains('own-price')) {
                const n = numOrNull(t.value);
                if (n === undefined) return;
                p.variations[0].price = Math.round(n || 0);
                save(); renderOwn();
            }
        });

        // 蝦皮商品
        ['spSearch', 'spFilter'].forEach(id => $(id).addEventListener(id === 'spSearch' ? 'input' : 'change', () => { ui.sp.page = 1; renderShopee(); }));
        $('spList').addEventListener('input', e => { if (e.target.classList.contains('sp-price')) refreshPriceRow(e.target); });
        $('spList').addEventListener('change', e => {
            const t = e.target, sel = ui.sp.selected;
            if (t.classList.contains('sp-all')) {
                paginate(ui.sp, spGroups(currentShop())).pageRows.forEach(g => g.vs.forEach(x => t.checked ? sel.add(x.v.id) : sel.delete(x.v.id)));
                renderShopee();
            } else if (t.classList.contains('sp-gchk')) {
                const g = spGroups(currentShop()).find(x => x.p.id === t.dataset.pid);
                if (g) g.vs.forEach(x => t.checked ? sel.add(x.v.id) : sel.delete(x.v.id));
                renderShopee();
            } else if (t.classList.contains('sp-chk')) {
                t.checked ? sel.add(t.dataset.vid) : sel.delete(t.dataset.vid);
                renderShopee();
            } else if (t.classList.contains('sp-cost')) {
                const { v } = findVar(t.dataset.pid, t.dataset.vid);
                const n = numOrNull(t.value);
                if (!v || n === undefined) return;
                v.cost = n;
                save(); renderShopee();
            } else if (t.classList.contains('sp-price') || t.classList.contains('sp-stock')) commitSpDraft(t);
        });
        $('spPanel').addEventListener('submit', e => { e.preventDefault(); applySpPanel(); });
        // 每頁筆數（兩個分頁共用）
        ['ownPager', 'spPager'].forEach(id => $(id).addEventListener('change', e => {
            if (!e.target.classList.contains('page-size')) return;
            const st = ui[e.target.dataset.scope];
            st.size = Number(e.target.value) || 10;
            st.page = 1;
            e.target.dataset.scope === 'own' ? renderOwn() : renderShopee();
        }));
        document.querySelector('.shop-tabs').addEventListener('shown.bs.tab', e => {
            ui.tab = e.target.dataset.tab;
            try { storage.setItem(TAB_KEY, ui.tab); } catch (err) { /* 記不住就算了 */ }
            // 設定摘要：在「賣場設定」分頁與表單重複，隱藏
            $('settingsLine').classList.toggle('d-none', ui.tab === 'settings');
        });

        // 商品編輯
        $('pmSave').addEventListener('click', saveProductModal);
        $('pmPickCat').addEventListener('click', () => {
            modal('productModal').hide();
            const q = editing.fee.mode !== 'manual' ? catLeafName(SD.resolveFeePath({ fee: editing.fee }, ctx) || []) : '';
            openCatPicker('選擇後依賣場類型自動帶入一般或商城費率，費率表更新時會跟著更新。', q, path => {
                editing.fee = { ...editing.fee, mode: 'category', path, needsReview: false };
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
        $('pmRate').addEventListener('input', e => {
            const n = parseFloat(e.target.value);
            if (Number.isFinite(n) && n >= 0) editing.fee = { ...editing.fee, mode: 'manual', manualRate: n, needsReview: false };
            else editing.fee = { ...editing.fee, mode: 'manual', manualRate: null };
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

        $('moveOk').addEventListener('click', applyMove);

        // 蝦皮匯入
        $('imFiles').addEventListener('change', e => onImportFiles(e.target.files));
        $('imPlan').addEventListener('change', e => {
            if (e.target.id === 'imTarget') { im.targetId = e.target.value; renderImportPlan(); }
            if (e.target.name === 'imKeep') im.keepDrafts = e.target.value === '1';
        });
        $('imApply').addEventListener('click', applyImport);

        $('exportOk').addEventListener('click', doExport);

        // 設定
        $('settingsForm').addEventListener('change', onSettingsChange);
        $('stName').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
