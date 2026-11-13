// Get all input elements
const costPriceInput = document.getElementById('costPrice');
const costTaxTypeInput = document.getElementById('costTaxType');
const costTaxLabel = document.getElementById('costTaxLabel');
const costTaxSuffix = document.getElementById('costTaxSuffix');
const sellPriceInput = document.getElementById('sellPrice');
const profitMarginInput = document.getElementById('profitMargin');
const transactionFeeInput = document.getElementById('transactionFee');

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
// 冷凍訂單（免運及進階賣家專案 方案三、四）：≥$100 每單 $80，≤$99 收 6%
const frozenOrderInput = document.getElementById('frozenOrder');
const FROZEN_FIXED = 80;
function isFrozenOrder() { return !!(frozenOrderInput && frozenOrderInput.checked); }

// Floating Header Elements
const floatSellContainer = document.getElementById('floatSellContainer');
const floatMarginContainer = document.getElementById('floatMarginContainer');
const suggestedPriceColumns = document.querySelectorAll('.suggested-price-column');
const sellPriceColumns = document.querySelectorAll('.sell-price-column');

// Radio Groups
const cashbackRadios = document.querySelectorAll('input[name="cashbackProgram"]');
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

let currentMode = 'profit'; 
let currentShippingOption = 'both'; 
let currentSellerType = 'general'; 

// Format number
function formatCurrency(amount) {
    return '$ ' + Math.round(amount).toLocaleString('zh-TW');
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
        tax: params.get('tax') || '0',
        costTax: params.get('costTax') || 'inc',
        hasProdInv: params.get('hasProdInv') === '1',
        hasFeeInv: params.get('hasFeeInv') === '1',
        frozen: params.get('frozen') === '1'
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
    
    let preOrderValue = '0';
    preOrderRadios.forEach(r => { if(r.checked) preOrderValue = r.value; });
    params.set('preorder', preOrderValue);
    if (getInstallment() !== '0') params.set('installment', getInstallment());
    
    let cashbackValue = '0';
    cashbackRadios.forEach(r => { if(r.checked) cashbackValue = r.value; });
    params.set('cashback', cashbackValue);
    
    let taxValue = '0';
    taxRadios.forEach(r => { if(r.checked) taxValue = r.value; });
    params.set('tax', taxValue);

    if (taxValue === '5' || taxValue === '5_plus') {
        if (hasProductInvoiceInput.checked) params.set('hasProdInv', '1');
        if (hasFeeInvoiceInput.checked) params.set('hasFeeInv', '1');
    }
    if (frozenOrderInput && frozenOrderInput.checked) params.set('frozen', '1');
    
    const newUrl = window.location.pathname + '?' + params.toString();
    window.history.replaceState({}, '', newUrl);
}

function loadFromQueryString() {
    const params = getQueryParams();
    
    currentMode = params.mode;
    document.getElementById(params.mode === 'profit' ? 'modeProfit' : 'modePrice').checked = true;
    
    currentShippingOption = params.shipping;
    if (params.shipping === 'ship1') document.getElementById('shipOne').checked = true;
    else if (params.shipping === 'ship2') document.getElementById('shipTwo').checked = true;
    else document.getElementById('shipBoth').checked = true;
    
    currentSellerType = params.seller;
    document.getElementById(params.seller === 'mall' ? 'sellerMall' : 'sellerGeneral').checked = true;
    
    if (params.cost) costPriceInput.value = params.cost;
    
    if (params.costTax === 'exc') {
        costTaxTypeInput.checked = false;
        costTaxLabel.textContent = '未稅';
        costTaxSuffix.textContent = '(未稅)';
    } else {
        costTaxTypeInput.checked = true;
        costTaxLabel.textContent = '含稅';
        costTaxSuffix.textContent = '(含稅)';
    }

    if (params.sell) sellPriceInput.value = params.sell;
    if (params.margin) profitMarginInput.value = params.margin;
    if (params.fee) transactionFeeInput.value = params.fee;
    
    setInstallmentFromParam(params.installment);
    if (params.preorder === '3') document.getElementById('isPreOrder').checked = true;
    else document.getElementById('noPreOrder').checked = true;
    
    if (params.cashback === '1.5') document.getElementById('cashback5').checked = true;
    else if (params.cashback === '2.5') document.getElementById('cashback10').checked = true;
    else document.getElementById('noCashback').checked = true;
    
    if (params.tax === '1') document.getElementById('businessTax').checked = true;
    else if (params.tax === '5') document.getElementById('invoiceTax').checked = true;
    else if (params.tax === '5_plus') document.getElementById('shopeeInvoice').checked = true;
    else document.getElementById('noTax').checked = true;

    hasProductInvoiceInput.checked = params.hasProdInv;
    hasFeeInvoiceInput.checked = params.hasFeeInv;
    if (frozenOrderInput) frozenOrderInput.checked = params.frozen;
    
    updateTaxOptionsVisibility();
}

function updateTaxOptionsVisibility() {
    let taxVal = '0';
    taxRadios.forEach(r => { if(r.checked) taxVal = r.value; });
    
    if (taxVal === '5' || taxVal === '5_plus') {
        inputTaxOptions.style.display = 'block';
    } else {
        inputTaxOptions.style.display = 'none';
        // Hide only if not active, but keep state for now.
    }
}

// Event Listeners
modeRadios.forEach(r => r.addEventListener('change', (e) => {
    currentMode = e.target.value;
    updateModeUI();
    calculateFees();
    updateQueryString();
}));
shippingOptionRadios.forEach(r => r.addEventListener('change', (e) => {
    currentShippingOption = e.target.value;
    updateShippingOptionUI();
    updateQueryString();
}));
sellerTypeRadios.forEach(r => r.addEventListener('change', (e) => {
    currentSellerType = e.target.value;
    calculateFees();
    updateQueryString();
}));
taxRadios.forEach(r => r.addEventListener('change', () => {
    updateTaxOptionsVisibility();
    calculateFees();
    updateQueryString();
}));

if (frozenOrderInput) frozenOrderInput.addEventListener('change', () => {
    calculateFees();
    updateQueryString();
});

[costPriceInput, sellPriceInput, profitMarginInput, transactionFeeInput, costTaxTypeInput, hasProductInvoiceInput, hasFeeInvoiceInput].forEach(el => {
    if (el === costTaxTypeInput) {
        el.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            costTaxLabel.textContent = isChecked ? '含稅' : '未稅';
            costTaxSuffix.textContent = isChecked ? '(含稅)' : '(未稅)';
            calculateFees();
            updateQueryString();
        });
    } else if (el === hasProductInvoiceInput || el === hasFeeInvoiceInput) {
        el.addEventListener('change', () => {
            calculateFees();
            updateQueryString();
        });
    } else {
        el.addEventListener('input', () => {
            calculateFees();
            updateQueryString();
        });
    }
});

cashbackRadios.forEach(r => r.addEventListener('change', () => {
    calculateFees();
    updateQueryString();
}));
installmentRadios.forEach(r => r.addEventListener('change', () => {
    calculateFees();
    updateQueryString();
}));
preOrderRadios.forEach(r => r.addEventListener('change', () => {
    calculateFees();
    updateQueryString();
}));

function updateModeUI() {
    if (currentMode === 'profit') {
        sellPriceContainer.style.display = '';
        profitMarginContainer.style.display = 'none';
        suggestedPriceRows.forEach(row => row.style.display = 'none');
        sellPriceRows.forEach(row => row.style.display = '');
        floatSellContainer.style.display = '';
        floatMarginContainer.style.display = 'none';
        suggestedPriceColumns.forEach(col => col.style.display = 'none');
        sellPriceColumns.forEach(col => col.style.display = '');
    } else {
        sellPriceContainer.style.display = 'none';
        profitMarginContainer.style.display = '';
        suggestedPriceRows.forEach(row => row.style.display = '');
        sellPriceRows.forEach(row => row.style.display = 'none');
        floatSellContainer.style.display = 'none';
        floatMarginContainer.style.display = '';
        suggestedPriceColumns.forEach(col => col.style.display = '');
        sellPriceColumns.forEach(col => col.style.display = 'none');
    }
}

function updateShippingOptionUI() {
    const cards = [
        document.querySelector('.col-md-6:has(.result-card.regular):nth-of-type(1)'),
        document.querySelector('.col-md-6:has(.result-card.regular):nth-of-type(2)'),
        document.querySelector('.col-md-6:has(.result-card.event):nth-of-type(3)'),
        document.querySelector('.col-md-6:has(.result-card.event):nth-of-type(4)')
    ];
    const summaryRows = document.querySelectorAll('.table tbody tr');
    
    const show = [true, true, true, true];
    if (currentShippingOption === 'ship1') show[1] = show[3] = false;
    else if (currentShippingOption === 'ship2') show[0] = show[2] = false;

    cards.forEach((card, i) => { if(card) card.style.display = show[i] ? '' : 'none'; });
    summaryRows.forEach((row, i) => { row.style.display = show[i] ? '' : 'none'; });
}


// 用獲利率反推售價：找出「獲利率 ≥ 目標」的最低整數售價。
// 每項費用各自四捨五入，公式解會略低於目標，所以直接用實際計算逐一驗證；
// 免運／冷凍服務費在 $99／$100 之間有級距，兩段各自單調，分段二分搜尋後取較低者。
function calculateRequiredPrice(cost, marginPercent, transactionFeeRate, cashbackRate, preOrderRate, taxSetting, isEvent, isShip2, isMall, hasProdInv, hasFeeInv, isCostInc) {
    if (cost <= 0) return 0;
    const target = marginPercent / 100;
    const ok = (p) => computeScenarioValues(p, cost, transactionFeeRate, cashbackRate, preOrderRate, taxSetting, isEvent, isShip2, isMall, hasProdInv, hasFeeInv, isCostInc).profit >= p * target;
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
    const low = lowestIn(1, 99);
    if (low !== null) return low;
    return lowestIn(100, 100000000) || 0;
}

function calculateFees() {
    let costPrice = parseFloat(costPriceInput.value) || 0;
    const isCostInc = costTaxTypeInput.checked;
    const transactionFeeRate = parseFloat(transactionFeeInput.value) || 0;
    
    let cashbackRate = 0;
    let cashbackLabel = '不參加';
    cashbackRadios.forEach(r => {
        if (r.checked) {
            cashbackRate = parseFloat(r.value);
            if (r.id === 'cashback5') cashbackLabel = '5%';
            else if (r.id === 'cashback10') cashbackLabel = '10%';
        }
    });

    let preOrderRate = 0;
    let preOrderLabel = '否';
    preOrderRadios.forEach(r => {
        if (r.checked) {
            preOrderRate = parseFloat(r.value);
            if (preOrderRate > 0) preOrderLabel = '是';
        }
    });

    let taxSetting = '0';
    taxRadios.forEach(r => { if(r.checked) taxSetting = r.value; });
    
    const hasProdInv = hasProductInvoiceInput.checked;
    const hasFeeInv = hasFeeInvoiceInput.checked;

    const isMall = currentSellerType === 'mall';
    
    let prices = {};
    if (currentMode === 'profit') {
        const p = parseFloat(sellPriceInput.value) || 0;
        prices = { 'regular-ship1': p, 'regular-ship2': p, 'event-ship1': p, 'event-ship2': p };
        
        // Update sell price display in result cards
        ['regular-ship1', 'regular-ship2', 'event-ship1', 'event-ship2'].forEach(key => {
            const el = document.getElementById(`${key}-sell-price`);
            if(el) el.textContent = formatCurrency(p);
            const elSum = document.getElementById(`summary-${key}-sell`);
            if(elSum) elSum.textContent = formatCurrency(p);
        });
    } else {
        const margin = parseFloat(profitMarginInput.value) || 0;
        prices = {
            'regular-ship1': calculateRequiredPrice(costPrice, margin, transactionFeeRate, cashbackRate, preOrderRate, taxSetting, false, false, isMall, hasProdInv, hasFeeInv, isCostInc),
            'regular-ship2': calculateRequiredPrice(costPrice, margin, transactionFeeRate, cashbackRate, preOrderRate, taxSetting, false, true, isMall, hasProdInv, hasFeeInv, isCostInc),
            'event-ship1': calculateRequiredPrice(costPrice, margin, transactionFeeRate, cashbackRate, preOrderRate, taxSetting, true, false, isMall, hasProdInv, hasFeeInv, isCostInc),
            'event-ship2': calculateRequiredPrice(costPrice, margin, transactionFeeRate, cashbackRate, preOrderRate, taxSetting, true, true, isMall, hasProdInv, hasFeeInv, isCostInc)
        };
        
        ['regular-ship1', 'regular-ship2', 'event-ship1', 'event-ship2'].forEach(key => {
            const el = document.getElementById(`${key}-suggested-price`);
            if(el) el.textContent = formatCurrency(prices[key]);
            const elSum = document.getElementById(`summary-${key}-suggested`);
            if(elSum) elSum.textContent = formatCurrency(prices[key]);
        });
    }

    calculateScenario('regular-ship1', prices['regular-ship1'], costPrice, transactionFeeRate, cashbackRate, preOrderRate, taxSetting, false, false, isMall, hasProdInv, hasFeeInv, isCostInc);
    calculateScenario('regular-ship2', prices['regular-ship2'], costPrice, transactionFeeRate, cashbackRate, preOrderRate, taxSetting, false, true, isMall, hasProdInv, hasFeeInv, isCostInc);
    calculateScenario('event-ship1', prices['event-ship1'], costPrice, transactionFeeRate, cashbackRate, preOrderRate, taxSetting, true, false, isMall, hasProdInv, hasFeeInv, isCostInc);
    calculateScenario('event-ship2', prices['event-ship2'], costPrice, transactionFeeRate, cashbackRate, preOrderRate, taxSetting, true, true, isMall, hasProdInv, hasFeeInv, isCostInc);

    // Floating Header
    const cashOutCost = isCostInc ? costPrice : costPrice * 1.05;
    document.getElementById('floatCost').textContent = formatCurrency(cashOutCost);
    
    if (currentMode === 'profit') {
        document.getElementById('floatSell').textContent = formatCurrency(prices['regular-ship1']);
    } else {
        document.getElementById('floatMargin').textContent = profitMarginInput.value + '%';
    }
    const floatPre = document.getElementById('floatPreOrder');
    floatPre.textContent = preOrderLabel;
    floatPre.className = preOrderRate > 0 ? 'badge bg-warning text-dark' : 'badge bg-secondary';
    
    const floatCash = document.getElementById('floatCashback');
    floatCash.textContent = cashbackLabel;
    floatCash.className = cashbackRate > 0 ? 'badge bg-warning text-dark' : 'badge bg-secondary';
    
    const eventFeeIncrease = isMall ? 3 : 2;
    
    ['regular-ship1', 'regular-ship2', 'event-ship1', 'event-ship2'].forEach(k => {
        const l = document.getElementById(`${k}-transaction-label`);
        if(l) {
            if (k.startsWith('event')) {
                const eventRate = (cashbackRate === 0) ? transactionFeeRate + eventFeeIncrease : transactionFeeRate;
                l.textContent = `成交手續費 (${eventRate}%)`;
            } else {
                l.textContent = `成交手續費 (${transactionFeeRate}%)`;
            }
        }
    });
}

// 計算單一情境的各項數值（不碰畫面），calculateScenario 與反推售價共用
function computeScenarioValues(sellPrice, costPrice, transactionFeeRate, cashbackRate, preOrderRate, taxSetting, isEvent, isShip2, isMall, hasProdInv, hasFeeInv, isCostInc) {
    // 1. Shopee Fees
    const limit = 35000;
    const eventFeeIncrease = isMall ? 3 : 2;
    const effTransRate = (isEvent && cashbackRate === 0) ? transactionFeeRate + eventFeeIncrease : transactionFeeRate;
    
    const transFee = isMall ? 
        Math.round(sellPrice * effTransRate / 100) : 
        Math.round(Math.min(sellPrice, limit) * effTransRate / 100);
        
    const payFee = Math.round(sellPrice * getPaymentPct() / 100);
    // Ship2 tiered: ≤99 → 6% activity service fee; ≥100 → fixed $60
    // Frozen: ≥100 → fixed $80 (both plans); ≤99 → 6%
    const frozen = isFrozenOrder();
    const shipFee = (frozen && sellPrice > 99)
        ? FROZEN_FIXED
        : isShip2
            ? (sellPrice <= 99 ? Math.round(sellPrice * 0.06) : 60)
            : Math.round(sellPrice * 0.06);
    const cashFee = Math.round(sellPrice * cashbackRate / 100);
    const preFee = Math.round(sellPrice * preOrderRate / 100);
    
    const totalShopeeFee = transFee + payFee + shipFee + cashFee + preFee;
    
    // 2. Taxes
    let outputTax = 0;
    if (taxSetting === '1') outputTax = Math.round(sellPrice * 0.01);
    else if (taxSetting === '5' || taxSetting === '5_plus') outputTax = Math.round(sellPrice / 1.05 * 0.05);
    
    let inputTax = 0; // Product Input
    if (hasProdInv && (taxSetting === '5' || taxSetting === '5_plus')) {
         inputTax = isCostInc ? Math.round(costPrice / 1.05 * 0.05) : Math.round(costPrice * 0.05);
    }
    
    let feeInputTax = 0; // Fee Input
    if (hasFeeInv && (taxSetting === '5' || taxSetting === '5_plus')) {
         feeInputTax = Math.round(totalShopeeFee / 1.05 * 0.05);
    }
    
    let payableTax = 0;
    if (taxSetting !== '0') {
         payableTax = Math.max(0, outputTax - inputTax - feeInputTax);
    }
    
    // 3. Agent Fee
    const agentFee = (taxSetting === '5_plus') ? 2.5 : 0;
    
    // Total Deduction
    const totalDeduction = totalShopeeFee + payableTax + agentFee;
    
    // 4. Profit
    const cashOutCost = isCostInc ? costPrice : costPrice * 1.05;
    const profit = sellPrice - cashOutCost - totalDeduction;

    return { frozen, transFee, payFee, shipFee, cashFee, preFee, totalShopeeFee, outputTax, inputTax, feeInputTax, payableTax, agentFee, totalDeduction, profit };
}

function calculateScenario(prefix, sellPrice, costPrice, transactionFeeRate, cashbackRate, preOrderRate, taxSetting, isEvent, isShip2, isMall, hasProdInv, hasFeeInv, isCostInc) {
    const { frozen, transFee, payFee, shipFee, cashFee, preFee, totalShopeeFee, outputTax, inputTax, feeInputTax, payableTax, agentFee, totalDeduction, profit } =
        computeScenarioValues(sellPrice, costPrice, transactionFeeRate, cashbackRate, preOrderRate, taxSetting, isEvent, isShip2, isMall, hasProdInv, hasFeeInv, isCostInc);

    // --- Update UI ---
    
    // Group 1
    document.getElementById(`${prefix}-transaction`).textContent = formatCurrency(transFee);
    document.getElementById(`${prefix}-payment`).textContent = formatCurrency(payFee);
    const payLabelEl = document.getElementById(`${prefix}-payment-label`);
    if (payLabelEl) payLabelEl.textContent = paymentLabel();
    document.getElementById(`${prefix}-shipping`).textContent = formatCurrency(shipFee);

    const shipLabelEl = document.getElementById(`${prefix}-shipping-label`);
    if (shipLabelEl) {
        if (frozen && sellPrice > 99) shipLabelEl.textContent = '冷凍訂單活動服務費 (+80元)';
        else if (isShip2) shipLabelEl.textContent = sellPrice <= 99 ? '免運活動服務費 (6%)' : '免運手續費 (+60元)';
        else shipLabelEl.textContent = '免運手續費 (6%)';
    }
    
    const elPre = document.getElementById(`${prefix}-preorder`);
    const rowPre = document.getElementById(`${prefix}-preorder-row`);
    if(preOrderRate > 0) { rowPre.style.display=''; elPre.textContent=formatCurrency(preFee); } else rowPre.style.display='none';
    
    const elCash = document.getElementById(`${prefix}-cashback`);
    const rowCash = document.getElementById(`${prefix}-cashback-row`);
    if(cashbackRate > 0) { rowCash.style.display=''; elCash.textContent=formatCurrency(cashFee); } else rowCash.style.display='none';
    
    document.getElementById(`${prefix}-shopee-total`).textContent = formatCurrency(totalShopeeFee);

    const shopeePercentEl = document.getElementById(`${prefix}-shopee-percent`);
    if (shopeePercentEl) {
        if (sellPrice > 0) {
            const pct = (totalShopeeFee / sellPrice * 100).toFixed(1);
            shopeePercentEl.textContent = `(${pct}%)`;
        } else {
            shopeePercentEl.textContent = '(0%)';
        }
    }

    // Group 2
    document.getElementById(`${prefix}-payable-tax`).textContent = formatCurrency(payableTax);

    const taxPercentEl = document.getElementById(`${prefix}-tax-percent`);
    if (taxPercentEl) {
        if (sellPrice > 0) {
            const pct = (payableTax / sellPrice * 100).toFixed(1);
            taxPercentEl.textContent = `(${pct}%)`;
        } else {
            taxPercentEl.textContent = '(0%)';
        }
    }
    
    const elOut = document.getElementById(`${prefix}-output-tax`);
    const groupTax = document.getElementById(`collapse-${prefix}-tax`).closest('.fee-group');
    if (taxSetting === '0') {
        groupTax.style.display = 'none';
    } else {
        groupTax.style.display = '';
        elOut.textContent = formatCurrency(outputTax);
        
        const rowIn = document.getElementById(`${prefix}-input-tax-row`);
        if(hasProdInv && (taxSetting === '5'||taxSetting === '5_plus')) { rowIn.style.display=''; document.getElementById(`${prefix}-input-tax`).textContent = '- ' + formatCurrency(inputTax); } else rowIn.style.display='none';
        
        const rowFeeIn = document.getElementById(`${prefix}-fee-input-tax-row`);
        if(hasFeeInv && (taxSetting === '5'||taxSetting === '5_plus')) { rowFeeIn.style.display=''; document.getElementById(`${prefix}-fee-input-tax`).textContent = '- ' + formatCurrency(feeInputTax); } else rowFeeIn.style.display='none';
    }

    // Agent Fee
    const rowAgent = document.getElementById(`${prefix}-agent-fee-row`);
    if((taxSetting === '5_plus')) { rowAgent.style.display=''; document.getElementById(`${prefix}-agent-fee`).textContent = formatCurrency(agentFee); } else rowAgent.style.display='none';

    // Total Deduction
    document.getElementById(`${prefix}-deduction`).textContent = formatCurrency(totalDeduction);
    const deductionPercentEl = document.getElementById(`${prefix}-deduction-percent`);
    if (deductionPercentEl) {
         if (sellPrice > 0) {
            const pct = (totalDeduction / sellPrice * 100).toFixed(1);
            deductionPercentEl.textContent = `(${pct}%)`;
        } else {
            deductionPercentEl.textContent = '(0%)';
        }
    }

    const rowDeduction = document.getElementById(`${prefix}-deduction`).closest('.deduction-row');
    if (taxSetting === '0') {
        rowDeduction.style.display = 'none';
    } else {
        rowDeduction.style.display = 'flex';
    }

    // Profit
    const elProfit = document.getElementById(`${prefix}-profit`);
    elProfit.textContent = formatCurrency(profit);
    const rowProfit = document.getElementById(`${prefix}-profit-row`);
    if(profit < 0) rowProfit.classList.add('negative'); else rowProfit.classList.remove('negative');
    
    // Summary
    document.getElementById(`summary-${prefix}-total`).textContent = formatCurrency(totalDeduction);
    document.getElementById(`summary-${prefix}-profit`).textContent = formatCurrency(profit);
    
    const profitEl = document.getElementById(`summary-${prefix}-profit`);
    profitEl.className = profit < 0 ? 'fw-bold text-danger text-nowrap' : 'fw-bold text-success text-nowrap';
    
    const marginEl = document.getElementById(`summary-${prefix}-margin`);
    if (sellPrice > 0) {
        const m = (profit / sellPrice) * 100;
        marginEl.textContent = m.toFixed(1) + '%';
        marginEl.className = m < 0 ? 'text-danger text-nowrap' : 'text-success text-nowrap';
    } else {
        marginEl.textContent = '0%';
        marginEl.className = 'text-muted text-nowrap';
    }
}

// Styling & Init
const floatingHeader = document.getElementById('floatingHeader');
const inputSection = document.querySelector('.input-section');

function handleScroll() {
    if (inputSection.getBoundingClientRect().bottom < 0) floatingHeader.classList.add('visible');
    else floatingHeader.classList.remove('visible');
}

// Listen on both window and wrapper for across-device support
window.addEventListener('scroll', handleScroll);
const wrapperScroll = document.getElementById('page-content-wrapper');
if (wrapperScroll) wrapperScroll.addEventListener('scroll', handleScroll);

floatingHeader.addEventListener('click', () => {
    const wrapper = document.getElementById('page-content-wrapper');
    // If wrapper is scrollable (Desktop)
    if (wrapper && wrapper.scrollTop > 0) {
        wrapper.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
        // Fallback or Mobile (natural scroll)
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
});

const themeToggle = document.getElementById('themeToggle');
const themeIcon = document.getElementById('themeIcon');
const htmlElement = document.documentElement;
let savedTheme = localStorage.getItem('theme') || 'light';
function applyTheme(t){ htmlElement.setAttribute('data-theme', t); themeIcon.className = t==='dark'?'bi bi-sun-fill fs-4':'bi bi-moon-fill fs-4'; }
applyTheme(savedTheme);
themeToggle.addEventListener('click', () => { savedTheme = savedTheme==='dark'?'light':'dark'; applyTheme(savedTheme); localStorage.setItem('theme', savedTheme); });

// Init Bootstrap Tooltips
document.addEventListener('DOMContentLoaded', function() {
    // Detect if device is touch-enabled
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    
    // Configure tooltips based on device type
    const tooltipTrigger = isTouchDevice ? 'click' : 'hover focus';
    
    [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]')).map(el => {
        // Prevent tooltip icon clicks from triggering parent elements (like radio buttons)
        el.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
        });
        
        return new bootstrap.Tooltip(el, {
            trigger: tooltipTrigger,
            html: true
        });
    });
    
    // Auto-hide tooltips on click outside (for touch devices)
    if (isTouchDevice) {
        document.addEventListener('click', function(e) {
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
updateShippingOptionUI();
calculateFees();
