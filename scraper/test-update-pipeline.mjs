// scraper/test-update-pipeline.mjs
// 離線測試：驗證 lib/extract.mjs 與 lib/merge.mjs 邏輯正確，
// 並對目前實際的 index.html 做一次「唯讀」讀寫回合測試（確認不會弄壞既有資料）
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractCentralDoc, extractDate, extractCode, normalizeTitle, toRecord } from "./lib/extract.mjs";
import { readIndexHtml, serializeRecords, mergeRecords } from "./lib/merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(__dirname, "..", "index.html");

let passed = 0;
function check(name, actual, expected) {
  try {
    assert.deepEqual(actual, expected);
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`      期望: ${JSON.stringify(expected)}`);
    console.log(`      實際: ${JSON.stringify(actual)}`);
    process.exitCode = 1;
  }
}

console.log("=== extractCentralDoc ===");
check("標準衛部顧字", extractCentralDoc("衛生福利部113年7月11日衛部顧字第1131961919號函"), "衛部顧字第1131961919號");
check("含字母修正碼", extractCentralDoc("113年3月26日衛部顧字第1130011135A號函"), "衛部顧字第1130011135號");
check("疾管署文號", extractCentralDoc("疾管感字第1100500139號"), "疾管感字第1100500139號");
check("無文號回傳空字串", extractCentralDoc("這是一段沒有文號的文字"), "");

console.log("\n=== extractDate ===");
check("年月日格式", extractDate("衛生福利部115年8月10日衛部顧字第1150021099號"), "2026-08-10");
check("點分隔格式", extractDate("108.09.24衛部顧字第1081962574A號"), "2019-09-24");

console.log("\n=== extractCode ===");
check("GA05", extractCode("機構喘息服務(GA05)照顧組合疑義"), "GA05");
check("AA06", extractCode("符合AA06身體照顧困難加計條件"), "AA06");
check("無碼別回傳OTHER", extractCode("沒有代碼的標題"), "OTHER");

console.log("\n=== normalizeTitle ===");
check(
  "標準前綴拆分",
  normalizeTitle("衛生福利部113年7月11日衛部顧字第1131961919號函-有關「陪同外出」（BA13）之服務使用範圍及「陪同就醫」（BA14）得否陪同手術相關疑義一案"),
  { identifier: "衛生福利部113年7月11日衛部顧字第1131961919號函", subject: "有關「陪同外出」（BA13）之服務使用範圍及「陪同就醫」（BA14）得否陪同手術相關疑義一案" }
);
check(
  "含轉知字樣應先移除",
  normalizeTitle("轉知衛生福利部115年8月10日衛部顧字第1150021099號函-機構式喘息服務疑義一案"),
  { identifier: "衛生福利部115年8月10日衛部顧字第1150021099號函", subject: "機構式喘息服務疑義一案" }
);

console.log("\n=== toRecord ===");
const rec = toRecord(
  { agency: "桃園市政府衛生局", agencyShort: "桃園", rawTitle: "衛生福利部115年8月10日衛部顧字第1150021099號函-機構式喘息服務疑義一案", url: "https://example.com/a.pdf" },
  "TEST",
  1
);
check("id格式", rec.id, "TEST-0001");
check("title為純主旨", rec.title, "機構式喘息服務疑義一案");
check("docNumber為識別資訊", rec.docNumber, "衛生福利部115年8月10日衛部顧字第1150021099號函");
check("centralDocNumber正確萃取", rec.centralDocNumber, "衛部顧字第1150021099號");
check("citations長度為1", rec.citations.length, 1);

console.log("\n=== mergeRecords ===");
{
  const existing = [
    {
      id: "EXIST-1", agency: "台中市政府衛生局", agencyShort: "台中", docNumber: "台中版本",
      centralDocNumber: "衛部顧字第9999999999號", date: "2026-01-01", year: 2026, code: "OTHER",
      title: "測試函釋", summary: "測試函釋", status: "有效", sourceUrl: "https://a.com/tc.pdf",
      citations: [{ agency: "台中市政府衛生局", agencyShort: "台中", date: "2026-01-01", sourceUrl: "https://a.com/tc.pdf", docNumber: "台中版本" }]
    }
  ];
  const newOnes = [
    toRecord({ agency: "桃園市政府衛生局", agencyShort: "桃園", rawTitle: "衛部顧字第9999999999號-測試函釋", url: "https://a.com/ty.pdf" }, "TEST", 1),
    toRecord({ agency: "南投縣政府衛生局", agencyShort: "南投", rawTitle: "衛部顧字第8888888888號-另一份全新函釋", url: "https://a.com/nt.pdf" }, "TEST", 2)
  ];
  const result = mergeRecords(existing, newOnes);
  check("新增1筆全新記錄", result.addedNew, 1);
  check("合併1筆為既有引用", result.addedCitations, 1);
  check("合併後總筆數為2", existing.length, 2);
  const merged = existing.find((r) => r.centralDocNumber === "衛部顧字第9999999999號");
  check("跨機關citations數為2", merged.citations.length, 2);
  check("citations含兩個機關", merged.citations.map((c) => c.agencyShort).sort(), ["台中", "桃園"]);

  // 再次合併相同資料，應該完全不重複新增
  const result2 = mergeRecords(existing, newOnes);
  check("重跑一次不應新增記錄", result2.addedNew, 0);
  check("重跑一次不應新增引用（已存在）", result2.addedCitations, 0);
  check("重跑後總筆數不變", existing.length, 2);
}

console.log("\n=== 對實際 index.html 做唯讀讀寫回合測試 ===");
{
  const { records, htmlBefore, htmlAfter } = await readIndexHtml(INDEX_PATH);
  check("讀到的筆數與檔案相符（>0）", records.length > 0, true);
  check("htmlBefore包含<!DOCTYPE", htmlBefore.includes("<!DOCTYPE"), true);
  check("htmlAfter包含</html>", htmlAfter.includes("</html>"), true);

  // 序列化後應該能重新解析回相同筆數（不寫檔，只驗證字串本身合法）
  const serialized = serializeRecords(records);
  const roundTrip = eval(serialized.replace("const REAL_DATA_SOURCE", "var REAL_DATA_SOURCE") + "; REAL_DATA_SOURCE");
  check("序列化後重新解析筆數一致", roundTrip.length, records.length);

  // 檢查目前資料庫本身沒有同央文號分散在多筆主記錄的情況
  const byCentral = {};
  records.forEach((r) => { if (r.centralDocNumber) (byCentral[r.centralDocNumber] = byCentral[r.centralDocNumber] || []).push(r.id); });
  const dupGroups = Object.entries(byCentral).filter(([, ids]) => ids.length > 1);
  check("目前資料庫無同央文號分散於多筆主記錄", dupGroups.length, 0);
}

console.log(`\n共通過 ${passed} 項測試${process.exitCode ? "（有測試失敗，見上方 ✗）" : "，全部成功。"}`);
