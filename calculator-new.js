// calculator-new.js — 2026/12/11 起新制費率（蝦皮公告 28668 / 28804 / 28149 / 28779）
// 舊制（至 2026/12/10）請見 calculator.js。12/11 之後合併回首頁。

const RATES = {
    payment: 0.025,              // 金流與系統處理費（未調整；信用卡分期另計，見 INSTALLMENT_PAYMENT_PCT）
    shipRate: 0.065,             // 免運活動服務費：方案一、或任一方案 ≤$99 的訂單
    shipTierMax: 99,             // ≤$99 一律按比例
    ship2Fixed: 65,              // 方案二 ≥$100 每單固定
    frozenFixed: 80,             // 冷凍訂單 ≥$100 每單固定（推廣優惠至 2027/12/31）
    eventSurcharge: { general: 4, mall: 5, shop: 0 }, // 促銷檔期加收（%）
    generalCap: 35000,           // 非商城單件成交手續費計算上限
    agentFee: 2.5                // 蝦皮代開發票每張
};

// 12/10 前（現行）費率，只用於總覽表格括號內的比較（與 calculator.js 一致）
const OLD_RATES = {
    shipRate: 0.06,              // 方案一、或方案二 ≤$99
    ship2Fixed: 60,              // 方案二 ≥$100 每單固定
    eventSurcharge: { general: 2, mall: 3 }, // 促銷檔期加收（參加任一蝦幣回饋即免收）
    preOrder: 3                  // 舊制預購只有 3%
};
// 由「查詢」選的類別對應到的 12/10 前成交手續費率；null＝與目前輸入的費率相同（手動輸入或查無對應類別）
let oldTransRate = null;
function setOldTransRate(v) {
    const n = parseFloat(v);
    oldTransRate = Number.isFinite(n) ? n : null;
    onChange();
}
window.setOldTransRate = setOldTransRate;

// Get all input elements
const costPriceInput = document.getElementById('costPrice');
const costTaxTypeInput = document.getElementById('costTaxType');
const costTaxLabel = document.getElementById('costTaxLabel');
const costTaxSuffix = document.getElementById('costTaxSuffix');
const sellPriceInput = document.getElementById('sellPrice');
const profitMarginInput = document.getElementById('profitMargin');
const transactionFeeInput = document.getElementById('transactionFee');
const frozenOrderInput = document.getElementById('frozenOrder');
const shopFirstFiveInput = document.getElementById('shopFirstFive');

const sellPriceContainer = document.getElementById('sellPriceContainer');
const profitMarginContainer = document.getElementById('profitMarginContainer');
const modeRadios = document.querySelectorAll('input[name="calcMode"]');
const shippingOptionRadios = document.querySelectorAll('input[name="shippingOption"]');
const sellerTypeRadios = document.querySelectorAll('input[name="sellerType"]');
const suggestedPriceRows = document.querySelectorAll('.suggested-price-row');
const sellPriceRows = document.querySelectorAll('.sell-price-row');

// Tax Options
const inputTaxOptions = document.getElementById('inputTaxOptions');
const hasProductInvoiceInput = document.getElementById('hasProductInvoice');
const hasFeeInvoiceInput = document.getElementById('hasFeeInvoice');

// Floating Header Elements
const floatSellContainer = document.getElementById('floatSellContainer');
const floatMarginContainer = document.getElementById('floatMarginContainer');
const suggestedPriceColumns = document.querySelectorAll('.suggested-price-column');
const sellPriceColumns = document.querySelectorAll('.sell-price-column');

// Radio Groups
const cashbackRadios = document.querySelectorAll('input[name="cashbackProgram"]');
const cashbackTermRadios = document.querySelectorAll('input[name="cashbackTerm"]');
const taxRadios = document.querySelectorAll('input[name="taxSetting"]');
const preOrderRadios = document.querySelectorAll('input[name="preOrder"]');

// 信用卡分期：金流與系統處理費率（%），2026/01/01 起，新舊制相同
const INSTALLMENT_PAYMENT_PCT = { '0': 2.5, '3': 2.5, '6': 3, '12': 3.5, '24': 5 };
const installmentRadios = document.querySelectorAll('input[name="installment"]');
function getInstallment() {
    let v = '0';
    installmentRadios.forEach(r => { if (r.checked) v = r.value; });
    return INSTALLMENT_PAYMENT_PCT[v] !== undefined ? v : '0';
}
function getPaymentPct() { return INSTALLMENT_PAYMENT_PCT[getInstallment()]; }
function paymentLabel() {
    const v = getInstallment();
    return v === '0' ? `金流處理費 (${getPaymentPct()}%)` : `金流處理費 (分期 ${v} 期 ${getPaymentPct()}%)`;
}
function setInstallmentFromParam(v) {
    const el = document.getElementById('installment' + (INSTALLMENT_PAYMENT_PCT[v] !== undefined ? v : '0'));
    if (el) el.checked = true;
}

const SCENARIOS = [
    { key: 'regular-ship1', isEvent: false, isShip2: false },
    { key: 'regular-ship2', isEvent: false, isShip2: true },
    { key: 'event-ship1', isEvent: true, isShip2: false },
    { key: 'event-ship2', isEvent: true, isShip2: true }
];

let currentMode = 'profit';
let currentShippingOption = 'both';
let currentSellerType = 'general';

function formatCurrency(amount) {
    return '$ ' + Math.round(amount).toLocaleString('zh-TW');
}

function checkedValue(radios, fallback) {
    let v = fallback;
    radios.forEach(r => { if (r.checked) v = r.value; });
    return v;
}

// URL Management
function getQueryParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        mode: params.get('mode') || 'profit',
        shipping: params.get('shipping') || 'both',
        seller: params.get('seller') || 'general',
        cost: params.get('cost') || '',
        sell: params.get('sell') || '',
        margin: params.get('margin') || '5',
        fee: params.get('fee') || '6',
        preorder: params.get('preorder') || '0',
        installment: params.get('installment') || '0',
        cashback: params.get('cashback') || '0',
        cashbackTerm: params.get('cashbackTerm') || 'long',
        tax: params.get('tax') || '0',
        costTax: params.get('costTax') || 'inc',
        hasProdInv: params.get('hasProdInv') === '1',
        hasFeeInv: params.get('hasFeeInv') === '1',
        frozen: params.get('frozen') === '1',
        first5: params.get('first5') === '1',
        oldFee: params.get('oldFee')
    };
}

function updateQueryString() {
    const params = new URLSearchParams();
    params.set('mode', currentMode);
    params.set('shipping', currentShippingOption);
    params.set('seller', currentSellerType);
    if (costPriceInput.value) params.set('cost', costPriceInput.value);
    params.set('costTax', costTaxTypeInput.checked ? 'inc' : 'exc');

    if (currentMode === 'profit' && sellPriceInput.value) {
        params.set('sell', sellPriceInput.value);
    } else if (currentMode === 'price' && profitMarginInput.value) {
        params.set('margin', profitMarginInput.value);
    }

    if (transactionFeeInput.value) params.set('fee', transactionFeeInput.value);
    if (oldTransRate !== null) params.set('oldFee', String(oldTransRate));
    params.set('preorder', checkedValue(preOrderRadios, '0'));
    if (getInstallment() !== '0') params.set('installment', getInstallment());

    const cashbackValue = checkedValue(cashbackRadios, '0');
    params.set('cashback', cashbackValue);
    if (cashbackValue !== '0') params.set('cashbackTerm', checkedValue(cashbackTermRadios, 'long'));

    const taxValue = checkedValue(taxRadios, '0');
    params.set('tax', taxValue);
    if (taxValue === '5' || taxValue === '5_plus') {
        if (hasProductInvoiceInput.checked) params.set('hasProdInv', '1');
        if (hasFeeInvoiceInput.checked) params.set('hasFeeInv', '1');
    }

    if (frozenOrderInput.checked) params.set('frozen', '1');
    if (shopFirstFiveInput.checked) params.set('first5', '1');

    window.history.replaceState({}, '', window.location.pathname + '?' + params.toString());
}

function loadFromQueryString() {
    const params = getQueryParams();

    currentMode = params.mode === 'price' ? 'price' : 'profit';
    document.getElementById(currentMode === 'profit' ? 'modeProfit' : 'modePrice').checked = true;

    currentShippingOption = params.shipping;
    if (params.shipping === 'ship1') document.getElementById('shipOne').checked = true;
    else if (params.shipping === 'ship2') document.getElementById('shipTwo').checked = true;
    else { currentShippingOption = 'both'; document.getElementById('shipBoth').checked = true; }

    currentSellerType = ['general', 'mall', 'shop'].includes(params.seller) ? params.seller : 'general';
    document.getElementById({ general: 'sellerGeneral', mall: 'sellerMall', shop: 'sellerShop' }[currentSellerType]).checked = true;

    if (params.cost) costPriceInput.value = params.cost;

    const isInc = params.costTax !== 'exc';
    costTaxTypeInput.checked = isInc;
    costTaxLabel.textContent = isInc ? '含稅' : '未稅';
    costTaxSuffix.textContent = isInc ? '(含稅)' : '(未稅)';

    if (params.sell) sellPriceInput.value = params.sell;
    if (params.margin) profitMarginInput.value = params.margin;
    if (params.fee) transactionFeeInput.value = params.fee;
    const oldFee = parseFloat(params.oldFee);
    oldTransRate = Number.isFinite(oldFee) ? oldFee : null;

    setInstallmentFromParam(params.installment);
    if (params.preorder === '3') document.getElementById('isPreOrder').checked = true;
    else if (params.preorder === '2') document.getElementById('preOrder2').checked = true;
    else document.getElementById('noPreOrder').checked = true;

    if (params.cashback === '1.5') document.getElementById('cashback5').checked = true;
    else if (params.cashback === '2.5') document.getElementById('cashback10').checked = true;
    else document.getElementById('noCashback').checked = true;
    document.getElementById(params.cashbackTerm === 'short' ? 'cashbackShort' : 'cashbackLong').checked = true;

    if (params.tax === '1') document.getElementById('businessTax').checked = true;
    else if (params.tax === '5') document.getElementById('invoiceTax').checked = true;
    else if (params.tax === '5_plus') document.getElementById('shopeeInvoice').checked = true;
    else document.getElementById('noTax').checked = true;

    hasProductInvoiceInput.checked = params.hasProdInv;
    hasFeeInvoiceInput.checked = params.hasFeeInv;
    frozenOrderInput.checked = params.frozen;
    shopFirstFiveInput.checked = params.first5;

    updateTaxOptionsVisibility();
    updateCashbackTermVisibility();
}

function updateTaxOptionsVisibility() {
    const taxVal = checkedValue(taxRadios, '0');
    inputTaxOptions.style.display = (taxVal === '5' || taxVal === '5_plus') ? 'block' : 'none';
}

function updateCashbackTermVisibility() {
    const el = document.getElementById('cashbackTermOptions');
    if (el) el.style.display = checkedValue(cashbackRadios, '0') === '0' ? 'none' : '';
}

function onChange() {
    calculateFees();
    updateQueryString();
}

// Event Listeners
modeRadios.forEach(r => r.addEventListener('change', (e) => {
    currentMode = e.target.value;
    updateModeUI();
    onChange();
}));
shippingOptionRadios.forEach(r => r.addEventListener('change', (e) => {
    currentShippingOption = e.target.value;
    updateLayoutUI();
    updateQueryString();
}));
sellerTypeRadios.forEach(r => r.addEventListener('change', (e) => {
    currentSellerType = e.target.value;
    updateLayoutUI();
    onChange();
}));
taxRadios.forEach(r => r.addEventListener('change', () => {
    updateTaxOptionsVisibility();
    onChange();
}));
cashbackRadios.forEach(r => r.addEventListener('change', () => {
    updateCashbackTermVisibility();
    onChange();
}));
[...cashbackTermRadios, ...preOrderRadios, ...installmentRadios].forEach(r => r.addEventListener('change', onChange));
[hasProductInvoiceInput, hasFeeInvoiceInput, frozenOrderInput, shopFirstFiveInput].forEach(el => el.addEventListener('change', onChange));
// 使用者自己改成交手續費率 → 不再沿用「查詢」對應的舊費率（「查詢」帶入時送出的事件 isTrusted 為 false）
// 必須在 onChange 之前註冊，計算時才會用到清除後的值
transactionFeeInput.addEventListener('input', (e) => { if (e.isTrusted) oldTransRate = null; });
[costPriceInput, sellPriceInput, profitMarginInput, transactionFeeInput].forEach(el => el.addEventListener('input', onChange));
costTaxTypeInput.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    costTaxLabel.textContent = isChecked ? '含稅' : '未稅';
    costTaxSuffix.textContent = isChecked ? '(含稅)' : '(未稅)';
    onChange();
});

function updateModeUI() {
    const isProfit = currentMode === 'profit';
    sellPriceContainer.style.display = isProfit ? '' : 'none';
    profitMarginContainer.style.display = isProfit ? 'none' : '';
    suggestedPriceRows.forEach(row => row.style.display = isProfit ? 'none' : '');
    sellPriceRows.forEach(row => row.style.display = isProfit ? '' : 'none');
    floatSellContainer.style.display = isProfit ? '' : 'none';
    floatMarginContainer.style.display = isProfit ? 'none' : '';
    suggestedPriceColumns.forEach(col => col.style.display = isProfit ? 'none' : '');
    sellPriceColumns.forEach(col => col.style.display = isProfit ? '' : 'none');
}

// 依賣場類型與免運方案決定要顯示哪些情境與設定
function updateLayoutUI() {
    const isShop = currentSellerType === 'shop';
    const show = {
        'regular-ship1': isShop || currentShippingOption !== 'ship2',
        'regular-ship2': !isShop && currentShippingOption !== 'ship1',
        'event-ship1': !isShop && currentShippingOption !== 'ship2',
        'event-ship2': !isShop && currentShippingOption !== 'ship1'
    };
    SCENARIOS.forEach(({ key }) => {
        const card = document.getElementById(`card-${key}`);
        if (card) card.style.display = show[key] ? '' : 'none';
        const row = document.getElementById(`summary-row-${key}`);
        if (row) row.style.display = show[key] ? '' : 'none';
    });

    // 蝦皮小舖：不能參加免運專案、免收促銷檔期與預購服務費
    document.querySelectorAll('.not-for-shop').forEach(el => el.style.display = isShop ? 'none' : '');
    document.querySelectorAll('.only-for-shop').forEach(el => el.style.display = isShop ? '' : 'none');
}

function getSettings() {
    const seller = currentSellerType;
    const isShop = seller === 'shop';
    const cashbackValue = checkedValue(cashbackRadios, '0');
    return {
        seller,
        cost: parseFloat(costPriceInput.value) || 0,
        isCostInc: costTaxTypeInput.checked,
        transRate: parseFloat(transactionFeeInput.value) || 0,
        paymentPct: getPaymentPct(),
        // 蝦皮小舖不提供蝦幣回饋／免運／預購相關設定，一律不計
        cashbackRate: isShop ? 0 : parseFloat(cashbackValue),
        cashbackShort: checkedValue(cashbackTermRadios, 'long') === 'short',
        preOrderRate: isShop ? 0 : parseFloat(checkedValue(preOrderRadios, '0')),
        taxSetting: checkedValue(taxRadios, '0'),
        hasProdInv: hasProductInvoiceInput.checked,
        hasFeeInv: hasFeeInvoiceInput.checked,
        frozen: !isShop && frozenOrderInput.checked,
        first5: isShop && shopFirstFiveInput.checked
    };
}

// 成交手續費率（%）：基本費率＋促銷檔期加收
// 促銷檔期：未參加蝦幣回饋、或只參加「短期」蝦幣回饋 → 加收；參加「長期」→ 免收；蝦皮小舖一律免收
function effectiveTransRate(s, isEvent) {
    if (s.seller === 'shop' && s.first5) return 0;
    const surcharged = isEvent && (s.cashbackRate === 0 || s.cashbackShort);
    return s.transRate + (surcharged ? RATES.eventSurcharge[s.seller] : 0);
}

// 免運活動服務費：≤$99 一律 6.5%；≥$100 冷凍 $80、方案二 $65、方案一 6.5%
function shippingFee(price, s, isShip2) {
    if (s.seller === 'shop') return { fee: 0, label: '' };
    if (price <= RATES.shipTierMax) return { fee: Math.round(price * RATES.shipRate), label: '免運活動服務費 (6.5%)' };
    if (s.frozen) return { fee: RATES.frozenFixed, label: '冷凍訂單活動服務費 (+80元)' };
    if (isShip2) return { fee: RATES.ship2Fixed, label: '免運活動服務費 (+65元)' };
    return { fee: Math.round(price * RATES.shipRate), label: '免運活動服務費 (6.5%)' };
}

// 計算單一情境（每項費用各自四捨五入後相加，與蝦皮說明一致）
function computeScenario(price, s, isEvent, isShip2) {
    const isMall = s.seller === 'mall';
    const transPct = effectiveTransRate(s, isEvent);
    const transBase = isMall ? price : Math.min(price, RATES.generalCap);
    const transFee = Math.round(transBase * transPct / 100);
    const payFee = Math.round(price * s.paymentPct / 100);
    const ship = shippingFee(price, s, isShip2);
    const cashFee = Math.round(price * s.cashbackRate / 100);
    const preFee = Math.round(price * s.preOrderRate / 100);
    const totalShopeeFee = transFee + payFee + ship.fee + cashFee + preFee;

    return { transPct, transFee, payFee, shipFee: ship.fee, shipLabel: ship.label, cashFee, preFee, totalShopeeFee,
        ...taxAndProfit(price, s, totalShopeeFee) };
}

// 同樣條件套 12/10 前（現行）規則：促銷檔期 +2%/+3%（參加任一蝦幣回饋即免收）、
// 免運 6%／方案二 ≥$100 $60、冷凍 ≥$100 $80、預購一律 3%
function computeOldScenario(price, s, isEvent, isShip2) {
    const isMall = s.seller === 'mall';
    const base = oldTransRate !== null ? oldTransRate : s.transRate;
    const transPct = base + ((isEvent && s.cashbackRate === 0) ? OLD_RATES.eventSurcharge[isMall ? 'mall' : 'general'] : 0);
    const transFee = Math.round((isMall ? price : Math.min(price, RATES.generalCap)) * transPct / 100);
    const payFee = Math.round(price * s.paymentPct / 100);
    const shipFee = price <= RATES.shipTierMax ? Math.round(price * OLD_RATES.shipRate)
        : s.frozen ? RATES.frozenFixed
        : isShip2 ? OLD_RATES.ship2Fixed
        : Math.round(price * OLD_RATES.shipRate);
    const cashFee = Math.round(price * s.cashbackRate / 100);
    const preFee = s.preOrderRate > 0 ? Math.round(price * OLD_RATES.preOrder / 100) : 0;
    const totalShopeeFee = transFee + payFee + shipFee + cashFee + preFee;
    return { totalShopeeFee, ...taxAndProfit(price, s, totalShopeeFee) };
}

// 稅金與獲利（新舊制相同）
function taxAndProfit(price, s, totalShopeeFee) {
    const isInvoice = s.taxSetting === '5' || s.taxSetting === '5_plus';
    let outputTax = 0;
    if (s.taxSetting === '1') outputTax = Math.round(price * 0.01);
    else if (isInvoice) outputTax = Math.round(price / 1.05 * 0.05);

    const inputTax = (s.hasProdInv && isInvoice)
        ? (s.isCostInc ? Math.round(s.cost / 1.05 * 0.05) : Math.round(s.cost * 0.05))
        : 0;
    const feeInputTax = (s.hasFeeInv && isInvoice) ? Math.round(totalShopeeFee / 1.05 * 0.05) : 0;
    const payableTax = s.taxSetting !== '0' ? Math.max(0, outputTax - inputTax - feeInputTax) : 0;
    const agentFee = s.taxSetting === '5_plus' ? RATES.agentFee : 0;

    const totalDeduction = totalShopeeFee + payableTax + agentFee;
    const cashOutCost = s.isCostInc ? s.cost : s.cost * 1.05;
    const profit = price - cashOutCost - totalDeduction;

    return { outputTax, inputTax, feeInputTax, payableTax, agentFee, totalDeduction, profit };
}

// 用獲利率反推售價：找出「獲利率 ≥ 目標」的最低整數售價。
// 免運服務費在 $99／$100 之間有級距，兩段各自單調，分段二分搜尋後取較低者。
function calculateRequiredPrice(s, marginPercent, isEvent, isShip2) {
    if (s.cost <= 0) return 0;
    const target = marginPercent / 100;
    const ok = (p) => computeScenario(p, s, isEvent, isShip2).profit >= p * target;
    const lowestIn = (lo, hi) => {
        if (!ok(hi)) return null;
        const floor = lo;
        while (lo < hi) {
            const mid = Math.floor((lo + hi) / 2);
            if (ok(mid)) hi = mid; else lo = mid + 1;
        }
        // 各項費用四捨五入會讓獲利在臨界點附近上下跳動幾元，往下再掃一段找更低的可行售價
        let best = lo;
        for (let q = lo - 1; q >= Math.max(floor, lo - 50); q--) if (ok(q)) best = q;
        return best;
    };
    const low = lowestIn(1, RATES.shipTierMax);
    if (low !== null) return low;
    return lowestIn(RATES.shipTierMax + 1, 100000000) || 0;
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function percentOf(part, whole) {
    return whole > 0 ? `(${(part / whole * 100).toFixed(1)}%)` : '(0%)';
}

function scenarioTitle(key, s) {
    if (s.seller === 'shop') return '<i class="bi bi-bag-heart"></i> 蝦皮小舖';
    const isEvent = key.startsWith('event');
    const isShip2 = key.endsWith('ship2');
    const icon = isEvent ? 'bi-star-fill' : 'bi-calendar-check';
    const day = isEvent ? '促銷檔期' : '一般日';
    const plan = s.frozen ? (isShip2 ? '免運方案二（冷凍）' : '免運方案一（冷凍）') : (isShip2 ? '免運方案二' : '免運方案一 (6.5%)');
    return `<i class="bi ${icon}"></i> ${day} + ${plan}`;
}

function calculateFees() {
    const s = getSettings();

    const prices = {};
    if (currentMode === 'profit') {
        const p = parseFloat(sellPriceInput.value) || 0;
        SCENARIOS.forEach(({ key }) => {
            prices[key] = p;
            setText(`${key}-sell-price`, formatCurrency(p));
            setText(`summary-${key}-sell`, formatCurrency(p));
        });
    } else {
        const margin = parseFloat(profitMarginInput.value) || 0;
        SCENARIOS.forEach(({ key, isEvent, isShip2 }) => {
            prices[key] = calculateRequiredPrice(s, margin, isEvent, isShip2);
            setText(`${key}-suggested-price`, formatCurrency(prices[key]));
            setText(`summary-${key}-suggested`, formatCurrency(prices[key]));
        });
    }

    SCENARIOS.forEach(({ key, isEvent, isShip2 }) => renderScenario(key, prices[key], s, isEvent, isShip2));
    renderOldCompareNote(s);

    // Floating Header
    const cashOutCost = s.isCostInc ? s.cost : s.cost * 1.05;
    setText('floatCost', formatCurrency(cashOutCost));
    if (currentMode === 'profit') setText('floatSell', formatCurrency(prices['regular-ship1']));
    else setText('floatMargin', profitMarginInput.value + '%');

    const floatPre = document.getElementById('floatPreOrder');
    floatPre.textContent = s.preOrderRate === 2 ? '2天' : (s.preOrderRate === 3 ? '3天以上' : '否');
    floatPre.className = s.preOrderRate > 0 ? 'badge bg-warning text-dark' : 'badge bg-secondary';

    const floatCash = document.getElementById('floatCashback');
    const cashName = s.cashbackRate === 1.5 ? '5%' : (s.cashbackRate === 2.5 ? '10%' : '');
    floatCash.textContent = cashName ? `${cashName}${s.cashbackShort ? '（短期）' : '（長期）'}` : '不參加';
    floatCash.className = s.cashbackRate > 0 ? 'badge bg-warning text-dark' : 'badge bg-secondary';
}

function renderScenario(prefix, price, s, isEvent, isShip2) {
    const r = computeScenario(price, s, isEvent, isShip2);

    const titleEl = document.getElementById(`${prefix}-title`);
    if (titleEl) titleEl.innerHTML = scenarioTitle(prefix, s);
    const summaryLabel = document.getElementById(`summary-${prefix}-label`);
    if (summaryLabel && prefix === 'regular-ship1') {
        summaryLabel.textContent = s.seller === 'shop' ? '蝦皮小舖' : (s.frozen ? '免運方案一（冷凍）' : '免運方案一');
    } else if (summaryLabel) {
        summaryLabel.textContent = (isShip2 ? '免運方案二' : '免運方案一') + (s.frozen ? '（冷凍）' : '');
    }

    // Group 1: Shopee fees
    setText(`${prefix}-transaction-label`, (s.seller === 'shop' && s.first5) ? '成交手續費（本月前 5 筆免收）' : `成交手續費 (${r.transPct}%)`);
    setText(`${prefix}-transaction`, formatCurrency(r.transFee));
    setText(`${prefix}-payment`, formatCurrency(r.payFee));
    setText(`${prefix}-payment-label`, paymentLabel());

    const rowShip = document.getElementById(`${prefix}-shipping-row`);
    if (rowShip) rowShip.style.display = s.seller === 'shop' ? 'none' : '';
    setText(`${prefix}-shipping-label`, r.shipLabel);
    setText(`${prefix}-shipping`, formatCurrency(r.shipFee));

    const rowPre = document.getElementById(`${prefix}-preorder-row`);
    if (s.preOrderRate > 0) {
        rowPre.style.display = '';
        setText(`${prefix}-preorder-label`, `預購訂單服務費 (${s.preOrderRate}%)`);
        setText(`${prefix}-preorder`, formatCurrency(r.preFee));
    } else rowPre.style.display = 'none';

    const rowCash = document.getElementById(`${prefix}-cashback-row`);
    if (s.cashbackRate > 0) { rowCash.style.display = ''; setText(`${prefix}-cashback`, formatCurrency(r.cashFee)); }
    else rowCash.style.display = 'none';

    setText(`${prefix}-shopee-total`, formatCurrency(r.totalShopeeFee));
    setText(`${prefix}-shopee-percent`, percentOf(r.totalShopeeFee, price));

    // Group 2: Tax
    setText(`${prefix}-payable-tax`, formatCurrency(r.payableTax));
    setText(`${prefix}-tax-percent`, percentOf(r.payableTax, price));

    const isInvoice = s.taxSetting === '5' || s.taxSetting === '5_plus';
    const groupTax = document.getElementById(`collapse-${prefix}-tax`).closest('.fee-group');
    if (s.taxSetting === '0') {
        groupTax.style.display = 'none';
    } else {
        groupTax.style.display = '';
        setText(`${prefix}-output-tax`, formatCurrency(r.outputTax));
        const rowIn = document.getElementById(`${prefix}-input-tax-row`);
        if (s.hasProdInv && isInvoice) { rowIn.style.display = ''; setText(`${prefix}-input-tax`, '- ' + formatCurrency(r.inputTax)); }
        else rowIn.style.display = 'none';
        const rowFeeIn = document.getElementById(`${prefix}-fee-input-tax-row`);
        if (s.hasFeeInv && isInvoice) { rowFeeIn.style.display = ''; setText(`${prefix}-fee-input-tax`, '- ' + formatCurrency(r.feeInputTax)); }
        else rowFeeIn.style.display = 'none';
    }

    const rowAgent = document.getElementById(`${prefix}-agent-fee-row`);
    if (s.taxSetting === '5_plus') { rowAgent.style.display = ''; setText(`${prefix}-agent-fee`, formatCurrency(r.agentFee)); }
    else rowAgent.style.display = 'none';

    // Total deduction
    setText(`${prefix}-deduction`, formatCurrency(r.totalDeduction));
    setText(`${prefix}-deduction-percent`, percentOf(r.totalDeduction, price));
    document.getElementById(`${prefix}-deduction`).closest('.deduction-row').style.display = s.taxSetting === '0' ? 'none' : 'flex';

    // Profit
    setText(`${prefix}-profit`, formatCurrency(r.profit));
    document.getElementById(`${prefix}-profit-row`).classList.toggle('negative', r.profit < 0);

    // Summary（括號內為 12/10 前規則的試算；蝦皮小舖是新類型，沒有可比較的舊制）
    const old = (s.seller !== 'shop' && price > 0) ? computeOldScenario(price, s, isEvent, isShip2) : null;

    setSummaryCell(`summary-${prefix}-total`, formatCurrency(r.totalDeduction), old && formatCurrency(old.totalDeduction));
    const profitEl = document.getElementById(`summary-${prefix}-profit`);
    setSummaryCell(profitEl.id, formatCurrency(r.profit), old && formatCurrency(old.profit));
    profitEl.className = r.profit < 0 ? 'fw-bold text-danger text-nowrap' : 'fw-bold text-success text-nowrap';

    const marginEl = document.getElementById(`summary-${prefix}-margin`);
    if (price > 0) {
        const m = (r.profit / price) * 100;
        setSummaryCell(marginEl.id, m.toFixed(1) + '%', old && ((old.profit / price) * 100).toFixed(1) + '%');
        marginEl.className = m < 0 ? 'text-danger text-nowrap' : 'text-success text-nowrap';
    } else {
        setSummaryCell(marginEl.id, '0%', null);
        marginEl.className = 'text-muted text-nowrap';
    }
}

// 總覽表格的值，後面接「(12/10前 …)」；手機寬度時換到下一行
function setSummaryCell(id, mainText, oldText) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = mainText;
    if (oldText) {
        const span = document.createElement('span');
        span.className = 'old-compare d-block d-md-inline ms-md-1 small fw-normal text-body-secondary';
        span.textContent = `(12/10前 ${oldText})`;
        el.appendChild(span);
    }
}

// 總覽表格下方說明：括號比較的依據
function renderOldCompareNote(s) {
    const note = document.getElementById('oldCompareNote');
    if (!note) return;
    if (s.seller === 'shop') { note.style.display = 'none'; return; }
    note.style.display = '';
    const parts = ['括號內為同樣條件在 12/10 前（舊制費率）的試算。'];
    parts.push(oldTransRate !== null
        ? `成交手續費依「查詢」的類別對應為 ${oldTransRate}%。`
        : `成交手續費沿用目前的 ${s.transRate}%（手動輸入或查無對應類別；可用「查詢」選類別帶入 12/10 前費率）。`);
    if (s.preOrderRate === 2) parts.push('12/10 前預購只有 3%。');
    note.textContent = parts.join('');
}

// Styling & Init
const floatingHeader = document.getElementById('floatingHeader');
const inputSection = document.querySelector('.input-section');

function handleScroll() {
    if (inputSection.getBoundingClientRect().bottom < 0) floatingHeader.classList.add('visible');
    else floatingHeader.classList.remove('visible');
}

window.addEventListener('scroll', handleScroll);
const wrapperScroll = document.getElementById('page-content-wrapper');
if (wrapperScroll) wrapperScroll.addEventListener('scroll', handleScroll);

floatingHeader.addEventListener('click', () => {
    const wrapper = document.getElementById('page-content-wrapper');
    if (wrapper && wrapper.scrollTop > 0) wrapper.scrollTo({ top: 0, behavior: 'smooth' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
});

// 深色模式切換在 site.js（header 共用）

// Init Bootstrap Tooltips
document.addEventListener('DOMContentLoaded', function () {
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const tooltipTrigger = isTouchDevice ? 'click' : 'hover focus';

    [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]')).map(el => {
        el.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
        });
        return new bootstrap.Tooltip(el, { trigger: tooltipTrigger, html: true });
    });

    if (isTouchDevice) {
        document.addEventListener('click', function (e) {
            if (!e.target.closest('[data-bs-toggle="tooltip"]')) {
                [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]')).forEach(el => {
                    const tooltip = bootstrap.Tooltip.getInstance(el);
                    if (tooltip) tooltip.hide();
                });
            }
        });
    }
});

// Start
loadFromQueryString();
updateModeUI();
updateLayoutUI();
calculateFees();
