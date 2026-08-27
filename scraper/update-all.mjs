// scraper/update-all.mjs
// 主更新腳本：抓取四個縣市來源 → 正規化 → 以央文號去重合併 → 寫回 index.html
//
// 使用方式：
//   node update-all.mjs                    # 抓全部四個縣市
//   node update-all.mjs --sources=taoyuan,nantou   # 只抓指定縣市（逗號分隔）
//   node update-all.mjs --dry-run          # 只印出會新增/合併多少筆，不寫檔
//
// 注意：此腳本需要在能連上桃園/台中/南投/臺東政府網站的環境執行
//（Claude 的沙盒環境網路白名單不包含這些網域，無法在對話中直接執行）

import path from "node:path";
import { fileURLToPath } from "node:url";
import { toRecord } from "./lib/extract.mjs";
import { readIndexHtml, writeIndexHtml, mergeRecords } from "./lib/merge.mjs";
import { fetchTaoyuan } from "./fetchers/taoyuan.mjs";
import { fetchNantou } from "./fetchers/nantou.mjs";
import { fetchTaitung } from "./fetchers/taitung.mjs";
import { fetchTaichung } from "./fetchers/taichung.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(__dirname, "..", "index.html");

const FETCHERS = {
  taoyuan: { label: "桃園", prefix: "TAOY2", fn: fetchTaoyuan },
  nantou: { label: "南投", prefix: "NTOU2", fn: fetchNantou },
  taitung: { label: "臺東", prefix: "TTUNG2", fn: fetchTaitung },
  taichung: { label: "台中", prefix: "TC2", fn: fetchTaichung }
};

function parseArgs() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? true];
    })
  );
  const sources = args.sources ? args.sources.split(",") : Object.keys(FETCHERS);
  return { sources, dryRun: !!args["dry-run"] };
}

async function main() {
  const { sources, dryRun } = parseArgs();
  console.log(`準備更新來源：${sources.join(", ")}`);
  console.log(dryRun ? "（dry-run 模式，不會寫入檔案）\n" : "");

  console.log("讀取現有 index.html 資料...");
  const { records: existingRecords, htmlBefore, htmlAfter } = await readIndexHtml(INDEX_PATH);
  console.log(`  現有 ${existingRecords.length} 筆主記錄\n`);

  const summary = [];

  for (const key of sources) {
    const fetcher = FETCHERS[key];
    if (!fetcher) {
      console.error(`未知來源：${key}，略過`);
      continue;
    }
    console.log(`[${fetcher.label}] 抓取中...`);
    let rawItems;
    try {
      rawItems = await fetcher.fn();
    } catch (e) {
      console.error(`  ✗ ${fetcher.label} 抓取失敗：${e.message}`);
      continue;
    }
    console.log(`  取得 ${rawItems.length} 筆原始項目`);

    const newRecords = rawItems.map((raw, i) => toRecord(raw, fetcher.prefix, i + 1));
    const result = mergeRecords(existingRecords, newRecords);
    console.log(
      `  → 新增獨立記錄 ${result.addedNew} 筆／合併為既有記錄的新引用 ${result.addedCitations} 筆／已存在略過 ${result.skippedDuplicateCitation} 筆\n`
    );
    summary.push({ source: fetcher.label, ...result });
  }

  console.log("=== 總結 ===");
  summary.forEach((s) => console.log(`${s.source}：新增 ${s.addedNew} 筆，合併引用 ${s.addedCitations} 筆`));
  console.log(`最終總筆數：${existingRecords.length}`);

  if (dryRun) {
    console.log("\ndry-run 模式，未寫入 index.html。");
    return;
  }

  console.log("\n寫回 index.html...");
  await writeIndexHtml(INDEX_PATH, existingRecords, htmlBefore, htmlAfter);
  console.log("完成。");
}

main().catch((e) => {
  console.error("執行失敗：", e);
  process.exit(1);
});
