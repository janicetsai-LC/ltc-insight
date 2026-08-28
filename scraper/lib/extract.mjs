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

// 明確已知的「非函釋」雜訊樣式：網站選單標籤、附件連結的通用錨點文字等。
// 刻意採用「黑名單排除法」而非「關鍵字白名單」：白名單容易誤刪用詞精簡但真實
// 存在的函釋（例如「衛福部函釋-門A款」這類臺東縣網站的簡短標題），漏抓垃圾內容
// 遠比誤刪真實資料安全，寧可漏放過幾筆雜訊、也不要錯殺真實函釋。
const JUNK_EXACT_TITLES = new Set([
  "活動資訊", "樂齡長青健康檢查", "公費HPV疫苗專區", "婦女人類乳突病毒(HPV)檢測",
  "成人預防保健", "人民申請案件項目暨期限", "青少年檳榔健康危害防制",
  "糞便抗原檢測胃幽門螺旋桿菌服務", "戒菸服務", "長者功能評估", "檔案應用專區",
  "檔案研究集錦", "更年期保健", "新生兒聽力篩檢", "基本資訊及業務職掌",
  "幼兒專責醫師制度", "公益揭弊者保護法宣導專區", "補助私人團體報表",
  "驗光所設立資訊包", "中心服務介紹", "衛生業務補助專區", "宣導海報及單張專區",
  "油症患者就醫注意事項", "資源下載", "認識油症", "交通及停車資訊", "服務中心",
  "宗旨與願景", "中央各機關補助報表", "臺中市統計資料查詢平臺",
  "本市醫療院所門診及假日門診即時查詢", "組織架構", "診所設立資訊包",
  "二代健保報您知", "資訊安全政策", "政府網站資料開放宣告", "隱私權政策",
  "請託關說登錄查察專區"
]);
// 附件連結常見的通用錨點文字（本身不是真正的公文標題，是連結顯示文字）
const JUNK_PATTERN_RE = /^(附件\d*|衛生福利部|\.pdf|桃園市政府函文)$/i;
// 特定類別的一般衛生業務宣導公告，標題常隨年度/主題變動而無法窮舉，改用模式比對
// （癌症篩檢、菸害防制等屬於衛生局例行公衛宣導業務，非長照給付相關）
const JUNK_TOPIC_RE = /癌症篩檢|菸消雲散|戒菸(?!.*長照)|檳榔健康危害|新生兒聽力篩檢|更年期保健/;

/** 判斷一段文字是否為已知的網站選單／附件錨點雜訊（而非真正的函釋標題） */
export function isJunkTitle(text) {
  if (!text) return true;
  const t = text.trim();
  if (JUNK_EXACT_TITLES.has(t)) return true;
  if (JUNK_PATTERN_RE.test(t)) return true;
  if (JUNK_TOPIC_RE.test(t)) return true;
  return false;
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

  // 只過濾掉明確已知的網站選單／附件錨點雜訊，不做關鍵字式的內容相關性判斷
  // （避免像「衛福部函釋-門A款」這種用詞精簡但真實存在的函釋被誤刪）
  if (isJunkTitle(subject) || isJunkTitle(raw.rawTitle)) return null;

  const date = raw.date || extractDate(raw.rawTitle) || "2020-01-01";
  const code = extractCode(raw.rawTitle);
  // 若查不到正式文號識別資訊，退回使用「已清過轉知字樣的主旨」而非原始文字，
  // 避免「轉知」等雜訊透過這個 fallback 路徑漏進資料庫
  const docNumber = identifier || subject;
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
