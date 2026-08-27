// scraper/fetchers/taitung.mjs
import * as cheerio from "cheerio";

// 已知的 7 個分類頁面代碼；「居家失能相關」分類與「居家服務相關」內容完全重複
// （同一批PDF），故不列入，避免灌入重複資料。若臺東新增分類，把代碼加進來即可。
const CATEGORY_CODES = [
  "XZWKQFJLT9", // 居家服務相關
  "K4J5FJTRS8", // 喘息服務相關
  "2T43G9YF48", // 長照輔具服務相關
  "G8RWZ9SY9J", // 專業服務相關
  "Z3HPAVQNLA", // 身心障礙鑑定相關
  "2Z57XFFPYN"  // 社區整體照顧服務體系-A單位
];
const BASE_URL = "https://ttshbltc.ttshb.gov.tw/pro/unit/detail/";
const AGENCY = "臺東縣衛生局";
const AGENCY_SHORT = "臺東";
const UA = "Mozilla/5.0 (compatible; LTC-Insight-Updater/1.0)";
const REQUEST_DELAY_MS = 800;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCategory(code) {
  const url = BASE_URL + code;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`臺東分類頁 ${code} 抓取失敗 HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const items = [];
  $('a[href*=".pdf"]').each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();
    if (!href || !text) return;
    const url2 = href.startsWith("http") ? href : new URL(href, url).toString();
    items.push({ agency: AGENCY, agencyShort: AGENCY_SHORT, rawTitle: text, url: url2 });
  });
  return items;
}

export async function fetchTaitung() {
  let all = [];
  for (const code of CATEGORY_CODES) {
    try {
      const items = await fetchCategory(code);
      all.push(...items);
    } catch (e) {
      console.error(`  ✗ 臺東分類頁 ${code} 失敗：${e.message}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }
  const seen = new Set();
  all = all.filter((it) => {
    if (seen.has(it.url)) return false;
    seen.add(it.url);
    return true;
  });
  return all;
}
