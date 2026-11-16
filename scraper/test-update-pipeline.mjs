// scraper/test-update-pipeline.mjs
// 離線測試：驗證 lib/extract.mjs 與 lib/merge.mjs 邏輯正確，
// 並對目前實際的 index.html 做一次「唯讀」讀寫回合測試（確認不會弄壞既有資料）
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractCentralDoc, extractDate, extractCode, normalizeTitle, toRecord } from "./lib/extract.mjs";
import { readIndexHtml, serializeRecords, mergeRecords, ingestRaw } from "./lib/merge.mjs";
import { parseDetail, scanIds } from "./fetchers/hualien.mjs";

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

console.log("\n=== toRecord：無正式文號時的 fallback（不應洩漏「轉知」字樣）===");
const recNoDoc = toRecord(
  { agency: "臺中市政府衛生局", agencyShort: "台中", rawTitle: "轉知衛生福利部115年9月1日衛部顧字第1150099999號函-有關長照日參與式決策民意調查一案", url: "https://example.com/b.pdf" },
  "TEST",
  2
);
check("title不含轉知", recNoDoc.title.includes("轉知"), false);
check("docNumber不含轉知（fallback修正後）", recNoDoc.docNumber.includes("轉知"), false);

console.log("\n=== toRecord：只保留中央（衛部顧字）函釋，地方局處自行發文應被過濾 ===");
const localDocRec = toRecord(
  { agency: "桃園市政府社會局", agencyShort: "桃園", rawTitle: "本府社會局112年10月11日桃社老字第1120099795號函-有關居家照顧服務員自行騎乘交通工具跟車一案", url: "https://example.com/c.pdf" },
  "TEST",
  3
);
check("地方局處自行發文應回傳null（不收錄）", localDocRec, null);
const noCentralDocRec = toRecord(
  { agency: "臺中市政府衛生局", agencyShort: "台中", rawTitle: "有關65歲以上照顧服務人員投保商業保險承保年齡疑義一案", url: "https://example.com/d.pdf" },
  "TEST",
  4
);
check("完全無央文號的公告應回傳null（不收錄）", noCentralDocRec, null);
const centralDocRec = toRecord(
  { agency: "南投縣政府衛生局", agencyShort: "南投", rawTitle: "衛生福利部113年8月27日衛部顧字第1131961879號函-長照需要等級複評生效日疑義一案", url: "https://example.com/e.pdf" },
  "TEST",
  5
);
check("衛部顧字開頭的中央函釋應正常收錄", centralDocRec !== null, true);

console.log("\n=== toRecord：日期優先順序（央發文日期應優先於列表頁日期）===");
const dateRec = toRecord(
  {
    agency: "臺中市政府衛生局", agencyShort: "台中",
    rawTitle: "衛生福利部115年8月10日衛部顧字第1150021099號函-機構式喘息服務疑義一案",
    date: "2026-08-13", // 模擬地方列表頁「最後異動時間」（轉知上架日，非央文發文日）
    url: "https://a.com/x.pdf"
  },
  "TEST", 1
);
check("date欄位應採用標題中的央發文日期，而非列表頁日期", dateRec.date, "2026-08-10");

console.log("\n=== toRecord：過濾已知的網站選單／附件錨點雜訊 ===");
check("「活動資訊」應被過濾（回傳null）", toRecord({ agency: "臺中市政府衛生局", agencyShort: "台中", rawTitle: "活動資訊", url: "https://a.com/x.pdf" }, "TEST", 1), null);
check("「成人預防保健」應被過濾", toRecord({ agency: "臺中市政府衛生局", agencyShort: "台中", rawTitle: "成人預防保健", url: "https://a.com/x.pdf" }, "TEST", 1), null);
check("「附件1」（附件錨點文字）應被過濾", toRecord({ agency: "桃園市政府衛生局", agencyShort: "桃園", rawTitle: "附件1", url: "https://a.com/x.pdf" }, "TEST", 1), null);
check("純「.pdf」應被過濾", toRecord({ agency: "桃園市政府衛生局", agencyShort: "桃園", rawTitle: ".pdf", url: "https://a.com/x.pdf" }, "TEST", 1), null);

console.log("\n=== toRecord：政策更新後，用詞精簡但無正式央文號者現在應被過濾（僅收錄衛部顧字函釋）===");
const shortButReal = toRecord({ agency: "臺東縣衛生局", agencyShort: "臺東", rawTitle: "衛福部函釋-門A款", url: "https://a.com/x.pdf" }, "TEST", 1);
check("「衛福部函釋-門A款」無正式央文號，應被過濾", shortButReal, null);
const anotherShortReal = toRecord({ agency: "臺東縣衛生局", agencyShort: "臺東", rawTitle: "衛福部函釋-住所農舍", url: "https://a.com/x.pdf" }, "TEST", 1);
check("「衛福部函釋-住所農舍」無正式央文號，應被過濾", anotherShortReal, null);
const familyDoctorCase = toRecord({ agency: "臺中市政府衛生局", agencyShort: "台中", rawTitle: "衛生福利部113年8月1日衛部顧字第1131962000號函-「居家失能個案家庭醫師照護方案」之同一個案醫師意見書每年上限為2次，不因其結案再開案有別釋示案", url: "https://a.com/x.pdf" }, "TEST", 1);
check("含衛部顧字正式央文號者仍應正常收錄", familyDoctorCase !== null, true);

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

console.log("\n=== mergeRecords：無央文號時以「機關+主旨」為次要去重鍵 ===");
console.log("（此情境現實中已不會由 toRecord 產生，這裡手動建構物件單獨測試 mergeRecords 本身的備援邏輯）");
{
  const existing = [
    {
      id: "OLD-1", agency: "臺中市政府衛生局", agencyShort: "台中", docNumber: "介紹頁版本",
      centralDocNumber: "", date: "2025-01-01", year: 2025, code: "OTHER",
      title: "有關65歲以上照顧服務人員投保商業保險承保年齡疑義一案",
      summary: "有關65歲以上照顧服務人員投保商業保險承保年齡疑義一案",
      status: "有效", sourceUrl: "https://a.com/3298092/post",
      citations: [{ agency: "臺中市政府衛生局", agencyShort: "台中", date: "2025-01-01", sourceUrl: "https://a.com/3298092/post", docNumber: "介紹頁版本" }]
    }
  ];
  const newOnes = [
    {
      id: "TEST-0001", agency: "臺中市政府衛生局", agencyShort: "台中", docNumber: "",
      centralDocNumber: "", date: "2025-01-01", year: 2025, code: "OTHER",
      title: "有關65歲以上照顧服務人員投保商業保險承保年齡疑義一案",
      summary: "有關65歲以上照顧服務人員投保商業保險承保年齡疑義一案",
      status: "有效", sourceUrl: "https://a.com/media/xxx.pdf",
      citations: [{ agency: "臺中市政府衛生局", agencyShort: "台中", date: "2025-01-01", sourceUrl: "https://a.com/media/xxx.pdf", docNumber: "" }]
    }
  ];
  const result = mergeRecords(existing, newOnes);
  check("同機關同主旨不應新增獨立記錄", result.addedNew, 0);
  check("同機關同日期視為同一筆引用，不重複新增citation", result.addedCitations, 0);
  check("citations陣列長度仍為1（同一筆引用升級連結，非新增第二筆）", existing[0].citations.length, 1);
  check("找到更好的PDF直連時應自動升級sourceUrl", existing[0].sourceUrl, "https://a.com/media/xxx.pdf");
  check("合併後總筆數仍為1（未產生重複卡片）", existing.length, 1);
}

console.log("\n=== ingestRaw：混有地方發文/雜訊時不得崩潰（排程曾因此連續失敗的回歸測試）===");
{
  const existing = [];
  const raws = [
    { agency: "桃園市政府社會局", agencyShort: "桃園", rawTitle: "本府社會局112年10月11日桃社老字第1120099795號函-洗腎跟車一案", url: "https://a.com/1.pdf" },
    { agency: "臺中市政府衛生局", agencyShort: "台中", rawTitle: "活動資訊", url: "https://a.com/2" },
    { agency: "南投縣政府衛生局", agencyShort: "南投", rawTitle: "衛生福利部115年9月1日衛部顧字第1150099999號函-測試函釋一案", url: "https://a.com/3.pdf" }
  ];
  let r;
  try { r = ingestRaw(existing, raws, "T"); } catch (e) { r = { error: e.message }; }
  check("不應拋出例外", r.error, undefined);
  check("僅收錄1筆衛部顧字函釋", existing.length, 1);
  check("略過2筆非中央函釋", r.skippedNotCentral, 2);
  check("全部都不收錄時也不崩潰", ingestRaw([], [raws[0], raws[1]], "T").addedNew, 0);
}

console.log("\n=== ingestRaw：重複執行時 id 不得撞號 ===");
{
  const existing = [];
  const mk = (n) => ({ agency: "南投縣政府衛生局", agencyShort: "南投", rawTitle: `衛生福利部115年9月1日衛部顧字第115009999${n}號函-測試${n}一案`, url: `https://a.com/${n}.pdf` });
  ingestRaw(existing, [mk(1), mk(2)], "NT");
  ingestRaw(existing, [mk(3), mk(4)], "NT"); // 模擬下一週的排程
  const ids = existing.map((r) => r.id);
  check("兩次執行共4筆", existing.length, 4);
  check("id全站唯一", new Set(ids).size, 4);
  check("第二次接續編號", ids.slice(2), ["NT-0003", "NT-0004"]);
}

console.log("\n=== 花蓮：內文頁解析（依 news/detail/1887 實際結構建構的測試頁）===");
const hualienHtml = `<html><body>
<h1>最新消息</h1>
<ul><li><a href="/news/1">最新公告</a></li></ul>
<h2>轉知衛福部有關函釋有關固定式斜坡道及非固定式斜坡板補助範圍一案(依據衛生福利部115年7月22日衛部顧字第1151962366號函辦理)</h2>
<p>一、復貴府115年6月30日府社障字第1150174594號函。</p>
<p>二、固定式斜坡道倘涉及占用公有地，則不宜納入補助範圍。</p>
<p>(一)依據補助基準表之規定，居家無障礙改善公共空間不補助。</p>
<ul><li><a href="/img/files/1150722衛部顧1151962366函釋.pdf">1150722衛部顧1151962366函釋.pdf</a></li></ul>
<h4>長照專線1966</h4>
</body></html>`;
const parsed = parseDetail(hualienHtml, "https://long-term.hlshb.gov.tw/news/detail/1887");
check("取得標題", parsed.title.includes("衛部顧字第1151962366號"), true);
check("取得PDF附件網址", parsed.pdfUrl.includes("/img/files/") && parsed.pdfUrl.endsWith(".pdf"), true);
check("取得條列內文（3段）", parsed.fullText.split("\n").length, 3);
check("無h2的頁面視為未命中", parseDetail("<html><body><p>找不到頁面</p></body></html>", "x"), null);

console.log("\n=== 花蓮：編號掃描（停止條件與進度記錄）===");
{
  const hits = new Set([1885, 1886, 1887, 1889]);
  const calls = [];
  const fakePage = async (n) => { calls.push(n); return hits.has(n) ? { title: `衛生福利部115年7月22日衛部顧字第11519628${n % 100}號函-測試${n}一案`, pdfUrl: null, detailUrl: `https://x/news/detail/${n}` } : null; };
  const r = await scanIds({ startAfter: 1880, fetchPage: fakePage, delayMs: 0 });
  check("掃到4篇", r.items.length, 4);
  check("lastId為最大有效編號1889", r.lastId, 1889);
  check("超過已知編號後連續查無資料即停止（不無限掃描）", calls.length < 200, true);
  const r2 = await scanIds({ startAfter: 1889, fetchPage: async () => null, delayMs: 0 });
  check("沒有新頁面時lastId維持不變", r2.lastId, 1889);
  check("沒有新頁面時回傳0筆", r2.items.length, 0);
}

console.log("\n=== 花蓮 1887 號公告：用真實 index.html 走完整流程 ===");
{
  const { records } = await readIndexHtml(INDEX_PATH);
  const before = records.length;
  const hasAlready = records.some((r) => r.centralDocNumber === "衛部顧字第1151962366號");
  const res = ingestRaw(records, [{ agency: "花蓮縣衛生局", agencyShort: "花蓮", rawTitle: parsed.title, url: parsed.pdfUrl, fullText: parsed.fullText }], "HL2");
  const rec = records.find((r) => r.centralDocNumber === "衛部顧字第1151962366號");
  check("成功收錄（或併入既有記錄）", !!rec, true);
  check("新增獨立記錄或合併引用其一成立", hasAlready ? res.addedCitations + res.skippedDuplicateCitation >= 1 : records.length === before + 1, true);
  check("title為純主旨且不含轉知", rec.title.includes("轉知") || rec.title.includes("衛福部有關函釋"), false);
  check("citations含花蓮", rec.citations.some((c) => c.agencyShort === "花蓮"), true);
  check("日期為央發文日期2026-07-22", rec.date, "2026-07-22");
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
