// shop-xlsx.js — 讀取蝦皮「價格及庫存」「備貨天數」批次模板，並以原檔為底產生批次更新檔。
// 需要 JSZip（瀏覽器用全域 JSZip；node 測試傳入）。XML 解析用 DOMParser（node 測試傳入 xmldom）。
// 蝦皮的檔案 sheetView 有不合規格的 activePane="bottom_left"，一般 xlsx 套件可能讀不了，所以自己解析。
(function (root) {
    'use strict';

    const FIRST_DATA_ROW = 7; // 第 1 列機器欄名、第 2 列模板資訊、第 3 列中文欄名、第 4–6 列說明

    const COLS = {
        sales: { productId: 'et_title_product_id', productName: 'et_title_product_name', variationId: 'et_title_variation_id', variationName: 'et_title_variation_name', price: 'et_title_variation_price', stock: 'et_title_variation_stock' },
        dts: { productId: 'et_title_product_id', productName: 'et_title_product_name', variationId: 'et_title_variation_id', variationName: 'et_title_variation_name', category: 'et_title_product_category', dts: 'et_title_product_dts' },
    };

    function colOf(ref) { return ref.replace(/\d+/g, ''); }
    function rowOf(ref) { return parseInt(ref.replace(/[A-Z]+/g, ''), 10); }

    function sheetPath(zip) {
        if (zip.file('xl/worksheets/sheet1.xml')) return 'xl/worksheets/sheet1.xml';
        const f = Object.keys(zip.files).filter(n => /^xl\/worksheets\/[^/]+\.xml$/.test(n)).sort()[0];
        if (!f) throw new Error('不是 Excel 檔（找不到工作表）');
        return f;
    }

    function textOf(el) {
        // <si> 可能是 <t> 或多段 <r><t>
        const ts = el.getElementsByTagName('t');
        let s = '';
        for (let i = 0; i < ts.length; i++) s += ts[i].textContent || '';
        return s;
    }

    // → { type: 'sales'|'dts'|null, shopId, rows: [...], fileName }
    async function parseShopeeXlsx(data, fileName, deps) {
        const JSZipLib = (deps && deps.JSZip) || root.JSZip;
        const Parser = (deps && deps.DOMParser) || root.DOMParser;
        let zip;
        try { zip = await JSZipLib.loadAsync(data); } catch (e) { throw new Error('無法讀取檔案，請確認是蝦皮下載的 .xlsx'); }
        const parse = (xml) => new Parser().parseFromString(xml, 'application/xml');

        const ss = [];
        const ssFile = zip.file('xl/sharedStrings.xml');
        if (ssFile) {
            const doc = parse(await ssFile.async('string'));
            const sis = doc.getElementsByTagName('si');
            for (let i = 0; i < sis.length; i++) ss.push(textOf(sis[i]));
        }
        const doc = parse(await zip.file(sheetPath(zip)).async('string'));
        const rowEls = doc.getElementsByTagName('row');
        const grid = new Map(); // rowNumber → { A: '...', ... }
        for (let i = 0; i < rowEls.length; i++) {
            const rEl = rowEls[i];
            const rn = parseInt(rEl.getAttribute('r'), 10);
            const cells = {};
            const cs = rEl.getElementsByTagName('c');
            for (let j = 0; j < cs.length; j++) {
                const c = cs[j];
                const t = c.getAttribute('t');
                const vEl = c.getElementsByTagName('v')[0];
                let val = '';
                if (t === 's' && vEl) val = ss[parseInt(vEl.textContent, 10)] ?? '';
                else if (t === 'inlineStr') val = textOf(c);
                else if (vEl) val = vEl.textContent || '';
                cells[colOf(c.getAttribute('r'))] = String(val).trim();
            }
            grid.set(rn, cells);
        }

        const row1 = grid.get(1) || {};
        const row2 = grid.get(2) || {};
        const type = row2.A === 'sales_info' ? 'sales' : row2.A === 'dts_info' ? 'dts' : null;
        if (!type) return { type: null, shopId: null, rows: [], fileName };

        const keyToCol = {};
        Object.entries(row1).forEach(([col, key]) => { keyToCol[key] = col; });
        const col = {};
        for (const [field, key] of Object.entries(COLS[type])) {
            if (!keyToCol[key]) throw new Error(`檔案缺少欄位 ${key}，蝦皮可能改了模板格式`);
            col[field] = keyToCol[key];
        }

        const rows = [];
        [...grid.keys()].sort((a, b) => a - b).forEach(rn => {
            if (rn < FIRST_DATA_ROW) return;
            const c = grid.get(rn);
            const productId = c[col.productId];
            if (!productId) return;
            const base = {
                rowNumber: rn,
                productId,
                productName: c[col.productName] || '',
                variationId: c[col.variationId] || productId,
                variationName: c[col.variationName] || '',
            };
            if (type === 'sales') {
                const num = (t) => { const n = Number(String(t || '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
                rows.push({ ...base, price: num(c[col.price]), stock: Math.trunc(num(c[col.stock])) });
            } else {
                const cat = c[col.category] || '';
                const m = cat.match(/^(\d+)\s*-\s*(.*)$/);
                rows.push({ ...base, categoryId: m ? m[1] : '', categoryLabel: m ? m[2] : cat, dts: c[col.dts] || '' });
            }
        });
        return { type, shopId: row2.D || null, rows, fileName };
    }

    function escXml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // 以原檔為底產生「價格及庫存」批次更新檔：只保留 changes 裡的規格列並改 G/I。
    // changes：Map(variationId → { price?: int, stock?: int })
    // 回傳 { bytes: Uint8Array, rows: 保留的列數 }
    async function buildSalesUpdate(data, changes, deps) {
        const JSZipLib = (deps && deps.JSZip) || root.JSZip;
        const zip = await JSZipLib.loadAsync(data);
        const parsed = await parseShopeeXlsx(data, '', deps);
        if (parsed.type !== 'sales') throw new Error('原檔不是「價格及庫存」模板');

        // 需要知道每列的選項 ID、以及價格／庫存在哪一欄
        const rowVar = new Map(parsed.rows.map(r => [r.rowNumber, r.variationId]));
        const sheetFile = sheetPath(zip);
        let sheet = await zip.file(sheetFile).async('string');
        let sst = await zip.file('xl/sharedStrings.xml').async('string');

        // 欄位字母（依第 1 列機器欄名）
        const header = await (async () => {
            const Parser = (deps && deps.DOMParser) || root.DOMParser;
            const doc = new Parser().parseFromString(sst, 'application/xml');
            const sis = doc.getElementsByTagName('si');
            const ss = [];
            for (let i = 0; i < sis.length; i++) ss.push(textOf(sis[i]));
            const row1 = sheet.match(/<row\b[^>]*\br="1"[^>]*>([\s\S]*?)<\/row>/);
            const map = {};
            if (row1) {
                const re = /<c\b[^>]*\br="([A-Z]+)1"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g;
                let m;
                while ((m = re.exec(row1[1]))) {
                    const v = m[2] && m[2].match(/<v>([^<]*)<\/v>/);
                    if (v) map[ss[parseInt(v[1], 10)]] = m[1];
                }
            }
            return map;
        })();
        const priceCol = header[COLS.sales.price];
        const stockCol = header[COLS.sales.stock];
        if (!priceCol || !stockCol) throw new Error('原檔找不到價格或庫存欄');

        // 新字串附加到 sharedStrings
        // 新字串的索引＝實際 <si> 的個數（不信任 uniqueCount 屬性，數錯會讓價格指到別的字串）
        let nextIndex = (sst.match(/<si[\s>\/]/g) || []).length;
        const added = [];
        const strIndex = (value) => { added.push(`<si><t>${escXml(value)}</t></si>`); return nextIndex++; };

        const setCell = (rowXml, colLetter, rowNum, value) => {
            const re = new RegExp(`<c\\b([^>]*?)\\br="${colLetter}${rowNum}"([^>]*?)(?:\\/>|>[\\s\\S]*?<\\/c>)`);
            const m = rowXml.match(re);
            const attrs = ((m ? m[1] + ' ' + m[2] : '') || '')
                .replace(/\s*\b[tr]="[^"]*"/g, '').trim();
            const cell = `<c r="${colLetter}${rowNum}"${attrs ? ' ' + attrs : ''} t="s"><v>${strIndex(String(value))}</v></c>`;
            if (m) return rowXml.replace(re, cell);
            return rowXml.replace(/<\/row>$/, cell + '</row>'); // 原本沒有這格（理論上不會）
        };

        const sdStart = sheet.indexOf('<sheetData>');
        const sdEnd = sheet.indexOf('</sheetData>');
        if (sdStart < 0 || sdEnd < 0) throw new Error('原檔格式不符（sheetData）');
        const body = sheet.slice(sdStart + '<sheetData>'.length, sdEnd);
        const rowXmls = body.match(/<row\b[^>]*>[\s\S]*?<\/row>|<row\b[^>]*\/>/g) || [];

        const out = [];
        let nextRow = FIRST_DATA_ROW;
        let kept = 0;
        const seen = new Set();
        for (const rx of rowXmls) {
            const rn = parseInt((rx.match(/<row\b[^>]*\br="(\d+)"/) || [])[1], 10);
            if (rn < FIRST_DATA_ROW) { out.push(rx); continue; }
            const vid = rowVar.get(rn);
            const ch = vid && changes.get(vid);
            if (!ch) continue;
            seen.add(vid);
            const newRn = nextRow++;
            // 重新編號：列與每個儲存格
            let nx = rx.replace(/(<row\b[^>]*\br=")\d+(")/, `$1${newRn}$2`)
                .replace(new RegExp(`(\\br="[A-Z]+)${rn}(")`, 'g'), `$1${newRn}$2`);
            if (ch.price != null) nx = setCell(nx, priceCol, newRn, ch.price);
            if (ch.stock != null) nx = setCell(nx, stockCol, newRn, ch.stock);
            out.push(nx);
            kept++;
        }
        const missing = [...changes.keys()].filter(k => !seen.has(k));
        if (missing.length && !(deps && deps.allowMissing)) throw new Error(`原檔裡找不到 ${missing.length} 個規格（選項 ID ${missing.slice(0, 3).join('、')}…），請重新上傳最新的「價格及庫存」檔`);

        sheet = sheet.slice(0, sdStart) + '<sheetData>' + out.join('') + sheet.slice(sdEnd);
        if (added.length) {
            sst = sst.replace(/<\/sst>\s*$/, added.join('') + '</sst>')
                .replace(/(<sst\b[^>]*\buniqueCount=")(\d+)(")/, (_, a, n, b) => a + nextIndex + b)
                .replace(/(<sst\b[^>]*\bcount=")(\d+)(")/, (_, a, n, b) => a + (parseInt(n, 10) + added.length) + b);
        }
        zip.file(sheetFile, sheet, { createFolders: false });
        zip.file('xl/sharedStrings.xml', sst, { createFolders: false });
        const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        return { bytes, rows: kept };
    }

    // 蝦皮檔名結尾的 yyyyMMddHHmmss（台灣時間）＝檔案產生時間；讀不到回 null
    function fileTimestamp(name) {
        const m = String(name || '').match(/_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\D[^/]*)?\.xlsx$/i);
        if (!m) return null;
        const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`);
        return Number.isFinite(t) ? t : null;
    }

    // 原檔裡有哪些選項 ID（產生更新檔前先排除找不到的）
    async function salesVariationIds(data, deps) {
        const r = await parseShopeeXlsx(data, '', deps);
        return new Set(r.rows.map(x => x.variationId));
    }

    const api = { FIRST_DATA_ROW, COLS, parseShopeeXlsx, buildSalesUpdate, fileTimestamp, salesVariationIds };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ShopXlsx = api;
})(typeof window !== 'undefined' ? window : globalThis);
