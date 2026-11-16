#!/usr/bin/env node
// 把 partials/*.html 寫進各頁 <!-- include:NAME --> ... <!-- /include:NAME --> 之間。
// partial 內的 {{key}} 依下方 PAGES 的設定替換；結果直接 commit，GitHub Pages 部署前也會再跑一次。
//
// 用法：node scripts/build-partials.mjs          寫入檔案
//       node scripts/build-partials.mjs --check  只檢查，有差異就 exit 1
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

const ACTIVE = 'active" aria-current="page';

const MODAL_BTN_CLOSE = '<button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">關閉</button>';
const MODAL_BTN_KEEP = '<button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">繼續用現行費率</button>';
const MODAL_BTN_GO_NEW = '<a href="new.html" class="btn btn-danger new-version-link">前往 12/11 新制計算機 <i class="bi bi-arrow-right"></i></a>';

// 每頁的變數。新增頁面時在這裡加一筆，並在 HTML 放好 include 標記。
const PAGES = {
    'index.html': {
        active_index: ACTIVE, active_new: '', active_faq: '',
        events_href: '#events',
        modal_autoshow: 'true',
        modal_buttons: `${MODAL_BTN_KEEP}\n                    ${MODAL_BTN_GO_NEW}`,
    },
    'new.html': {
        active_index: '', active_new: ACTIVE, active_faq: '',
        events_href: '#events',
        modal_autoshow: 'false',
        modal_buttons: MODAL_BTN_CLOSE,
    },
    'faq.html': {
        active_index: '', active_new: '', active_faq: ACTIVE,
        events_href: 'index.html#events',
        modal_autoshow: 'false',
        modal_buttons: `${MODAL_BTN_CLOSE}\n                    ${MODAL_BTN_GO_NEW}`,
    },
};

function render(name, vars) {
    const tpl = readFileSync(join(ROOT, 'partials', `${name}.html`), 'utf8').trimEnd();
    return tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        if (!(key in vars)) throw new Error(`partials/${name}.html 用到未定義的變數 {{${key}}}`);
        return vars[key];
    });
}

const INCLUDE_RE = /([ \t]*)<!-- include:([\w-]+) -->[\s\S]*?<!-- \/include:\2 -->/g;

let changed = 0;
for (const [page, vars] of Object.entries(PAGES)) {
    const path = join(ROOT, page);
    const before = readFileSync(path, 'utf8');
    let count = 0;
    const after = before.replace(INCLUDE_RE, (_, indent, name) => {
        count++;
        return `${indent}<!-- include:${name} -->\n${render(name, vars)}\n${indent}<!-- /include:${name} -->`;
    });
    if (count === 0) throw new Error(`${page} 沒有任何 include 標記`);
    if (after !== before) {
        changed++;
        if (CHECK) console.error(`過期：${page}`);
        else writeFileSync(path, after);
    }
    console.log(`${page}: ${count} 個 include${after !== before ? (CHECK ? '（需更新）' : '（已更新）') : ''}`);
}

if (CHECK && changed) {
    console.error('請執行 node scripts/build-partials.mjs');
    process.exit(1);
}
