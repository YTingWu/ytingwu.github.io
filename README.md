# 蝦皮手續費計算機

給蝦皮購物（台灣）賣家用的手續費與獲利計算工具。輸入進價、售價和賣場設定，就能算出成交手續費、金流與系統處理費、免運活動服務費、蝦幣回饋服務費、營業稅，以及最後的獲利與獲利率。

網站：<https://ytingwu.github.io/>

## 功能

- **新制計算機**（首頁）：2026/12/11 起成立的訂單適用。支援一般賣家、商城賣家、蝦皮小舖，同時列出「一般日／促銷檔期 × 免運方案一／二」四種情境，並在括號裡附上 12/10 前的試算方便比較。
- **舊制計算機**（`old.html`）：2026/12/10（含）以前成立的訂單。
- **兩種模式**：用售價算獲利，或用目標獲利率反推最低售價。
- **分類費率查詢**：依商品分類帶入成交手續費率（`fee.json` 舊制、`fee-new.json` 新制）。
- **賣場總覽**（`shop.html`）：管理多個賣場的設定與商品，一次看各商品在一般日與促銷檔期的淨利；可匯入蝦皮賣家中心的批次模板，調價後產生批次更新檔上傳回蝦皮。
- **促銷檔期行事曆**（`events.html`）：活動日一覽、加收規則，可訂閱 iCloud／Google 行事曆。
- **常見問題與文章**：免運方案怎麼選、12/11 新制懶人包、蝦皮小舖介紹、賣場總覽使用教學。
- **儲存與分享**：計算結果可存在瀏覽器（localStorage），設定也能用網址參數分享。

所有計算都在瀏覽器端完成，資料不會上傳到任何伺服器。

費率細節、各參數的計算方式與網址參數說明見 [`llms.txt`](llms.txt)。

## 技術

純靜態網站，沒有打包工具，也不需要 `npm install`：

- HTML + Bootstrap 5（CDN）+ 原生 JavaScript
- 部署在 GitHub Pages，push 到 `main` 後由 [GitHub Actions](.github/workflows/static.yml) 自動發佈

## 目錄結構

```
├── index.html / old.html / shop.html ...  各頁面
├── partials/            共用 header、footer、公告視窗
├── css/                 樣式
├── js/                  計算邏輯與頁面腳本
│   ├── fee-engine.js    新制費用計算核心
│   ├── shop-*.js        賣場總覽（資料層、xlsx 匯入匯出、畫面）
│   └── ...
├── fee.json             舊制分類費率
├── fee-new.json         新制分類費率（2026/12/11 起）
├── shopee-categories.json  蝦皮分類 ID 對照（批次模板匯入用）
├── scripts/build-partials.mjs  把 partials 寫進各頁
├── tests/               Node 內建 test runner 的測試
└── spec/                功能規格
```

## 本機開發

需要 Node.js 18 以上（只用來跑 partials 建置與測試）。

```bash
# 啟動本機伺服器（任選一種靜態伺服器）
python3 -m http.server 8000
# 開啟 http://localhost:8000/

# 修改 partials/ 後，把共用區塊寫回各頁
node scripts/build-partials.mjs

# 只檢查各頁的共用區塊是否和 partials 一致（有差異會 exit 1）
node scripts/build-partials.mjs --check

# 跑測試
node --test tests/
```

各頁的 header／footer 位於 `<!-- include:NAME -->` 與 `<!-- /include:NAME -->` 之間，請改 `partials/` 而不是直接改頁面。新增頁面時，要在 `scripts/build-partials.mjs` 的 `PAGES` 加上該頁的設定。

## 資料來源

費率以蝦皮官方公告為準，例如：

- [平台服務升級與費用調整](https://seller.shopee.tw/edu/article/28668)
- [2026 年 12 月成交手續費＆金流與系統處理費](https://seller.shopee.tw/edu/article/28804)
- [免運及進階賣家專案](https://seller.shopee.tw/edu/article/18733)
- [蝦皮小舖](https://seller.shopee.tw/edu/article/28779)

本站為個人開發的試算工具，與蝦皮購物無關，計算結果僅供參考，實際金額以蝦皮賣家中心為準。

## 回報問題

發現費率錯誤或計算結果不對，歡迎開 [Issue](https://github.com/YTingWu/ytingwu.github.io/issues)，附上當時的網址（含參數）和預期的結果會最快。

## 授權

[CC BY-NC-ND 4.0](LICENSE)（姓名標示－非商業性－禁止改作）© 2026 Bruce Wu
