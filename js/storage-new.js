// storage.js - Handles saving/loading configurations and sidebar management

// 快速計算的「列表」＝賣場總覽的自建商品（shop-data.js，localStorage shopee_myshop_v1），兩邊是同一份資料。
// 舊制頁（old.html／storage.js）仍用 shopee_calculator_configs_v1；新制的舊設定第一次開啟時搬進賣場。
const SD = window.ShopData;
const FLOATING_TOGGLE_ID = 'floatingSidebarToggle';
const CLOSE_BTN_ID = 'sidebarCloseBtn';
const OVERLAY_ID = 'sidebar-overlay'; // Must match HTML
const LIST_ID = 'savedConfigsList';
const SAVE_BTN_ID = 'saveConfigBtn';

let shopState = SD.emptyState();
const shopCtx = { state: shopState, cats: {}, feeIndex: null };
let loadedRef = null; // 目前從列表載入的商品 { shopId, pid }
let migrated = { moved: 0 };

function reloadShopState() {
    shopState = SD.loadState(localStorage);
    shopCtx.state = shopState;
}
// 賣場頁（或另一個分頁）改了資料時同步
window.addEventListener('storage', (e) => {
    if (e.key === SD.STORAGE_KEY) {
        reloadShopState();
        renderSidebar();
    }
});

// 費率表與蝦皮分類（依類別設定費率的商品才算得出費率）；只載一次
let shopCtxReady = null;
let shopCtxOk = false; // 費率表載入成功才算得出依類別的費率
function ensureShopCtx() {
    if (!shopCtxReady) {
        shopCtxReady = Promise.all([
            fetch('fee-new.json').then(r => r.json()),
            fetch('shopee-categories.json').then(r => r.json()),
        ]).then(([fee, cats]) => {
            shopCtx.feeIndex = SD.buildFeeIndex(fee);
            shopCtx.cats = cats.categories || {};
            shopCtxOk = true;
        }).catch(() => {
            shopCtx.feeIndex = SD.buildFeeIndex([]);
            shopCtxReady = null; // 下次再試
        });
    }
    return shopCtxReady;
}

// DOM Elements
const floatingToggle = document.getElementById(FLOATING_TOGGLE_ID);
const sidebarCloseBtn = document.getElementById(CLOSE_BTN_ID);
const sidebarOverlay = document.getElementById(OVERLAY_ID);
const sidebarList = document.getElementById(LIST_ID);
const saveConfigBtn = document.getElementById(SAVE_BTN_ID);

/* --- Sidebar UI Management --- */
// State Persistence for Sidebar
const SIDEBAR_STATE_KEY = 'shopee_sidebar_state';
let sidebarState = JSON.parse(localStorage.getItem(SIDEBAR_STATE_KEY) || '{"width": 280, "collapsed": false}');

function saveSidebarState() {
    localStorage.setItem(SIDEBAR_STATE_KEY, JSON.stringify(sidebarState));
}

function handleSidebarToggle() {
    const isMobile = window.innerWidth < 768;
    
    if (isMobile) {
        document.body.classList.toggle('toggled');
    } else {
        toggleDesktopSidebar();
    }
}

function toggleDesktopSidebar() {
    const wrapper = document.getElementById('wrapper');
    
    sidebarState.collapsed = !sidebarState.collapsed;
    saveSidebarState();

    if (sidebarState.collapsed) {
        wrapper.classList.add('desktop-collapsed');
    } else {
        wrapper.classList.remove('desktop-collapsed');
    }
}

function initSidebarEvents() {
    const floatingBtn = document.getElementById(FLOATING_TOGGLE_ID);
    const closeBtn = document.getElementById(CLOSE_BTN_ID); // Mobile Close
    const overlay = document.getElementById(OVERLAY_ID);
    
    // Desktop Elements
    const desktopCollapseBtn = document.getElementById('desktopSidebarCollapseBtn');
    const resizer = document.getElementById('resizer');

    // Unified Floating Button Event
    if (floatingBtn) {
        floatingBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleSidebarToggle();
        });
    }
    
    if (closeBtn) closeBtn.addEventListener('click', () => {
        document.body.classList.remove('toggled');
    });
    
    if (overlay) overlay.addEventListener('click', () => {
        document.body.classList.remove('toggled');
    });

    const saveBtn = document.getElementById(SAVE_BTN_ID);
    if (saveBtn) saveBtn.addEventListener('click', openSaveModal);

    // Save Modal Events
    const clearNameBtn = document.getElementById('clearConfigNameBtn');
    if (clearNameBtn) {
        clearNameBtn.addEventListener('click', () => {
            const input = document.getElementById('configNameInput');
            if (input) {
                input.value = '';
                input.focus();
            }
        });
    }

    const confirmSaveBtn = document.getElementById('confirmSaveConfigBtn');
    if (confirmSaveBtn) {
        confirmSaveBtn.addEventListener('click', saveConfig);
    }

    const configNameInput = document.getElementById('configNameInput');
    if (configNameInput) {
        configNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                saveConfig();
            }
        });
    }

    // Desktop Events
    if (desktopCollapseBtn) {
        desktopCollapseBtn.addEventListener('click', toggleDesktopSidebar);
    }

    // Initialize Desktop State (Restore width and collapse state)
    const wrapper = document.getElementById('wrapper');
    if (wrapper) {
        // Restore Width
        if (sidebarState.width) {
            document.documentElement.style.setProperty('--sidebar-width', `${sidebarState.width}px`);
        }
        // Restore Collapsed State
        if (sidebarState.collapsed) {
            wrapper.classList.add('desktop-collapsed');
        }
    }

    // Resizer Logic
    if (resizer) {
        let isResizing = false;
        
        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            resizer.classList.add('resizing');
            document.body.style.cursor = 'col-resize';
            e.preventDefault(); // Prevent text selection
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            // Calculate new width: mouse X position
            // Since sidebar is on the left, width = mouse X
            let newWidth = e.clientX;
            
            // Constraints
            if (newWidth < 200) newWidth = 200; // Min width
            if (newWidth > 600) newWidth = 600; // Max width
            
            document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`);
            sidebarState.width = newWidth;
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                resizer.classList.remove('resizing');
                document.body.style.cursor = '';
                saveSidebarState(); // Save width on stop
            }
        });
    }
}

/* --- Core Configuration Logic --- */

// Helper: Trigger event to notify calculator.js
function triggerEvent(element, type) {
    if (!element) return;
    const event = new Event(type, { bubbles: true });
    element.dispatchEvent(event);
}

// 目前畫面的設定（calculator-new.js 每次變動都會同步到網址）；算售價模式改帶「一般日、方案一」的建議售價
function currentQuery() {
    const q = new URLSearchParams(window.location.search);
    if (document.querySelector('input[name="calcMode"]:checked')?.value === 'price') {
        const el = document.getElementById('regular-ship1-suggested-price');
        q.set('sell', String(el ? parseFloat(el.innerText.replace(/[^\d.-]/g, '')) || 0 : 0));
    }
    return q;
}

const money = (n) => '$ ' + Math.round(n || 0).toLocaleString('zh-TW');

function findLoaded() {
    if (!loadedRef) return null;
    const shop = shopState.shops.find(s => s.id === loadedRef.shopId);
    const p = shop && shop.products.find(x => x.id === loadedRef.pid && !x.shopeeItemId);
    return p ? { shop, p } : null;
}

function openSaveModal() {
    reloadShopState();
    const q = currentQuery();
    const loaded = findLoaded();
    const nameInput = document.getElementById('configNameInput');
    nameInput.value = loaded ? loaded.p.name : `進價 ${money(parseFloat(q.get('cost')))} 售價 ${money(parseFloat(q.get('sell')))}`;

    // 更新／另存：只有從列表載入的商品才有
    const modeWrap = document.getElementById('saveModeWrap');
    modeWrap.classList.toggle('d-none', !loaded);
    if (loaded) {
        document.getElementById('saveModeUpdateLabel').textContent = `更新「${loaded.p.name}」（${loaded.shop.name}）`;
        document.getElementById('saveModeUpdate').checked = true;
    }
    const target = document.getElementById('saveTargetShop');
    target.innerHTML = shopState.shops.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('') +
        '<option value="__new__">＋ 用目前的設定建立新賣場</option>';
    target.value = loaded ? loaded.shop.id : (shopState.activeShopId && shopState.shops.some(s => s.id === shopState.activeShopId) ? shopState.activeShopId : (shopState.shops[0]?.id || '__new__'));
    renderSaveTarget();

    const modalEl = document.getElementById('saveConfigModal');
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
    modalEl.addEventListener('shown.bs.modal', () => { nameInput.focus(); nameInput.select(); }, { once: true });
}

// 存到哪裡、和賣場設定的差異
function renderSaveTarget() {
    const updating = !document.getElementById('saveModeWrap').classList.contains('d-none') && document.getElementById('saveModeUpdate').checked;
    document.getElementById('saveTargetWrap').classList.toggle('d-none', updating);
    const loaded = findLoaded();
    const shop = updating && loaded ? loaded.shop : shopState.shops.find(s => s.id === document.getElementById('saveTargetShop').value);
    const diffEl = document.getElementById('saveDiff');
    if (!shop) {
        diffEl.innerHTML = '<div class="small text-muted">新賣場會沿用目前的賣家類型、免運方案、蝦幣回饋與稅務設定。</div>';
        return;
    }
    const diff = SD.settingsDiff(SD.settingsFromQuery(currentQuery()), shop.settings);
    const label = (k, v) => {
        if (k === 'hasProdInv' || k === 'hasFeeInv' || k === 'first5') return v ? '是' : '否';
        const L = {
            seller: { general: '一般賣家', mall: '商城賣家', shop: '蝦皮小舖' }, shipPlan: { ship1: '方案一', ship2: '方案二' },
            cashback: { '0': '不參加', '1.5': '5% 回饋', '2.5': '10% 回饋' }, cashbackTerm: { long: '長期', short: '短期' },
            tax: { '0': '無', '1': '稅籍登記 1%', '5': '發票 5%', '5_plus': '蝦皮代開發票' },
        };
        return (L[k] && L[k][v]) || String(v);
    };
    diffEl.innerHTML = diff.length
        ? `<div class="alert alert-warning small mb-0 py-2"><div class="mb-1"><i class="bi bi-exclamation-triangle"></i> 目前的設定和「${escapeHtml(shop.name)}」不同，存進去後獲利會依賣場設定計算：</div><ul class="mb-0 ps-3">${diff.map(d => `<li>${d.label}：目前「${escapeHtml(label(d.key, d.from))}」→ 賣場「${escapeHtml(label(d.key, d.to))}」</li>`).join('')}</ul></div>`
        : '<div class="small text-success"><i class="bi bi-check-circle"></i> 設定和賣場相同。</div>';
}

function saveConfig() {
    const name = document.getElementById('configNameInput').value.trim();
    if (!name) { document.getElementById('configNameInput').focus(); return; }
    reloadShopState();
    const q = currentQuery();
    const fresh = SD.productFromQuery(q, name);
    const loaded = findLoaded();
    const updating = loaded && !document.getElementById('saveModeWrap').classList.contains('d-none') && document.getElementById('saveModeUpdate').checked;
    let shop, p;
    if (updating) {
        ({ shop, p } = loaded);
        // 費率沒改就保留原本的類別設定（費率表更新時會跟著走）；費率表沒載入時無法比對，類別設定一律保留
        const sameRate = (!shopCtxOk && p.fee.mode !== 'manual') || SD.resolveRate(p, shop.settings.seller, shopCtx) === fresh.fee.manualRate;
        Object.assign(p, {
            name, cost: fresh.cost, costTax: fresh.costTax, frozen: fresh.frozen, preorder: fresh.preorder,
            // 快速計算有選類別就用新的類別；沒選類別但費率沒變就保留原本的設定
            fee: fresh.fee.mode === 'category' ? fresh.fee : (sameRate ? p.fee : fresh.fee),
        });
        p.variations[0].price = fresh.variations[0].price;
    } else {
        const tid = document.getElementById('saveTargetShop').value;
        shop = shopState.shops.find(s => s.id === tid);
        if (!shop) {
            shop = SD.newShop('我的賣場' + (shopState.shops.length ? ' ' + (shopState.shops.length + 1) : ''), SD.settingsFromQuery(q));
            shopState.shops.push(shop);
        }
        p = fresh;
        shop.products.unshift(p);
    }
    shopState.activeShopId = shop.id;
    try {
        SD.saveState(localStorage, shopState);
    } catch (e) {
        showToast('儲存失敗：瀏覽器的儲存空間不足');
        reloadShopState();
        return;
    }
    loadedRef = { shopId: shop.id, pid: p.id };
    renderSidebar();
    bootstrap.Modal.getInstance(document.getElementById('saveConfigModal'))?.hide();
    showToast(`${updating ? '已更新' : '已儲存到'}「${escapeHtml(shop.name)}」 <a href="shop.html" class="text-white fw-bold ms-1">到賣場查看</a>`);
}

async function loadConfig(shopId, pid) {
    reloadShopState();
    const shop = shopState.shops.find(s => s.id === shopId);
    const p = shop && shop.products.find(x => x.id === pid);
    if (!p) { renderSidebar(); return; }
    await ensureShopCtx();
    const data = Object.fromEntries(new URLSearchParams(SD.quickCalcQuery(shop, p, p.variations[0], shopCtx)));
    data.oldFee = '';
    applyStateToDOM(data);
    loadedRef = { shopId, pid };
    renderSidebar();
    document.body.classList.remove('toggled'); // 手機收起側邊欄
    showToast('已載入：' + escapeHtml(p.name) + (SD.resolveRate(p, shop.settings.seller, shopCtx) == null ? '（還沒有成交手續費率，請按「查詢」選類別）' : ''));
}

function applyStateToDOM(data) {
    // 1. Restore Mode
    if (data.mode) {
        const rad = document.querySelector(`input[name="calcMode"][value="${data.mode}"]`);
        if (rad && !rad.checked) {
            rad.checked = true;
            triggerEvent(rad, 'change');
        }
    }

    // 2. Shipping
    if (data.shipping) {
        const rad = document.querySelector(`input[name="shippingOption"][value="${data.shipping}"]`);
        if (rad && !rad.checked) {
            rad.checked = true;
            triggerEvent(rad, 'change');
        }
    }

    // 3. Seller Type
    if (data.seller) {
        const rad = document.querySelector(`input[name="sellerType"][value="${data.seller}"]`);
        if (rad && !rad.checked) {
            rad.checked = true;
            triggerEvent(rad, 'change');
        }
    }

    // 4. Inputs (Cost, Sell, Margin, Fee)
    const setInput = (id, val) => {
        const el = document.getElementById(id);
        if (el) {
            el.value = val || '';
            triggerEvent(el, 'input');
        }
    };

    setInput('costPrice', data.cost);
    
    // Cost Tax Type (Checkbox)
    const costTaxInput = document.getElementById('costTaxType');
    if (costTaxInput) {
        const shouldBeChecked = (data.costTax !== 'exc'); // default inc
        if (costTaxInput.checked !== shouldBeChecked) {
            costTaxInput.checked = shouldBeChecked;
            triggerEvent(costTaxInput, 'change');
        }
    }

    setInput('sellPrice', data.sell);
    setInput('profitMargin', data.margin);
    // 12/10 前對應費率（總覽表格比較用）；沒有就與目前費率相同
    if (typeof window.setOldTransRate === 'function') window.setOldTransRate(data.oldFee);
    if (typeof window.setFeeCategory === 'function') window.setFeeCategory(data.cat ? String(data.cat).split(' > ') : null);
    setInput('transactionFee', data.fee);

    // 信用卡分期
    {
        const rad = document.getElementById('installment' + (data.installment || '0'));
        if (rad && !rad.checked) {
            rad.checked = true;
            triggerEvent(rad, 'change');
        }
    }

    // 5. Preorder ('0' / '2' / '3')
    if (data.preorder) {
        const targetId = { '2': 'preOrder2', '3': 'isPreOrder' }[data.preorder] || 'noPreOrder';
        const rad = document.getElementById(targetId);
        if (rad && !rad.checked) {
            rad.checked = true;
            triggerEvent(rad, 'change');
        }
    }

    // 6. Cashback
    if (data.cashback) {
        let targetId = 'noCashback';
        if (data.cashback === '1.5') targetId = 'cashback5';
        if (data.cashback === '2.5') targetId = 'cashback10';
        const rad = document.getElementById(targetId);
        if (rad && !rad.checked) {
            rad.checked = true;
            triggerEvent(rad, 'change');
        }
    }

    // 6b. Cashback term (long / short)
    const termRad = document.getElementById(data.cashbackTerm === 'short' ? 'cashbackShort' : 'cashbackLong');
    if (termRad && !termRad.checked) {
        termRad.checked = true;
        triggerEvent(termRad, 'change');
    }

    // 7. Tax Settings
    if (data.tax) {
        let targetId = 'noTax';
        if (data.tax === '1') targetId = 'businessTax';
        if (data.tax === '5') targetId = 'invoiceTax';
        if (data.tax === '5_plus') targetId = 'shopeeInvoice';
        const rad = document.getElementById(targetId);
        if (rad && !rad.checked) {
            rad.checked = true;
            triggerEvent(rad, 'change'); // This will trigger visibility updates for sub-options
        }
    }

    // 8. Invoice Details (checkboxes)
    // Need to wait slightly for tax setting to reveal options? 
    // Usually synchronous in calculator.js, but let's be safe
    // The previous triggerEvent on tax radio should update "inputTaxOptions" visibility immediately
    
    const setCheck = (id, isChecked) => {
        const el = document.getElementById(id);
        if (el && el.checked !== isChecked) {
            el.checked = isChecked;
            triggerEvent(el, 'change');
        }
    };

    // queryParams stores boolean as string '1' sometimes? 
    // In calculator.js getQueryParams: hasProdInv: params.get('hasProdInv') === '1'
    setCheck('hasProductInvoice', data.hasProdInv === '1');
    setCheck('hasFeeInvoice', data.hasFeeInv === '1');
    setCheck('frozenOrder', data.frozen === '1');
    setCheck('shopFirstFive', data.first5 === '1');
}

function deleteConfig(shopId, pid, event) {
    if (event) event.stopPropagation();
    reloadShopState();
    const shop = shopState.shops.find(s => s.id === shopId);
    const p = shop && shop.products.find(x => x.id === pid);
    if (!p) { renderSidebar(); return; }
    if (!confirm(`確定要刪除「${p.name}」嗎？賣場總覽的自建商品也會一起刪除。`)) return;
    shop.products = shop.products.filter(x => x.id !== pid);
    try { SD.saveState(localStorage, shopState); } catch (e) { reloadShopState(); return; }
    if (loadedRef && loadedRef.pid === pid) loadedRef = null;
    renderSidebar();
    showToast('已刪除');
}

// HTML Escaping
function escapeHtml(text) {
    // 也用在屬性值裡，引號要一起跳脫（商品名稱常有 5" 這種字）
    return String(text == null ? '' : text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 列表：所有賣場的自建商品，依賣場分組（只有一個賣場時不顯示賣場名稱）
function renderSidebar() {
    const listEl = document.getElementById(LIST_ID);
    if (!listEl) return;
    const groups = shopState.shops.map(shop => ({ shop, items: shop.products.filter(p => !p.shopeeItemId) })).filter(g => g.items.length);
    if (!groups.length) {
        listEl.innerHTML = '<div class="text-center p-4 text-muted"><small>還沒有自建商品<br>試算後按「儲存到賣場」就會出現在這裡</small></div>';
        return;
    }
    const showShop = shopState.shops.length > 1;
    listEl.innerHTML = groups.map(({ shop, items }) =>
        (showShop ? `<div class="sidebar-shop-heading"><i class="bi bi-shop-window"></i> ${escapeHtml(shop.name)}</div>` : '') +
        items.map(p => {
            const rate = shopCtx.feeIndex ? SD.resolveRate(p, shop.settings.seller, shopCtx) : (p.fee.mode === 'manual' ? p.fee.manualRate : null);
            const active = loadedRef && loadedRef.pid === p.id;
            return `<a href="#" class="sidebar-list-item list-group-item list-group-item-action${active ? ' active-item' : ''}" data-shop="${escapeHtml(shop.id)}" data-pid="${escapeHtml(p.id)}"${active ? ' aria-current="true"' : ''}>
  <div class="d-flex justify-content-between align-items-start">
    <div class="w-100">
      <span class="config-title">${escapeHtml(p.name || '（未命名）')}</span>
      <div class="config-details"><span>進價 ${p.cost != null ? money(p.cost) : '未填'}</span><span class="mx-1">•</span><span>售價 ${money(p.variations[0].price)}</span>${rate != null ? `<span class="mx-1">•</span><span>${rate}%</span>` : ''}</div>
    </div>
    <button class="btn btn-link btn-sm delete-config-btn" title="刪除" aria-label="刪除 ${escapeHtml(p.name)}"><i class="bi bi-trash"></i></button>
  </div></a>`;
        }).join('')).join('') +
        '<a class="sidebar-manage-link" href="shop.html"><i class="bi bi-shop"></i> 到賣場總覽管理</a>';
}

function showToast(message) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toastHtml = `
        <div class="toast align-items-center text-white bg-dark border-0" role="alert" aria-live="assertive" aria-atomic="true">
            <div class="d-flex">
                <div class="toast-body">
                    ${message}
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
        </div>
    `;
    
    const template = document.createElement('div');
    template.innerHTML = toastHtml.trim();
    const toastEl = template.firstChild;
    
    container.appendChild(toastEl);
    
    // Assumes bootstrap is globally available
    if (window.bootstrap && window.bootstrap.Toast) {
        const toast = new bootstrap.Toast(toastEl, { delay: 3000 });
        toast.show();
        toastEl.addEventListener('hidden.bs.toast', () => {
            toastEl.remove();
        });
    }
}

// Initialization on DOMReady
document.addEventListener('DOMContentLoaded', () => {
    try {
        migrated = SD.migrateQuickConfigsInStorage(localStorage);
    } catch (e) {
        migrated = { moved: 0 }; // 搬不了也要讓列表與儲存按鈕能用
    }
    reloadShopState();
    renderSidebar();
    initSidebarEvents();
    if (migrated.moved) showToast(`以前存的 ${migrated.moved} 筆設定已搬到「${escapeHtml(migrated.shopName)}」的自建商品`);
    ensureShopCtx().then(renderSidebar); // 費率表載入後補上依類別計算的費率

    // 列表點擊（事件委派）：點項目載入、點垃圾桶刪除
    document.getElementById(LIST_ID)?.addEventListener('click', (e) => {
        const item = e.target.closest('.sidebar-list-item[data-pid]');
        if (!item) return;
        e.preventDefault();
        if (e.target.closest('.delete-config-btn')) deleteConfig(item.dataset.shop, item.dataset.pid, e);
        else loadConfig(item.dataset.shop, item.dataset.pid);
    });
    document.getElementById('saveTargetShop')?.addEventListener('change', renderSaveTarget);
    document.querySelectorAll('input[name="saveMode"]').forEach(r => r.addEventListener('change', renderSaveTarget));
});
