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

const ACTIVE = 'aria-current="page"';

const MODAL_BTN_CLOSE = '<button type="button" class="btn btn-outline" data-ui-close>關閉</button>';
const MODAL_BTN_USE_NEW = '<button type="button" class="btn btn-primary" data-ui-close>使用新制計算機</button>';
const MODAL_BTN_GO_OLD = '<a href="old.html" class="btn btn-outline" data-carry-query><i class="bi bi-clock-history"></i> 前往舊制計算機</a>';
const MODAL_BTN_GO_NEW = '<a href="./" class="btn btn-primary" data-carry-query>前往新制計算機 <i class="bi bi-arrow-right"></i></a>';

const NAV = { active_index: '', active_shop: '', active_old: '', active_faq: '', active_events: '', active_articles: '', active_sponsor: '' };

// 每頁的變數。新增頁面時在這裡加一筆，並在 HTML 放好 include 標記。
// new.html 是轉址頁（永久保留），不在這裡。
const PAGES = {
    'index.html': {
        ...NAV, active_index: ACTIVE,
        modal_autoshow: 'true',
        modal_buttons: `${MODAL_BTN_GO_OLD}\n                    ${MODAL_BTN_USE_NEW}`,
    },
    'old.html': {
        ...NAV, active_old: ACTIVE,
        modal_autoshow: 'false',
        modal_buttons: `${MODAL_BTN_CLOSE}\n                    ${MODAL_BTN_GO_NEW}`,
    },
    'faq.html': {
        ...NAV, active_faq: ACTIVE,
        modal_autoshow: 'false',
        modal_buttons: `${MODAL_BTN_GO_OLD}\n                    ${MODAL_BTN_CLOSE}`,
    },
    'events.html': {
        ...NAV, active_events: ACTIVE,
        modal_autoshow: 'false',
        modal_buttons: `${MODAL_BTN_GO_OLD}\n                    ${MODAL_BTN_CLOSE}`,
    },
    'articles.html': {
        ...NAV, active_articles: ACTIVE,
        modal_autoshow: 'false',
        modal_buttons: `${MODAL_BTN_GO_OLD}\n                    ${MODAL_BTN_CLOSE}`,
    },
    // 文章頁：新增文章時照這筆加一行
    'article-1211-new-fees.html': {
        ...NAV, active_articles: ACTIVE,
        modal_autoshow: 'false',
        modal_buttons: `${MODAL_BTN_GO_OLD}\n                    ${MODAL_BTN_CLOSE}`,
    },
    'article-shopee-cashback.html': {
        ...NAV, active_articles: ACTIVE,
        modal_autoshow: 'false',
        modal_buttons: `${MODAL_BTN_GO_OLD}\n                    ${MODAL_BTN_CLOSE}`,
    },
    'article-shop-overview.html': {
        ...NAV, active_articles: ACTIVE,
        modal_autoshow: 'false',
        modal_buttons: `${MODAL_BTN_GO_OLD}\n                    ${MODAL_BTN_CLOSE}`,
    },
    'article-shopee-xiaopu.html': {
        ...NAV, active_articles: ACTIVE,
        modal_autoshow: 'false',
        modal_buttons: `${MODAL_BTN_GO_OLD}\n                    ${MODAL_BTN_CLOSE}`,
    },
    'shop.html': {
        ...NAV, active_shop: ACTIVE,
        modal_autoshow: 'false',
        modal_buttons: `${MODAL_BTN_GO_OLD}\n                    ${MODAL_BTN_CLOSE}`,
    },
    'sponsor.html': {
        ...NAV, active_sponsor: ACTIVE,
        modal_autoshow: 'false',
        modal_buttons: `${MODAL_BTN_GO_OLD}\n                    ${MODAL_BTN_CLOSE}`,
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
