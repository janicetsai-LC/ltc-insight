// scraper/lib/extract.mjs
// 共用的文字萃取工具：央文號、日期、碼別、主旨清理
// 所有 fetcher 都應該用這裡的函式，確保萃取邏輯一致（避免像之前那樣，
// 不同批次資料用不同規則導致同一份央文號被誤判成兩筆）

/** 從文字中萃取衛福部等中央機關文號，並正規化（去除結尾單一英文字母修正碼） */
export function extractCentralDoc(text) {
  if (!text) return "";
  const m =
    text.match(/衛部\S{0,4}字第[0-9A-Za-z]+號/) ||
    text.match(/[一-龥]{2,6}字第[0-9A-Za-z]+號/); // 涵蓋 疾管感字、勞動發管字、府社障字 等其他中央/地方機關文號
  if (!m) return "";
  return m[0].replace(/([0-9])[A-Za-z]號$/, "$1號");
}

/** 民國年轉西元年，並輸出 YYYY-MM-DD；支援「115年8月10日」與「115.08.10」兩種格式 */
export function extractDate(text) {
  if (!text) return null;
  let m = text.match(/(\d{2,3})年(\d{1,2})月(\d{1,2})日/);
  if (m) return `${parseInt(m[1], 10) + 1911}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = text.match(/(\d{2,3})[.](\d{1,2})[.](\d{1,2})/);
  if (m) return `${parseInt(m[1], 10) + 1911}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return null;
}

/** 從標題中萃取具體服務碼別（如 GA05、BA13、AA06），找不到則回傳 OTHER */
export function extractCode(text) {
  if (!text) return "OTHER";
  const m = text.match(/\b([A-Z]{1,2}\d{2})\b/);
  return m ? m[1] : "OTHER";
}

// 公文識別資訊前綴：機關名稱(可省略)＋日期(可省略)＋XX字第XXXX號＋函/令/書函(可省略)
const DOC_PREFIX_RE =
  /^(?:[\u4e00-\u9fa5]{2,15})?\s*(?:\d{2,3}[.年]\s*\d{1,2}[.月]\s*\d{1,2}日?)?\s*[\u4e00-\u9fa5]{2,6}字第[0-9A-Za-z]+號(?:函|令|書函)?[\s\-_：:、,，]*/;

/** 把「機關+日期+文號+主旨」的原始標題，拆成 { identifier, subject } 兩部分 */
export function splitDocAndSubject(text) {
  if (!text) return { identifier: "", subject: text || "" };
  const m = text.match(DOC_PREFIX_RE);
  if (!m || m[0].trim().length < 6) return { identifier: "", subject: text };
  const identifier = m[0].replace(/[\s\-_：:、,，]+$/, "");
  const subject = text.slice(m[0].length).trim();
  return { identifier, subject: subject || text };
}

/** 移除「轉知」字樣及其後可能殘留的標點 */
export function stripZhuanZhi(text) {
  if (!text) return text;
  let t = text.replace(/轉知/g, "");
  t = t.replace(/^[：:、\s]+/, "").trim();
  return t;
}

/**
 * 統一的標題清理管線：先去轉知字樣，再拆出主旨
 * 回傳 { identifier, subject }，subject 就是應該存進 title 欄位的乾淨主旨
 */
export function normalizeTitle(rawTitle) {
  const noZhuanZhi = stripZhuanZhi(rawTitle);
  return splitDocAndSubject(noZhuanZhi);
}

function truncate(text, max = 95) {
  const t = text || "";
  return t.length > max ? t.slice(0, max) + "…" : t;
}

/**
 * 把單一 fetcher 抓到的原始項目，轉換成 REAL_DATA_SOURCE 相容的完整紀錄
 * raw: { agency, agencyShort, rawTitle, date?, url, fullText? }
 * idPrefix: 用於產生唯一 id 的前綴，如 "TAOY"
 */
export function toRecord(raw, idPrefix, idx) {
  const { identifier, subject } = normalizeTitle(raw.rawTitle);
  const centralDocNumber = extractCentralDoc(raw.rawTitle) || extractCentralDoc(identifier);
  const date = raw.date || extractDate(raw.rawTitle) || "2020-01-01";
  const code = extractCode(raw.rawTitle);
  const docNumber = identifier || raw.rawTitle;
  const title = subject;

  const record = {
    id: `${idPrefix}-${String(idx).padStart(4, "0")}`,
    agency: raw.agency,
    agencyShort: raw.agencyShort,
    docNumber,
    centralDocNumber,
    date,
    year: parseInt(date.slice(0, 4), 10),
    code,
    title,
    summary: truncate(title),
    status: "有效",
    sourceUrl: raw.url,
    citations: [
      { agency: raw.agency, agencyShort: raw.agencyShort, date, sourceUrl: raw.url, docNumber }
    ]
  };
  if (raw.fullText) record.fullText = raw.fullText;
  return record;
}
