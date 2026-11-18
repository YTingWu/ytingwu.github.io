// 我的賣場：資料層測試（不需安裝套件）。執行：node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'js', 'fee-engine.js'));
const SD = require(path.join(ROOT, 'js', 'shop-data.js'));

const feeIndex = SD.buildFeeIndex(JSON.parse(fs.readFileSync(path.join(ROOT, 'fee-new.json'), 'utf8')));
const cats = JSON.parse(fs.readFileSync(path.join(ROOT, 'shopee-categories.json'), 'utf8')).categories;
const mkCtx = () => ({ state: SD.emptyState(), cats, feeIndex });

test('fee-engine：一般賣家方案一 $999 進價 $300 費率 8.5%', () => {
    const s = { seller: 'general', cost: 300, isCostInc: true, transRate: 8.5, paymentPct: 2.5, cashbackRate: 0, cashbackShort: false, preOrderRate: 0, taxSetting: '0', hasProdInv: false, hasFeeInv: false, frozen: false, first5: false };
    const r = E.computeScenario(999, s, false, false);
    assert.equal(r.transFee, 85);
    assert.equal(r.payFee, 25);
    assert.equal(r.shipFee, 65);
    assert.equal(r.profit, 524);
    assert.equal(E.computeScenario(999, s, true, false).transPct, 12.5); // 促銷檔期 +4%
});

test('分類對應：完全相同、套用上層、別名、控制字元', () => {
    assert.deepEqual(SD.matchFeePath('101391', cats, feeIndex), { path: ['愛好與收藏品', '收藏品', '運動周邊'], how: 'exact' });
    assert.deepEqual(SD.matchFeePath('100244', cats, feeIndex), { path: ['男生衣著', '上衣'], how: 'parent' });
    assert.equal(SD.matchFeePath('102070', cats, feeIndex).how, 'alias');
    assert.equal(SD.matchFeePath('102429', cats, feeIndex).path.join('/'), '汽機車百貨／交通用品/車外裝飾及性能配件/車貼');
    assert.ok(SD.matchFeePath('102525', cats, feeIndex), 'USB藍芽\\x08接收器 要能對到');
    assert.equal(SD.matchFeePath('999999999', cats, feeIndex), null);
});

test('分類對應：全部葉分類對不到的只剩少數', () => {
    const parents = new Set(Object.values(cats).map(c => String(c[0])));
    const leaves = Object.keys(cats).filter(id => !parents.has(id));
    const none = leaves.filter(id => !SD.matchFeePath(id, cats, feeIndex));
    assert.ok(leaves.length > 1900);
    assert.ok(none.length <= 2, `對不到：${none.join(',')}`);
});

// 模擬 parseShopeeXlsx 的輸出
function files(rows) {
    return [
        { type: 'sales', shopId: '123', fileName: 's.xlsx', rows: rows.map(r => ({ productId: r.pid, productName: r.name, variationId: r.vid, variationName: r.vname, price: r.price, stock: r.stock })) },
        { type: 'dts', shopId: '123', fileName: 'd.xlsx', rows: rows.map(r => ({ productId: r.pid, productName: r.name, variationId: r.vid, variationName: r.vname, categoryId: r.cat, categoryLabel: 'x', dts: r.dts })) },
    ];
}
const ROWS = [
    { pid: 'P1', name: '桌曆', vid: 'V1', vname: '球員', price: 999, stock: 4, cat: '101355', dts: '1' },
    { pid: 'P1', name: '桌曆', vid: 'V2', vname: 'PS', price: 999, stock: 4, cat: '101355', dts: '1' },
    { pid: 'P2', name: 'T恤', vid: 'V3', vname: 'L', price: 1050, stock: 0, cat: '100244', dts: '5' },
];

test('蝦皮匯入：新增、去重、保留自填欄位、缺席標示', () => {
    const ctx = mkCtx();
    const shop = SD.newShop('t');
    let plan = SD.planImport(shop, files(ROWS), ctx);
    assert.equal(plan.add.length, 2);
    SD.applyImportPlan(shop, plan, ctx, { salesFileB64: 'AA==' });
    assert.equal(shop.shopeeShopId, '123');
    assert.equal(shop.products.length, 2);
    assert.equal(shop.products[1].preorder, '3');
    assert.equal(SD.resolveRate(shop.products[0], 'general', ctx), 8.5);

    shop.products[0].cost = 300;
    shop.products[0].note = '備註';
    const ids = shop.products.map(p => p.id).join();
    plan = SD.planImport(shop, files(ROWS.slice(0, 2).map(r => ({ ...r, price: 1099 }))), ctx);
    assert.equal(plan.add.length, 0);
    assert.equal(plan.update.length, 1);
    assert.equal(plan.missing.length, 1);
    SD.applyImportPlan(shop, plan, ctx, {});
    assert.equal(shop.products.map(p => p.id).join(), ids);
    assert.equal(shop.products[0].cost, 300);
    assert.equal(shop.products[0].note, '備註');
    assert.equal(shop.products[0].variations[0].price, 1099);
    assert.equal(shop.products[1].missingInLastImport, true);
});

test('蝦皮匯入：只有一份檔案時不新增、不同賣場 ID 擋下或警告', () => {
    const ctx = mkCtx();
    const shop = SD.newShop('t');
    const [sales, dts] = files(ROWS);
    assert.equal(SD.planImport(shop, [sales], ctx).needOther.length, 2);
    assert.equal(SD.planImport(shop, [sales, { ...dts, shopId: '999' }], ctx).errors.length, 1);
    shop.shopeeShopId = '777';
    assert.equal(SD.planImport(shop, [sales, dts], ctx).warnings[0].code, 'shop-mismatch');
});

test('調價草稿：待匯出、檢查規則、匯出後重匯比對', () => {
    const ctx = mkCtx();
    const shop = SD.newShop('t');
    SD.applyImportPlan(shop, SD.planImport(shop, files(ROWS), ctx), ctx, {});
    const [v1, v2] = shop.products[0].variations;
    SD.setDraft(v1, 'price', 1200);
    SD.setDraft(v2, 'stock', 9);
    assert.equal(SD.pendingChanges(shop).length, 2);
    assert.deepEqual(SD.validateChanges(shop, SD.pendingChanges(shop)), []);
    SD.setDraft(v1, 'price', 999); // 改回原價 → 價格草稿清除
    assert.equal(v1.draft, null);

    SD.setDraft(v1, 'price', 6000);
    const probs = SD.validateChanges(shop, SD.pendingChanges(shop)).map(p => p.text);
    assert.ok(probs.some(t => t.includes('5 倍')));
    SD.setDraft(v1, 'price', 1200);

    SD.markExported(SD.pendingChanges(shop));
    assert.equal(SD.pendingChanges(shop).length, 0);
    // 蝦皮已生效（v1 1200），v2 庫存沒生效
    const rows = ROWS.map(r => (r.vid === 'V1' ? { ...r, price: 1200 } : r));
    const plan = SD.planImport(shop, [files(rows)[0]], ctx);
    assert.equal(plan.exportedMatched.length, 1);
    assert.equal(plan.exportedMismatched.length, 1);
    SD.applyImportPlan(shop, plan, ctx, {});
    assert.equal(v1.draft, null);
    assert.equal(v2.draft.status, 'pending');
});

test('快速計算 query：加入賣場與「在快速計算開啟」', () => {
    const q = new URLSearchParams('mode=profit&shipping=ship2&seller=mall&cost=300&costTax=exc&sell=999&fee=8.5&preorder=2&cashback=1.5&cashbackTerm=short&tax=5&hasProdInv=1&hasFeeInv=1&frozen=1&installment=6');
    const st = SD.settingsFromQuery(q);
    assert.deepEqual([st.seller, st.shipPlan, st.cashback, st.cashbackTerm, st.tax, st.hasProdInv, st.hasFeeInv, st.installment], ['mall', 'ship2', '1.5', 'short', '5', true, true, undefined]);
    assert.equal(SD.engineSettings(SD.newShop('t', st), SD.newProduct(), 0, 0).paymentPct, 2.5); // 分期不帶進賣場
    const p = SD.productFromQuery(q, 'x');
    assert.deepEqual([p.cost, p.costTax, p.preorder, p.hasProdInv, p.frozen, p.fee.manualRate, p.variations[0].price], [300, 'exc', '2', null, true, 8.5, 999]);
    const shop = SD.newShop('t', st);
    const back = new URLSearchParams(SD.quickCalcQuery(shop, p, p.variations[0], mkCtx()));
    for (const k of ['shipping', 'seller', 'cost', 'costTax', 'sell', 'fee', 'preorder', 'cashback', 'cashbackTerm', 'tax', 'hasProdInv', 'hasFeeInv', 'frozen']) {
        assert.equal(back.get(k), q.get(k), k);
    }
    assert.equal(back.get('installment'), null);
    assert.deepEqual(SD.settingsDiff(st, SD.DEFAULT_SETTINGS).map(d => d.key).sort(), ['cashback', 'cashbackTerm', 'hasProdInv', 'hasFeeInv', 'seller', 'shipPlan', 'tax'].sort());
});

test('商品進項發票：賣場預設＋商品單獨設定，舊資料轉移', () => {
    const old = (flags) => ({ version: 1, activeShopId: 's', catOverrides: {}, shops: [{ id: 's', settings: { ...SD.DEFAULT_SETTINGS, hasProdInv: undefined }, products: flags.map(f => ({ ...SD.newProduct(), hasProdInv: f })) }] });
    const load = (st) => SD.loadState({ getItem: () => JSON.stringify(st) });
    const a = load(old([false, true]));
    assert.equal(a.shops[0].settings.hasProdInv, false);
    assert.deepEqual(a.shops[0].products.map(p => p.hasProdInv), [null, true]);
    // 已轉移過的資料不再動（商品明確設「無」要保留）
    const b = load({ ...a, shops: [{ ...a.shops[0], settings: { ...a.shops[0].settings, hasProdInv: true }, products: [{ ...SD.newProduct(), hasProdInv: false }] }] });
    assert.equal(b.shops[0].products[0].hasProdInv, false);

    const shop = SD.newShop('t', { tax: '5', hasProdInv: true });
    const p = SD.newProduct();
    assert.equal(p.hasProdInv, null);
    assert.equal(SD.engineSettings(shop, p, 300, 8.5).hasProdInv, true);   // 跟隨賣場
    p.hasProdInv = false;
    assert.equal(SD.engineSettings(shop, p, 300, 8.5).hasProdInv, false);  // 商品覆寫
    assert.equal(new URLSearchParams(SD.quickCalcQuery(shop, p, p.variations[0], mkCtx())).get('hasProdInv'), null);
    p.hasProdInv = null; shop.settings.hasProdInv = false;
    assert.equal(SD.engineSettings(shop, p, 300, 8.5).hasProdInv, false);
});

test('進價：蝦皮商品只看規格進價，自建商品只看商品進價', () => {
    const own = SD.newProduct({ cost: 100 });
    own.variations[0].cost = 999; // 自建商品沒有規格進價的介面，殘留值不採用
    assert.equal(SD.variationCost(own, own.variations[0]), 100);
    const sp = SD.newProduct({ shopeeItemId: '1', cost: 100 });
    assert.equal(SD.variationCost(sp, sp.variations[0]), null); // 不沿用商品進價
    sp.variations[0].cost = 80;
    assert.equal(SD.variationCost(sp, sp.variations[0]), 80);
});

test('規格摘要、刪除規格、一鍵清除', () => {
    const ctx = mkCtx();
    const shop = SD.newShop('t');
    const own = SD.newProduct({ name: 'own', cost: 100, fee: { mode: 'manual', manualRate: 6 } });
    own.variations[0].price = 300;
    const sp = SD.newProduct({ name: 'sp', shopeeItemId: '9', fee: { mode: 'manual', manualRate: 6 } });
    sp.variations = [
        { id: 'a', shopeeVarId: 'A', name: 'A', price: 100, stock: 1, cost: 200, draft: null }, // 虧本
        { id: 'b', shopeeVarId: 'B', name: 'B', price: 500, stock: 1, cost: 100, draft: null },
        { id: 'c', shopeeVarId: 'C', name: 'C', price: 500, stock: 1, cost: null, draft: null }, // 待補進價
    ];
    shop.products = [own, sp];
    shop.shopeeShopId = '123';
    shop.salesFile = { b64: 'AA==' };
    const sum = SD.variationSummary(shop, [sp], ctx);
    assert.deepEqual([sum.products, sum.variations, sum.loss, sum.incomplete], [1, 3, 1, 1]);
    assert.equal(SD.variationSummary(shop, [own], ctx).variations, 1);

    assert.deepEqual(SD.deleteVariations(shop, ['a']), { variations: 1, products: 0 });
    assert.deepEqual(sp.variations.map(v => v.id), ['b', 'c']);
    assert.deepEqual(SD.deleteVariations(shop, ['b', 'c']), { variations: 2, products: 1 });
    assert.deepEqual(shop.products.map(p => p.name), ['own']);

    shop.products.push(sp);
    assert.equal(SD.clearShopee(shop), 1);
    assert.deepEqual(shop.products.map(p => p.name), ['own']);
    assert.deepEqual([shop.salesFile, shop.shopeeShopId], [null, null]);
});

test('快速計算已存設定搬進賣場：只搬新制、沒有賣場就建、存檔失敗不動', () => {
    const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m }; };
    const cfgs = [
        { id: 2, title: 'B', rates: 'new', data: { seller: 'mall', tax: '5', cost: '200', sell: '500', fee: '7.5' }, summary: '' },
        { id: 1, title: '舊', rates: 'current', data: { cost: '100', sell: '300', fee: '6' }, summary: '' },
        { id: 0, title: 'A', rates: 'new', data: { cost: '50', sell: '199', fee: '6' }, summary: '' },
    ];
    const st = mem();
    st.setItem(SD.QUICK_KEY, JSON.stringify(cfgs));
    const r = SD.migrateQuickConfigsInStorage(st);
    assert.equal(r.moved, 2);
    const state = SD.loadState(st);
    assert.equal(state.shops.length, 1);
    assert.equal(state.shops[0].settings.seller, 'mall'); // 用第一筆的設定建賣場
    assert.deepEqual(state.shops[0].products.map(p => [p.name, p.cost, p.variations[0].price, p.fee.manualRate, p.fee.needsReview]), [['B', 200, 500, 7.5, false], ['A', 50, 199, 6, false]]);
    assert.deepEqual(JSON.parse(st.getItem(SD.QUICK_KEY)).map(c => c.title), ['舊']);
    assert.equal(SD.migrateQuickConfigsInStorage(st).moved, 0); // 再跑一次不重複

    // 已有賣場：放第一個，加在原有商品前面
    const st2 = mem();
    const s0 = SD.newShop('原本'); s0.products.push(SD.newProduct({ name: '舊商品' }));
    const e = SD.emptyState(); e.shops.push(SD.newShop('第一')); e.shops[0].products.push(SD.newProduct({ name: 'x' })); e.shops.push(s0);
    SD.saveState(st2, e);
    st2.setItem(SD.QUICK_KEY, JSON.stringify(cfgs));
    SD.migrateQuickConfigsInStorage(st2);
    assert.deepEqual(SD.loadState(st2).shops[0].products.map(p => p.name), ['B', 'A', 'x']);

    // 存檔失敗：清單不變
    const st3 = mem();
    st3.setItem(SD.QUICK_KEY, JSON.stringify(cfgs));
    const orig = st3.setItem;
    st3.setItem = (k, v) => { if (k === SD.STORAGE_KEY) throw new Error('quota'); orig(k, v); };
    assert.equal(SD.migrateQuickConfigsInStorage(st3).moved, 0);
    assert.equal(JSON.parse(st3.getItem(SD.QUICK_KEY)).length, 3);
});

test('搬遷防呆：備份、壞資料、欄位缺漏、另一分頁已搬', () => {
    const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
    const cfgs = [{ id: 1, title: 5, rates: 'new', data: { cost: '50', sell: '199', fee: '6' } }];

    // 備份：搬走的原始設定留一份
    const a = mem();
    a.setItem(SD.QUICK_KEY, JSON.stringify(cfgs));
    SD.migrateQuickConfigsInStorage(a);
    const bk = JSON.parse(a.getItem(SD.QUICK_BACKUP_KEY));
    assert.equal(bk.length, 1);
    assert.equal(bk[0].id, 1);
    assert.equal(SD.loadState(a).shops[0].products[0].name, '5'); // 數字標題轉成字串

    // 賣場資料壞掉：不搬、不覆蓋
    const b = mem();
    b.setItem(SD.STORAGE_KEY, '{bad');
    b.setItem(SD.QUICK_KEY, JSON.stringify(cfgs));
    assert.equal(SD.migrateQuickConfigsInStorage(b).moved, 0);
    assert.equal(b.getItem(SD.STORAGE_KEY), '{bad');
    assert.equal(JSON.parse(b.getItem(SD.QUICK_KEY)).length, 1);

    // 賣場缺 products／settings：補齊後照常搬
    const c = mem();
    c.setItem(SD.STORAGE_KEY, JSON.stringify({ shops: [{ id: 'x', name: 'x' }] }));
    c.setItem(SD.QUICK_KEY, JSON.stringify(cfgs));
    assert.equal(SD.migrateQuickConfigsInStorage(c).moved, 1);
    assert.equal(SD.loadState(c).shops[0].products.length, 1);

    // 讀完後清單被另一個分頁改掉：不搬
    const d = mem();
    d.setItem(SD.QUICK_KEY, JSON.stringify(cfgs));
    const realGet = d.getItem;
    let n = 0;
    d.getItem = k => { if (k === SD.QUICK_KEY && ++n > 1) return '[]'; return realGet(k); };
    assert.equal(SD.migrateQuickConfigsInStorage(d).moved, 0);
    assert.equal(realGet(SD.STORAGE_KEY), null);
});

test('快速計算選的類別：存成依類別費率，帶回快速計算時保留類別', () => {
    const ctx = mkCtx();
    const leaf = ctx.feeIndex.list.find(l => l.path.length >= 3);
    const q = new URLSearchParams({ cost: '100', sell: '300', fee: String(leaf.general), cat: leaf.path.join(' > ') });
    const p = SD.productFromQuery(q, '有類別');
    assert.equal(p.fee.mode, 'category');
    assert.deepEqual(p.fee.path, leaf.path);
    const shop = SD.newShop('t', { seller: 'mall' });
    assert.equal(SD.resolveRate(p, 'mall', ctx), leaf.mall); // 依賣場類型取費率
    const back = new URLSearchParams(SD.quickCalcQuery(shop, p, p.variations[0], ctx));
    assert.equal(back.get('cat'), leaf.path.join(' > '));
    assert.equal(back.get('fee'), String(leaf.mall));
    // 沒有 cat：手動費率，帶回去也沒有 cat
    const m = SD.productFromQuery(new URLSearchParams({ fee: '6' }), '手動');
    assert.equal(m.fee.mode, 'manual');
    assert.equal(new URLSearchParams(SD.quickCalcQuery(shop, m, m.variations[0], ctx)).get('cat'), null);
});
