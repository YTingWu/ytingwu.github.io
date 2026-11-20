// shop-data.js — 我的賣場：資料模型、費率對應、獲利計算、蝦皮匯入合併、調價草稿（不碰 DOM）。
// 需要 fee-engine.js。node 測試：require('./shop-data.js')（會自己 require fee-engine）。
(function (root) {
    'use strict';
    // 瀏覽器：fee-engine.js 的頂層 const 不會掛在 window 上，直接用全域名稱
    const engine = (typeof module !== 'undefined' && module.exports)
        ? require('./fee-engine.js')
        : { computeScenario, calculateRequiredPrice };

    const STORAGE_KEY = 'shopee_myshop_v1';
    const QUICK_KEY = 'shopee_calculator_configs_v1'; // 快速計算的已存設定（舊制頁 old.html 仍在用）
    const QUICK_BACKUP_KEY = 'shopee_calculator_configs_v1_migrated'; // 搬進賣場的原始設定備份
    const STALE_MS = 24 * 60 * 60 * 1000;
    const PAYMENT_PCT = 2.5; // 金流與系統處理費（不分期）
    const MAX_STOCK = 9999999; // 防呆用上限（避免 1e21 之類寫成科學記號）

    // 蝦皮分類樹與費率表名稱或層級不一致的對應：蝦皮分類 ID → fee-new.json 路徑
    const CATEGORY_ALIASES = {
        '102070': ['母嬰用品', '嬰幼童奶粉、副食品', 'UHT Milk'],            // Ready-to-Drink Milk
        '102429': ['汽機車百貨／交通用品', '車外裝飾及性能配件', '車貼'],      // 蝦皮多一層「車外裝飾/改裝配件」
    };

    const DEFAULT_SETTINGS = {
        seller: 'general', shipPlan: 'ship1', cashback: '0', cashbackTerm: 'long', tax: '0',
        hasProdInv: false, hasFeeInv: false, first5: false, lowMargin: 5,
    };

    const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const cleanName = (t) => String(t == null ? '' : t).replace(/[\x00-\x1f\x7f]/g, '').trim();

    // ---------- 狀態 ----------

    function emptyState() {
        return { version: 1, activeShopId: null, shops: [], catOverrides: {} };
    }

    function newShop(name, settings) {
        return {
            id: uid(), name: name || '我的賣場', createdAt: Date.now(),
            settings: { ...DEFAULT_SETTINGS, ...(settings || {}) },
            shopeeShopId: null, products: [], salesFile: null, lastImportAt: null,
        };
    }

    function newProduct(fields) {
        return {
            id: uid(), shopeeItemId: null, name: '', note: '', cost: null, costTax: 'inc',
            hasProdInv: null, frozen: false, preorder: '0', // hasProdInv: null＝跟隨賣場設定
            fee: { mode: 'manual', catId: null, catLabel: '', path: null, manualRate: 6, needsReview: false },
            variations: [{ id: uid(), shopeeVarId: null, name: '', price: 0, stock: null, cost: null, draft: null }],
            missingInLastImport: false, createdAt: Date.now(),
            ...(fields || {}),
        };
    }

    // 舊資料：商品進項發票原本只有商品層開關。賣場預設補 false；商品沒勾的改成跟隨賣場，有勾的保留為單獨設定
    function migrateShops(shops) {
        shops.forEach(shop => {
            // 欄位缺漏的資料（手改或舊版）補齊，避免後面的程式丟例外
            if (!Array.isArray(shop.products)) shop.products = [];
            if (!shop.settings || typeof shop.settings !== 'object') shop.settings = { ...DEFAULT_SETTINGS };
            if (shop.settings.hasProdInv != null) return;
            shop.settings.hasProdInv = false;
            (shop.products || []).forEach(p => { p.hasProdInv = p.hasProdInv ? true : null; });
        });
        return shops;
    }

    function loadState(storage) {
        try {
            const raw = storage.getItem(STORAGE_KEY);
            if (!raw) return emptyState();
            const s = JSON.parse(raw);
            if (!s || !Array.isArray(s.shops)) return emptyState();
            s.catOverrides = s.catOverrides || {};
            migrateShops(s.shops);
            return s;
        } catch (e) {
            return emptyState();
        }
    }

    function saveState(storage, state) {
        storage.setItem(STORAGE_KEY, JSON.stringify(state)); // 超過容量會丟例外，由呼叫端提示
    }

    // ---------- 費率表與分類 ----------

    // fee-new.json → { leaves: Map('a\u0001b\u0001c' → {general, mall}), list: [{path, general, mall}] }
    function buildFeeIndex(feeJson) {
        const leaves = new Map();
        const list = [];
        (function walk(node, path) {
            if (Array.isArray(node)) { node.forEach(n => walk(n, path)); return; }
            if (!node || typeof node !== 'object') return;
            if (node.general_seller_fee || node.mall_seller_fee) {
                const rec = { path, general: parseFloat(node.general_seller_fee), mall: parseFloat(node.mall_seller_fee) };
                leaves.set(path.join('\u0001'), rec);
                list.push(rec);
                return;
            }
            Object.entries(node).forEach(([k, v]) => walk(v, [...path, k]));
        })(feeJson, []);
        return { leaves, list };
    }

    // shopee-categories.json 的 categories → 中文路徑陣列；ID 不在樹裡回 null
    function shopeeCategoryPath(catId, cats) {
        const out = [];
        let id = String(catId);
        for (let guard = 0; guard < 10 && id && id !== '0'; guard++) {
            const node = cats[id];
            if (!node) return null;
            out.unshift(cleanName(node[1]));
            id = String(node[0]);
        }
        return out;
    }

    // 蝦皮分類 ID → fee-new.json 葉節點路徑：別名 → 完全相同 → 最長的前綴葉節點
    function matchFeePath(catId, cats, feeIndex) {
        const alias = CATEGORY_ALIASES[String(catId)];
        if (alias && feeIndex.leaves.has(alias.join('\u0001'))) return { path: alias, how: 'alias' };
        const sp = shopeeCategoryPath(catId, cats);
        if (!sp) return null;
        for (let n = sp.length; n >= 1; n--) {
            const key = sp.slice(0, n).join('\u0001');
            if (feeIndex.leaves.has(key)) return { path: sp.slice(0, n), how: n === sp.length ? 'exact' : 'parent' };
        }
        return null;
    }

    // 商品目前採用的類別路徑（auto 模式依分類 ID；使用者曾手動指定該分類 ID 的就用指定值）
    function resolveFeePath(product, ctx) {
        const f = product.fee || {};
        if (f.mode === 'category') return f.path || null;
        if (f.mode === 'auto' && f.catId) {
            const ov = ctx.state.catOverrides[String(f.catId)];
            if (ov) return ov;
            const m = matchFeePath(f.catId, ctx.cats, ctx.feeIndex);
            return m ? m.path : null;
        }
        return null;
    }

    // 成交手續費率（%）；查不到回 null（介面顯示「請選類別」）
    function resolveRate(product, seller, ctx) {
        const f = product.fee || {};
        if (f.mode === 'manual') return Number.isFinite(f.manualRate) ? f.manualRate : null;
        const path = resolveFeePath(product, ctx);
        if (!path) return null;
        const leaf = ctx.feeIndex.leaves.get(path.join('\u0001'));
        if (!leaf) return null;
        return seller === 'mall' ? leaf.mall : leaf.general;
    }

    // ---------- 獲利 ----------

    // 進價：蝦皮商品只看規格進價（比照蝦皮，每個規格各自填）；自建商品只有一個規格，看商品進價
    function variationCost(product, v) {
        const c = product.shopeeItemId ? v.cost : product.cost;
        return c != null && c !== '' ? Number(c) : null;
    }

    function effectivePrice(v) {
        return v.draft && v.draft.price != null ? v.draft.price : v.price;
    }

    // 與 calculator-new.js 的 getSettings() 同一套規則
    function engineSettings(shop, product, cost, rate) {
        const st = shop.settings;
        const isShop = st.seller === 'shop';
        return {
            seller: st.seller,
            cost: cost || 0,
            isCostInc: product.costTax !== 'exc',
            transRate: rate || 0,
            paymentPct: PAYMENT_PCT, // 信用卡分期看買家選擇，賣場一律以不分期計算（分期在快速計算試算）
            cashbackRate: isShop ? 0 : parseFloat(st.cashback) || 0,
            cashbackShort: st.cashbackTerm === 'short',
            preOrderRate: isShop ? 0 : parseFloat(product.preorder) || 0,
            taxSetting: st.tax,
            hasProdInv: prodInvOf(shop, product),
            hasFeeInv: !!st.hasFeeInv,
            frozen: !isShop && !!product.frozen,
            first5: isShop && !!st.first5,
        };
    }

    // 商品進項發票：商品有單獨設定就用商品的，沒有就吃賣場預設
    const prodInvOf = (shop, product) => product.hasProdInv == null ? !!shop.settings.hasProdInv : !!product.hasProdInv;

    // 單一規格在一般日／促銷檔期的結果；price 不給就用（草稿優先的）售價
    function variationMetrics(shop, product, v, ctx, price) {
        const p = price != null ? price : effectivePrice(v);
        const cost = variationCost(product, v);
        const rate = resolveRate(product, shop.settings.seller, ctx);
        const s = engineSettings(shop, product, cost, rate);
        const isShip2 = shop.settings.shipPlan === 'ship2';
        const regular = engine.computeScenario(p, s, false, isShip2);
        const event = engine.computeScenario(p, s, true, isShip2);
        const margin = (r) => (p > 0 ? r.profit / p * 100 : null);
        return {
            price: p, cost, rate, hasCost: cost != null, hasRate: rate != null,
            regular: { ...regular, margin: margin(regular) },
            event: { ...event, margin: margin(event) },
            settings: s,
        };
    }

    // 以規格為單位的摘要（自建商品一個商品一個規格，數字等於商品數）
    function variationSummary(shop, products, ctx) {
        let variations = 0, loss = 0, incomplete = 0, sumR = 0, sumE = 0, n = 0;
        for (const p of products) {
            for (const v of p.variations) {
                variations++;
                const m = variationMetrics(shop, p, v, ctx);
                if (!m.hasCost || !m.hasRate || m.regular.margin == null) { incomplete++; continue; }
                if (m.regular.profit < 0 || m.event.profit < 0) loss++;
                sumR += m.regular.margin;
                sumE += m.event.margin;
                n++;
            }
        }
        return { products: products.length, variations, loss, incomplete, avgRegular: n ? sumR / n : null, avgEvent: n ? sumE / n : null };
    }

    // 刪除規格；商品的規格全刪光就整個商品刪掉。回傳 { variations, products } 刪掉的數量
    function deleteVariations(shop, vids) {
        const del = new Set(vids);
        let nv = 0, np = 0;
        shop.products = shop.products.filter(p => {
            const before = p.variations.length;
            p.variations = p.variations.filter(v => !del.has(v.id));
            nv += before - p.variations.length;
            if (p.variations.length) return true;
            np++;
            return false;
        });
        return { variations: nv, products: np };
    }

    // 一鍵清除：拿掉這個賣場所有蝦皮商品、原檔、綁定的蝦皮賣場 ID；自建商品與設定保留
    function clearShopee(shop) {
        const n = shop.products.filter(p => p.shopeeItemId).length;
        shop.products = shop.products.filter(p => !p.shopeeItemId);
        shop.salesFile = null;
        shop.shopeeShopId = null;
        shop.lastImportAt = null;
        return n;
    }

    // 依目標利潤率回推售價（一般日或促銷檔期）
    function requiredPrice(shop, product, v, ctx, marginPct, isEvent) {
        const cost = variationCost(product, v);
        const rate = resolveRate(product, shop.settings.seller, ctx);
        if (cost == null || cost <= 0 || rate == null) return null;
        const s = engineSettings(shop, product, cost, rate);
        return engine.calculateRequiredPrice(s, marginPct, !!isEvent, shop.settings.shipPlan === 'ship2') || null;
    }

    // ---------- 快速計算 query string ----------

    const FEE_CAT_SEP = ' > '; // 快速計算網址的類別路徑分隔（calculator-new.js 同一個）
    const SHOP_KEYS = ['seller', 'shipPlan', 'cashback', 'cashbackTerm', 'tax', 'hasProdInv', 'hasFeeInv', 'first5'];

    function settingsFromQuery(q) {
        const g = (k, d) => (q.get(k) != null && q.get(k) !== '' ? q.get(k) : d);
        const seller = ['general', 'mall', 'shop'].includes(g('seller')) ? g('seller') : 'general';
        return {
            ...DEFAULT_SETTINGS,
            seller,
            shipPlan: g('shipping') === 'ship2' ? 'ship2' : 'ship1',
            cashback: ['0', '1.5', '2.5'].includes(g('cashback')) ? g('cashback') : '0',
            cashbackTerm: g('cashbackTerm') === 'short' ? 'short' : 'long',
            tax: ['0', '1', '5', '5_plus'].includes(g('tax')) ? g('tax') : '0',
            hasProdInv: g('hasProdInv') === '1',
            hasFeeInv: g('hasFeeInv') === '1',
            first5: g('first5') === '1',
        };
    }

    function productFromQuery(q, name) {
        const num = (k) => { const n = parseFloat(q.get(k)); return Number.isFinite(n) ? n : null; };
        const p = newProduct({
            name: name || '',
            cost: num('cost'),
            costTax: q.get('costTax') === 'exc' ? 'exc' : 'inc',
            frozen: q.get('frozen') === '1',
            preorder: ['2', '3'].includes(q.get('preorder')) ? q.get('preorder') : '0',
        });
        p.fee = { mode: 'manual', catId: null, catLabel: '', path: null, manualRate: num('fee') ?? 6, needsReview: false };
        // 快速計算用「查詢」選了類別（cat）→ 存成依類別的費率（費率表更新時跟著走）
        const cat = q.get('cat');
        if (cat) p.fee = { ...p.fee, mode: 'category', path: cat.split(FEE_CAT_SEP) };
        p.variations[0].price = Math.round(num('sell') || 0);
        return p;
    }

    // 快速計算與賣場設定不同的項目（顯示用）
    function settingsDiff(a, b) {
        const LABEL = { seller: '賣場類型', shipPlan: '免運方案', cashback: '蝦幣回饋', cashbackTerm: '蝦幣回饋期間', tax: '稅務', hasProdInv: '商品進項發票', hasFeeInv: '手續費進項發票', first5: '前 5 筆免手續費' };
        return SHOP_KEYS.filter(k => String(a[k]) !== String(b[k])).map(k => ({ key: k, label: LABEL[k], from: a[k], to: b[k] }));
    }

    // 賣場設定＋商品＋規格 → 快速計算網址的 query string
    function quickCalcQuery(shop, product, v, ctx) {
        const st = shop.settings;
        const q = new URLSearchParams();
        q.set('mode', 'profit');
        q.set('shipping', st.shipPlan);
        q.set('seller', st.seller);
        const cost = variationCost(product, v);
        if (cost != null) q.set('cost', String(cost));
        q.set('costTax', product.costTax === 'exc' ? 'exc' : 'inc');
        q.set('sell', String(effectivePrice(v) || 0));
        const rate = resolveRate(product, st.seller, ctx);
        if (rate != null) q.set('fee', String(rate));
        // 依類別的費率：把類別帶過去，快速計算顯示並在存回賣場時保留
        if (product.fee && product.fee.mode !== 'manual' && rate != null) {
            const path = resolveFeePath(product, ctx);
            if (path) q.set('cat', path.join(FEE_CAT_SEP));
        }
        q.set('preorder', product.preorder || '0');
        q.set('cashback', st.cashback);
        if (st.cashback !== '0') q.set('cashbackTerm', st.cashbackTerm);
        q.set('tax', st.tax);
        if (st.tax === '5' || st.tax === '5_plus') {
            if (prodInvOf(shop, product)) q.set('hasProdInv', '1');
            if (st.hasFeeInv) q.set('hasFeeInv', '1');
        }
        if (product.frozen) q.set('frozen', '1');
        if (st.first5) q.set('first5', '1');
        return q.toString();
    }

    // 快速計算「已存設定」（storage-new.js 的 data＝query 物件）→ 商品
    function productFromSavedConfig(cfg, isNewRates) {
        const q = new URLSearchParams(cfg.data || {});
        const p = productFromQuery(q, cfg.title != null ? String(cfg.title) : '');
        // 算售價模式存的是目標利潤率，沒有售價：用 summary 的售價（storage-new.js 存成「進價: $ x 售價: $ y」）
        if (!p.variations[0].price && cfg.summary) {
            const m = String(cfg.summary).match(/售價:\s*\$\s*([\d,]+)/);
            if (m) p.variations[0].price = parseInt(m[1].replace(/,/g, ''), 10) || 0;
        }
        p.fee.needsReview = !isNewRates; // 舊制費率存的設定要重選類別
        return p;
    }

    // 快速計算（新制）的已存設定一次搬進賣場的自建商品：放第一個賣場，沒有賣場就用第一筆的設定建「我的賣場」。
    // 舊制（rates 不是 'new'）的留在原清單給 old.html 用。回傳 { moved, shop, rest }，不寫入 storage
    function migrateQuickConfigs(state, configs) {
        const list = Array.isArray(configs) ? configs : [];
        const moving = list.filter(c => c && c.rates === 'new');
        const rest = list.filter(c => !(c && c.rates === 'new'));
        if (!moving.length) return { moved: 0, shop: null, rest };
        let shop = state.shops[0];
        if (!shop) {
            shop = newShop('我的賣場', settingsFromQuery(new URLSearchParams(moving[0].data || {})));
            state.shops.push(shop);
            state.activeShopId = shop.id;
        }
        shop.products.unshift(...moving.map(c => productFromSavedConfig(c, true))); // 清單本來就是新的在前
        return { moved: moving.length, shop, rest };
    }

    // 在 storage 上執行搬遷：先存賣場，成功才改寫快速計算清單。
    // 搬走的原始設定另存在 QUICK_BACKUP_KEY（只增不刪），萬一要人工救回時還找得到。
    // 賣場資料存在但讀不懂（壞掉的 JSON）時不搬，免得蓋掉還能人工救回的原始內容。
    function migrateQuickConfigsInStorage(storage) {
        const rawConfigs = storage.getItem(QUICK_KEY);
        let configs;
        try { configs = JSON.parse(rawConfigs || '[]'); } catch (e) { return { moved: 0 }; }
        if (!Array.isArray(configs) || !configs.some(c => c && c.rates === 'new')) return { moved: 0 };
        const raw = storage.getItem(STORAGE_KEY);
        if (raw) {
            try { const s = JSON.parse(raw); if (!s || !Array.isArray(s.shops)) return { moved: 0 }; } catch (e) { return { moved: 0 }; }
        }
        const state = loadState(storage);
        const r = migrateQuickConfigs(state, configs);
        // 另一個分頁剛搬完（清單已被改寫）就不要再搬一次
        if (storage.getItem(QUICK_KEY) !== rawConfigs) return { moved: 0 };
        try {
            let backup = [];
            try { backup = JSON.parse(storage.getItem(QUICK_BACKUP_KEY) || '[]'); } catch (e) { backup = []; }
            if (!Array.isArray(backup)) backup = [];
            const moved = configs.filter(c => c && c.rates === 'new');
            storage.setItem(QUICK_BACKUP_KEY, JSON.stringify(backup.concat(moved.map(c => ({ ...c, migratedAt: new Date().toISOString() })))));
            saveState(storage, state);
        } catch (e) {
            return { moved: 0, error: e };
        }
        try {
            storage.setItem(QUICK_KEY, JSON.stringify(r.rest));
        } catch (e) {
            // 賣場已存好，舊清單改不掉：至少把已搬的標記起來，下次不要重複搬
            try { storage.setItem(QUICK_KEY, JSON.stringify(configs.map(c => (c && c.rates === 'new' ? { ...c, rates: 'migrated' } : c)))); } catch (e2) { /* 無能為力 */ }
        }
        return { moved: r.moved, shopName: r.shop.name, state };
    }

    // ---------- 蝦皮匯入 ----------

    const PREORDER_FROM_DTS = (d) => { const n = parseInt(d, 10); return n >= 3 ? '3' : n === 2 ? '2' : '0'; };

    // files：parseShopeeXlsx 的結果陣列（最多一份 sales、一份 dts）
    // 回傳 plan（不改 state），介面確認後呼叫 applyImportPlan
    function planImport(shop, files, ctx) {
        const sales = files.find(f => f.type === 'sales') || null;
        const dts = files.find(f => f.type === 'dts') || null;
        const errors = [];
        const warnings = [];
        if (sales && dts && sales.shopId && dts.shopId && sales.shopId !== dts.shopId) {
            errors.push(`兩份檔案來自不同的蝦皮賣場（${sales.shopId}、${dts.shopId}），請重新下載同一個賣場的檔案。`);
        }
        const fileShopId = (sales && sales.shopId) || (dts && dts.shopId) || null;
        if (shop.shopeeShopId && fileShopId && shop.shopeeShopId !== fileShopId) {
            warnings.push({ code: 'shop-mismatch', text: `這個賣場之前匯入的是蝦皮賣場 ${shop.shopeeShopId}，這次的檔案是 ${fileShopId}。建議切換到對應的賣場或建立新賣場。` });
        }

        // 依商品 ID 分組
        const items = new Map();
        const ensure = (id) => { if (!items.has(id)) items.set(id, { id, name: '', sales: [], dts: [] }); return items.get(id); };
        if (sales) sales.rows.forEach(r => { const it = ensure(r.productId); it.name = it.name || r.productName; it.sales.push(r); });
        if (dts) dts.rows.forEach(r => { const it = ensure(r.productId); it.name = it.name || r.productName; it.dts.push(r); });

        const byItem = new Map(shop.products.filter(p => p.shopeeItemId).map(p => [p.shopeeItemId, p]));
        const add = [], update = [], needOther = [];
        for (const it of items.values()) {
            const existing = byItem.get(it.id);
            if (existing) update.push({ item: it, product: existing });
            else if (it.sales.length && it.dts.length) add.push({ item: it });
            else needOther.push({ item: it, missing: it.sales.length ? 'dts' : 'sales' });
        }
        const missing = shop.products.filter(p => p.shopeeItemId && !items.has(p.shopeeItemId));

        // 分類：對不到的（不含使用者已指定過的）
        const unmatched = new Map();
        const catStats = { exact: 0, parent: 0, alias: 0, override: 0, none: 0 };
        for (const { item } of [...add, ...update]) {
            const row = item.dts[0];
            if (!row) continue;
            const catId = row.categoryId;
            if (ctx.state.catOverrides[catId]) { catStats.override++; continue; }
            const m = catId ? matchFeePath(catId, ctx.cats, ctx.feeIndex) : null;
            if (m) catStats[m.how]++;
            else {
                catStats.none++;
                const u = unmatched.get(catId) || { catId, label: row.categoryLabel, path: catId ? shopeeCategoryPath(catId, ctx.cats) : null, count: 0 };
                u.count++;
                unmatched.set(catId, u);
            }
        }

        // 調價草稿
        const salesVar = new Map();
        if (sales) sales.rows.forEach(r => salesVar.set(r.variationId, r));
        const pendingDrafts = [], exportedMatched = [], exportedMismatched = [];
        for (const { product } of update) {
            for (const v of product.variations) {
                if (!v.draft || !v.shopeeVarId) continue;
                const r = salesVar.get(v.shopeeVarId);
                if (!r) continue;
                const same = (v.draft.price == null || v.draft.price === r.price) && (v.draft.stock == null || v.draft.stock === r.stock);
                const ref = { product, v, row: r };
                if (v.draft.status === 'exported') (same ? exportedMatched : exportedMismatched).push(ref);
                else pendingDrafts.push(ref);
            }
        }

        return { sales, dts, fileShopId, errors, warnings, add, update, needOther, missing, unmatched: [...unmatched.values()], catStats, pendingDrafts, exportedMatched, exportedMismatched };
    }

    // options：{ keepPendingDrafts: true, catPicks: { catId: path }, salesFileB64, now }
    function applyImportPlan(shop, plan, ctx, options) {
        const opt = { keepPendingDrafts: true, catPicks: {}, ...(options || {}) };
        const now = opt.now || Date.now();
        Object.entries(opt.catPicks).forEach(([catId, path]) => { if (path) ctx.state.catOverrides[catId] = path; });

        const applyDts = (product, rows) => {
            if (!rows.length) return;
            const r = rows[0];
            if (product.fee.mode !== 'category' && r.categoryId) {
                product.fee = { ...product.fee, mode: 'auto', catId: r.categoryId, catLabel: r.categoryLabel, needsReview: false };
            }
            product.preorder = PREORDER_FROM_DTS(Math.max(...rows.map(x => parseInt(x.dts, 10) || 0)));
        };
        const applySales = (product, rows, isNew) => {
            if (!rows.length) return;
            const byVar = new Map(product.variations.filter(v => v.shopeeVarId).map(v => [v.shopeeVarId, v]));
            if (isNew) product.variations = [];
            for (const r of rows) {
                let v = byVar.get(r.variationId);
                if (!v) {
                    v = { id: uid(), shopeeVarId: r.variationId, name: '', price: 0, stock: null, cost: null, draft: null };
                    product.variations.push(v);
                    byVar.set(r.variationId, v); // 同一份檔案重複的選項 ID 不要建兩個規格
                }
                v.name = r.variationName || '';
                v.price = r.price;
                v.stock = r.stock;
            }
        };

        for (const { item } of plan.add) {
            const p = newProduct({ shopeeItemId: item.id, name: item.name });
            p.fee = { mode: 'auto', catId: null, catLabel: '', path: null, manualRate: null, needsReview: false };
            applySales(p, item.sales, true);
            applyDts(p, item.dts);
            shop.products.push(p);
        }
        for (const { item, product } of plan.update) {
            if (item.name) product.name = item.name;
            applySales(product, item.sales, false);
            applyDts(product, item.dts);
            product.missingInLastImport = false;
        }
        plan.missing.forEach(p => { p.missingInLastImport = true; });

        plan.exportedMatched.forEach(({ v }) => { v.draft = null; });
        plan.exportedMismatched.forEach(({ v }) => { v.draft.status = 'pending'; });
        if (!opt.keepPendingDrafts) plan.pendingDrafts.forEach(({ v }) => { v.draft = null; });

        if (plan.fileShopId && !shop.shopeeShopId) shop.shopeeShopId = plan.fileShopId;
        if (plan.sales && opt.salesFileB64) shop.salesFile = { name: plan.sales.fileName, importedAt: now, fileTime: opt.salesFileTime || null, b64: opt.salesFileB64 };
        shop.lastImportAt = now;
        return shop;
    }

    // ---------- 調價草稿與匯出 ----------

    function setDraft(v, field, value) {
        const base = field === 'price' ? v.price : v.stock;
        const d = v.draft ? { ...v.draft } : { price: null, stock: null, status: 'pending' };
        d[field] = value === base ? null : value;
        d.status = 'pending';
        v.draft = (d.price == null && d.stock == null) ? null : d;
    }

    function pendingChanges(shop) {
        const out = [];
        for (const p of shop.products) {
            if (!p.shopeeItemId) continue;
            for (const v of p.variations) {
                if (v.draft && v.draft.status === 'pending' && v.shopeeVarId) out.push({ product: p, v });
            }
        }
        return out;
    }

    // 蝦皮規則：價格 1–499999 整數；同一商品最貴規格 ≤ 最便宜 × 5；庫存 ≥ 0 整數
    function validateChanges(shop, changes) {
        const problems = [];
        const products = new Set(changes.map(c => c.product));
        for (const { product, v } of changes) {
            const price = effectivePrice(v);
            if (!Number.isInteger(price) || price < 1 || price > 499999) problems.push({ product, v, text: '價格要是 1～499999 的整數' });
            const stock = v.draft && v.draft.stock != null ? v.draft.stock : v.stock;
            if (!Number.isInteger(stock) || stock < 0 || stock > MAX_STOCK) problems.push({ product, v, text: `庫存要是 0～${MAX_STOCK.toLocaleString('en-US')} 的整數` });
        }
        for (const p of products) {
            const prices = p.variations.map(effectivePrice).filter(x => x > 0);
            if (prices.length > 1 && Math.max(...prices) > Math.min(...prices) * 5) {
                problems.push({ product: p, v: null, text: `最貴規格 $${Math.max(...prices)} 超過最便宜 $${Math.min(...prices)} 的 5 倍` });
            }
        }
        return problems;
    }

    function markExported(changes) {
        changes.forEach(({ v }) => { if (v.draft) v.draft.status = 'exported'; });
    }

    // 資料時間：優先用蝦皮檔名的產生時間（匯入三天前下載的檔案也要算過期）
    function salesDataTime(shop) {
        if (!shop.salesFile) return null;
        return shop.salesFile.fileTime || shop.salesFile.importedAt;
    }

    function isStale(shop, now) {
        const t = salesDataTime(shop);
        return t != null && (now || Date.now()) - t > STALE_MS;
    }

    // ---------- 匯出 ----------

    function csvEscape(x) {
        const t = x == null ? '' : String(x);
        return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    }

    // 商品分類欄（CSV 最後一欄，匯入時還原 product.fee）：
    //   依類別（快速計算／商品視窗選的）→ 費率表路徑「A > B > C」
    //   依蝦皮分類（匯入時帶入）       →「蝦皮分類 12345 - 分類名稱」；沒有分類 ID 是「蝦皮分類」
    //   手動費率                       → 空白（費率看「成交手續費率」欄）
    const CSV_SHOPEE_CAT = '蝦皮分類';
    function feeToCsv(fee) {
        const f = fee || {};
        if (f.mode === 'category' && Array.isArray(f.path) && f.path.length) return f.path.join(FEE_CAT_SEP);
        if (f.mode === 'auto') return f.catId ? `${CSV_SHOPEE_CAT} ${f.catId}${f.catLabel ? ' - ' + f.catLabel : ''}` : CSV_SHOPEE_CAT;
        return '';
    }
    // → fee 物件；空白回 null（改用成交手續費率欄）
    function feeFromCsv(text) {
        const t = String(text || '').trim();
        if (!t) return null;
        const base = { mode: 'manual', catId: null, catLabel: '', path: null, manualRate: null, needsReview: false };
        const m = t.match(new RegExp(`^${CSV_SHOPEE_CAT}(?:\\s*(\\d+)(?:\\s*-\\s*([\\s\\S]*))?)?$`));
        if (m) return { ...base, mode: 'auto', catId: m[1] || null, catLabel: m[1] ? (m[2] || '').trim() : '' };
        return { ...base, mode: 'category', path: t.split(/\s*>\s*/).map(x => x.trim()).filter(Boolean) };
    }

    function shopCsv(shop, ctx) {
        const head = ['商品名稱', '規格', '蝦皮商品ID', '蝦皮選項ID', '進價', '售價', '庫存', '成交手續費率', '一般日淨利', '一般日利潤率', '促銷檔期淨利', '促銷檔期利潤率', '備註', '商品分類'];
        const lines = [head.join(',')];
        for (const p of shop.products) {
            for (const v of p.variations) {
                const m = variationMetrics(shop, p, v, ctx);
                const ok = m.hasCost && m.hasRate;
                lines.push([p.name, v.name, p.shopeeItemId || '', v.shopeeVarId || '', m.cost ?? '', m.price, v.stock ?? '', m.rate ?? '',
                    ok ? Math.round(m.regular.profit) : '', ok && m.regular.margin != null ? m.regular.margin.toFixed(1) + '%' : '',
                    ok ? Math.round(m.event.profit) : '', ok && m.event.margin != null ? m.event.margin.toFixed(1) + '%' : '', p.note, feeToCsv(p.fee)].map(csvEscape).join(','));
            }
        }
        return '﻿' + lines.join('\r\n');
    }

    // ---------- CSV 匯入 ----------

    // RFC 4180：支援雙引號、欄內逗號／換行、"" 跳脫；去掉開頭 BOM
    function parseCsvRows(text) {
        const s = String(text || '').replace(/^﻿/, '');
        const rows = [];
        let row = [], cell = '', q = false;
        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            if (q) {
                if (ch === '"') {
                    if (s[i + 1] === '"') { cell += '"'; i++; } else q = false;
                } else cell += ch;
            } else if (ch === '"') q = true;
            else if (ch === ',') { row.push(cell); cell = ''; }
            else if (ch === '\n' || ch === '\r') {
                if (ch === '\r' && s[i + 1] === '\n') i++;
                row.push(cell); rows.push(row); row = []; cell = '';
            } else cell += ch;
        }
        if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
        return rows.filter(r => r.some(c => c.trim() !== ''));
    }

    // 讀「匯出這個賣場的商品（CSV）」的格式（欄位依表頭名稱對應，順序不拘；淨利、利潤率欄會忽略，匯入後重算）
    // 有蝦皮商品 ID 的列依商品 ID 合併成一個多規格的蝦皮商品；沒有的每列是一個自建商品
    // → { products: [...], errors: ['第 N 列：…'] }；errors 不是空的就不該套用
    function productsFromCsv(text) {
        const rows = parseCsvRows(text);
        if (!rows.length) return { products: [], errors: ['檔案是空的'] };
        const head = rows[0].map(h => h.trim());
        const idx = (name) => head.indexOf(name);
        const col = {
            name: idx('商品名稱'), varName: idx('規格'), itemId: idx('蝦皮商品ID'), varId: idx('蝦皮選項ID'),
            cost: idx('進價'), price: idx('售價'), stock: idx('庫存'), rate: idx('成交手續費率'), note: idx('備註'), cat: idx('商品分類'),
        };
        const missing = ['商品名稱', '售價'].filter(n => idx(n) < 0);
        if (missing.length) return { products: [], errors: [`缺少欄位：${missing.join('、')}（第 1 列要是表頭，格式同「匯出這個賣場的商品（CSV）」）`] };

        const errors = [];
        const products = [];
        const byItem = new Map();
        const get = (r, i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : '');
        for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            const line = i + 1;
            const num = (label, raw, { int = false, min = 0, max = Infinity } = {}) => {
                if (raw === '') return null;
                const n = Number(raw.replace(/[,$%\s]/g, ''));
                if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) {
                    errors.push(`第 ${line} 列：${label}「${raw}」不是有效的數字`);
                    return undefined;
                }
                return n;
            };
            const name = cleanName(get(r, col.name));
            if (!name) { errors.push(`第 ${line} 列：商品名稱是空的`); continue; }
            const cost = num('進價', get(r, col.cost));
            const price = num('售價', get(r, col.price), { max: 9999999 });
            const stock = num('庫存', get(r, col.stock), { int: true, max: MAX_STOCK });
            const rate = num('成交手續費率', get(r, col.rate), { max: 100 });
            if ([cost, price, stock, rate].includes(undefined)) continue;
            const itemId = get(r, col.itemId).replace(/\.0+$/, '');
            const varId = get(r, col.varId).replace(/\.0+$/, '');
            const note = get(r, col.note);
            // 有「商品分類」就還原分類（費率由分類決定）；沒有這欄（舊版 CSV）或空白才用成交手續費率欄
            const fee = feeFromCsv(get(r, col.cat)) || (rate != null
                ? { mode: 'manual', catId: null, catLabel: '', path: null, manualRate: rate, needsReview: false }
                : itemId
                    ? { mode: 'auto', catId: null, catLabel: '', path: null, manualRate: null, needsReview: false } // 重新從蝦皮匯入「備貨天數」會補上分類
                    : { mode: 'manual', catId: null, catLabel: '', path: null, manualRate: null, needsReview: false });
            const variation = { id: uid(), shopeeVarId: itemId ? (varId || itemId) : null, name: itemId ? cleanName(get(r, col.varName)) : '', price: price ?? 0, stock, cost: itemId ? cost : null, draft: null };

            if (itemId) {
                let p = byItem.get(itemId);
                if (!p) {
                    p = newProduct({ shopeeItemId: itemId, name, note, fee, variations: [] });
                    byItem.set(itemId, p);
                    products.push(p);
                }
                if (p.variations.some(v => v.shopeeVarId === variation.shopeeVarId)) { errors.push(`第 ${line} 列：蝦皮選項ID ${variation.shopeeVarId} 重複`); continue; }
                p.variations.push(variation);
            } else {
                products.push(newProduct({ name, note, cost, fee, variations: [variation] }));
            }
        }
        if (!products.length && !errors.length) errors.push('檔案裡沒有商品資料');
        return { products, errors };
    }

    const api = {
        STORAGE_KEY, STALE_MS, CATEGORY_ALIASES, DEFAULT_SETTINGS,
        uid, cleanName, emptyState, newShop, newProduct, loadState, saveState, migrateShops, prodInvOf,
        buildFeeIndex, shopeeCategoryPath, matchFeePath, resolveFeePath, resolveRate,
        variationCost, effectivePrice, engineSettings, variationMetrics, variationSummary, deleteVariations, clearShopee, requiredPrice,
        settingsFromQuery, productFromQuery, settingsDiff, quickCalcQuery, productFromSavedConfig, migrateQuickConfigs, migrateQuickConfigsInStorage, QUICK_KEY, QUICK_BACKUP_KEY,
        planImport, applyImportPlan, setDraft, pendingChanges, validateChanges, markExported, isStale, salesDataTime, shopCsv, feeToCsv, feeFromCsv, parseCsvRows, productsFromCsv, MAX_STOCK,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ShopData = api;
})(typeof window !== 'undefined' ? window : globalThis);
