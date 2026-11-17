// fee-engine.js — 12/11 新制的純計算函式（不碰 DOM）。
// 快速計算（calculator-new.js）與我的賣場（shop.js）共用；node 測試也直接 require 這支。
// s（設定）欄位：seller('general'|'mall'|'shop')、cost、isCostInc、transRate(%)、paymentPct(%)、
//   cashbackRate(%)、cashbackShort、preOrderRate(%)、taxSetting('0'|'1'|'5'|'5_plus')、
//   hasProdInv、hasFeeInv、frozen、first5

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

// 信用卡分期：金流與系統處理費率（%），2026/01/01 起，新舊制相同
const INSTALLMENT_PAYMENT_PCT = { '0': 2.5, '3': 2.5, '6': 3, '12': 3.5, '24': 5 };

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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RATES, INSTALLMENT_PAYMENT_PCT, effectiveTransRate, shippingFee, computeScenario, taxAndProfit, calculateRequiredPrice };
}
