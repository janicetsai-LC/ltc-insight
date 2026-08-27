// scraper/fetchers/nantou.mjs
import * as cheerio from "cheerio";

// 已知的分類頁面 ID（單頁全列表，無分頁）。若南投衛生局之後新增分類頁面，
// 只要把新的 Parser ID 加進這個陣列即可，其餘邏輯不用改。
const CATEGORY_IDS = ["957", "948", "953", "954", "955", "956", "1099", "2773"];
const BASE_URL = "https://www.ntshb.gov.tw/form/Details?Parser=28,6,55,,,,";
const AGENCY = "南投縣政府衛生局";
const AGENCY_SHORT = "南投";
const UA = "Mozilla/5.0 (compatible; LTC-Insight-Updater/1.0)";
const REQUEST_DELAY_MS = 800;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCategory(id) {
  const url = BASE_URL + id;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`南投分類頁 ${id} 抓取失敗 HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const items = [];
  $('a[href*="df_ufiles"]').each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();
    if (!href || !text) return;
    const url2 = href.startsWith("http") ? href : new URL(href, url).toString();
    items.push({ agency: AGENCY, agencyShort: AGENCY_SHORT, rawTitle: text, url: url2 });
  });
  return items;
}

export async function fetchNantou() {
  let all = [];
  for (const id of CATEGORY_IDS) {
    try {
      const items = await fetchCategory(id);
      all.push(...items);
    } catch (e) {
      console.error(`  ✗ 南投分類頁 ${id} 失敗：${e.message}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }
  // 跨分類頁常見同一份函被重複收錄，先用 URL 去重
  const seen = new Set();
  all = all.filter((it) => {
    if (seen.has(it.url)) return false;
    seen.add(it.url);
    return true;
  });
  return all;
}
