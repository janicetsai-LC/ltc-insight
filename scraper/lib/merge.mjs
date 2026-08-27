// scraper/lib/merge.mjs
// 以 centralDocNumber 為主鍵的去重合併引擎，以及 index.html 的讀寫工具
import { readFile, writeFile } from "node:fs/promises";
import { extractCentralDoc } from "./extract.mjs";

const DATA_START_MARKER = "const REAL_DATA_SOURCE = [";
const DATA_END_MARKER_RE = /\n\];\n/;

/** 從 index.html 讀出目前的 REAL_DATA_SOURCE 陣列，回傳 { records, htmlBefore, htmlAfter } */
export async function readIndexHtml(indexPath) {
  const html = await readFile(indexPath, "utf-8");
  const startIdx = html.indexOf(DATA_START_MARKER);
  if (startIdx === -1) throw new Error("找不到 REAL_DATA_SOURCE 起始位置，index.html 結構可能已變更");
  const afterStart = html.slice(startIdx + DATA_START_MARKER.length);
  const endMatch = afterStart.match(DATA_END_MARKER_RE);
  if (!endMatch) throw new Error("找不到 REAL_DATA_SOURCE 結束位置");
  const arrayBody = afterStart.slice(0, endMatch.index);
  const records = eval("[" + arrayBody + "]"); // 資料是我們自己產生的信任內容，非外部輸入
  const htmlBefore = html.slice(0, startIdx);
  const htmlAfter = html.slice(startIdx + DATA_START_MARKER.length + endMatch.index + endMatch[0].length);
  return { records, htmlBefore, htmlAfter };
}

function esc(s) {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function citArr(cits) {
  return (
    "[" +
    cits
      .map(
        (c) =>
          `{agency:"${esc(c.agency)}",agencyShort:"${esc(c.agencyShort)}",date:"${esc(c.date)}",sourceUrl:"${esc(
            c.sourceUrl
          )}",docNumber:"${esc(c.docNumber)}"}`
      )
      .join(",") +
    "]"
  );
}

/** 把 records 陣列序列化回 JS 原始碼字串（給寫回 index.html 用） */
export function serializeRecords(records) {
  const lines = records.map((r) => {
    const fullTextLine = r.fullText ? `,\n    fullText: \`${esc(r.fullText).replace(/`/g, "\\`")}\`` : "";
    return `  {
    id: "${esc(r.id)}",
    agency: "${esc(r.agency)}",
    agencyShort: "${esc(r.agencyShort)}",
    docNumber: "${esc(r.docNumber)}",
    centralDocNumber: "${esc(r.centralDocNumber)}",
    date: "${esc(r.date)}",
    year: ${r.year},
    code: "${esc(r.code)}",
    title: "${esc(r.title)}",
    summary: "${esc(r.summary)}",
    status: "${esc(r.status)}",
    sourceUrl: "${esc(r.sourceUrl)}",
    citations: ${citArr(r.citations)}${fullTextLine}
  }`;
  });
  return DATA_START_MARKER + "\n" + lines.join(",\n") + "\n];\n";
}

/** 把新資料寫回 index.html（保留其餘 HTML/CSS/JS 不動） */
export async function writeIndexHtml(indexPath, records, htmlBefore, htmlAfter) {
  const dataBlock = serializeRecords(records);
  await writeFile(indexPath, htmlBefore + dataBlock + htmlAfter, "utf-8");
}

/**
 * 核心去重合併：把新抓到的 rawRecords 併入既有 existingRecords
 * 規則：
 *  - 若新項目的 centralDocNumber 已存在於既有資料（不論在主記錄或其 citations 裡），
 *    只在對應主記錄的 citations 加入這個機關的引用（避免重複卡片）
 *  - 若是全新央文號，新增為獨立主記錄
 *  - 回傳統計資訊，方便寫更新日誌／PR說明
 */
export function mergeRecords(existingRecords, rawRecords) {
  const byCentralDoc = new Map();
  existingRecords.forEach((r) => {
    if (r.centralDocNumber) byCentralDoc.set(r.centralDocNumber, r);
  });

  let addedNew = 0;
  let addedCitations = 0;
  let skippedDuplicateCitation = 0;

  for (const raw of rawRecords) {
    const centralDocNumber = raw.centralDocNumber || extractCentralDoc(raw.docNumber) || extractCentralDoc(raw.title);
    const citation = raw.citations[0];

    if (centralDocNumber && byCentralDoc.has(centralDocNumber)) {
      const existing = byCentralDoc.get(centralDocNumber);
      const alreadyCited = existing.citations.some(
        (c) => c.sourceUrl === citation.sourceUrl || (c.agencyShort === citation.agencyShort && c.date === citation.date)
      );
      if (!alreadyCited) {
        existing.citations.push(citation);
        addedCitations++;
      } else {
        skippedDuplicateCitation++;
      }
    } else {
      existingRecords.push(raw);
      if (centralDocNumber) byCentralDoc.set(centralDocNumber, raw);
      addedNew++;
    }
  }

  existingRecords.sort((a, b) => b.date.localeCompare(a.date));

  return { addedNew, addedCitations, skippedDuplicateCitation, total: existingRecords.length };
}
