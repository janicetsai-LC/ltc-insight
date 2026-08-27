# LTC-Insight 自動更新系統

把之前那些一次性手動腳本，整理成正式、可重複執行的自動化管線。

## 架構

```
scraper/
├── lib/
│   ├── extract.mjs   # 共用萃取邏輯：央文號、日期、碼別、主旨清理
│   └── merge.mjs      # 以央文號去重合併引擎、index.html 讀寫
├── fetchers/
│   ├── taoyuan.mjs    # 桃園（單頁，直連PDF）
│   ├── nantou.mjs     # 南投（8個分類頁，皆單頁全列表）
│   ├── taitung.mjs    # 臺東（6個分類頁，已排除與「居家服務相關」重複的分類）
│   └── taichung.mjs   # 台中（分頁+二階段，含robots規避）
├── update-all.mjs     # 主更新腳本：串接所有來源，執行去重合併，寫回 index.html
└── test-update-pipeline.mjs  # 離線測試（不需網路）
```

## 核心邏輯

1. 讀出 `index.html` 目前的 `REAL_DATA_SOURCE`
2. 依序呼叫每個縣市的 fetcher，抓回原始項目（標題、日期、PDF連結）
3. 每筆原始項目透過 `extract.mjs` 正規化：
   - 萃取央文號（如「衛部顧字第1150021099號」）
   - 拆分「文號識別資訊」與「主旨」（title 只留主旨，不含機關/日期/文號）
   - 移除「轉知」字樣
4. 透過 `merge.mjs` 以**央文號為主鍵**去重：
   - 若央文號已存在於資料庫（不論在哪個機關的紀錄下），只把這個機關的引用加進該筆記錄的 `citations` 陣列，不會產生重複卡片
   - 若是全新央文號，新增為獨立主記錄
5. 寫回 `index.html`，其餘 HTML/CSS/JS 完全不動

## 使用方式

### 本機手動執行

```bash
cd scraper
npm install
node update-all.mjs                            # 抓全部四縣市
node update-all.mjs --sources=taoyuan,nantou    # 只抓指定縣市
node update-all.mjs --dry-run                   # 只看會新增幾筆，不寫檔（先確認再正式跑）
```

跑完後 `index.html` 會被直接更新，上傳到 GitHub 覆蓋即可。

### 執行前先跑測試

```bash
cd scraper
node test-update-pipeline.mjs
```

這是離線測試，不需要連網，驗證萃取/去重邏輯本身沒壞掉，也會對你目前的
`index.html` 做唯讀檢查（確認目前沒有同一央文號分散成多筆的情況）。**建議每次
改動 `lib/` 或 `fetchers/` 之後、正式執行更新前，先跑一次這個測試。**

### GitHub Actions 全自動排程（真正的「自動更新」）

`.github/workflows/update-ltc-insight.yml` 這個檔案要放到 repo 的
`.github/workflows/` 資料夾（跟 `index.html` 同一層的上一層，即 repo 根目錄）。

放上去之後：
- 每週一台灣時間早上 8:00 會自動執行一次抓取＋更新
- 如果有抓到新資料，會自動 commit 並 push，你完全不用手動操作
- 如果沒有新資料，不會產生多餘的 commit
- 也可以到 repo 的 **Actions** 分頁，手動點「Run workflow」立即觸發一次

這個排程之所以能做到「全自動」，是因為 GitHub Actions 的執行環境本身有完整對外
網路，不像 Claude 的沙盒環境或某些企業內網會被網域白名單限制。

## 重要限制與注意事項

- **Claude 沒辦法在對話中直接執行這些 fetcher**：縣市政府網站的網域不在 Claude
  沙盒的網路白名單裡。所有實際抓取都要在你自己的電腦，或 GitHub Actions 上執行。
- **台中的分頁網址有雷**：`/1617526/Lpsimplelist?Page=N` 這個短網址格式會被
  robots.txt 擋，已經在 `fetchers/taichung.mjs` 裡改用完整路徑格式解決了。
- **`code`（碼別）與 `status`（有效/廢止）欄位是自動判斷的，建議定期人工複核**：
  - `code` 只有標題明確寫出代碼（如 GA05、BA13）才會抓到，其餘一律為 `OTHER`，
    不會自動臆測。
  - `status` 一律預設「有效」，除非你手動比對後改成「廢止」，抓取階段無法自動
    判斷某函釋是否已被後續函釋取代。
- **衛福部原文（南投等只是副本收文的那種）目前只能人工上傳補件**，這套自動化
  管線只涵蓋四個縣市轉知網站，抓不到衛福部官網本身（robots.txt 擋掉）。
- 花蓮、嘉義縣目前沒有 fetcher（花蓮是前端框架動態渲染、嘉義縣被 robots.txt
  擋），之後如果解掉這兩個來源，可以比照現有 fetcher 的寫法各建一個新檔案，
  然後在 `update-all.mjs` 的 `FETCHERS` 物件裡註冊進去即可。

## 新增一個新縣市來源的步驟

1. 在 `fetchers/` 建一個新檔案（例如 `hualien.mjs`），寫一個 async function
   回傳 `[{agency, agencyShort, rawTitle, date?, url, fullText?}, ...]` 格式的陣列
2. 在 `update-all.mjs` 的 `FETCHERS` 物件裡加一行註冊
3. 跑 `node test-update-pipeline.mjs` 確認沒壞掉既有邏輯
4. 跑 `node update-all.mjs --sources=hualien --dry-run` 先確認新來源抓得到資料
5. 拿掉 `--dry-run` 正式執行
