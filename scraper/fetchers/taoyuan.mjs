// scraper/fetchers/taoyuan.mjs
import * as cheerio from "cheerio";

const LIST_URL = "https://care.tycg.gov.tw/cp.aspx?n=412";
const AGENCY = "桃園市政府衛生局";
const AGENCY_SHORT = "桃園";
const UA = "Mozilla/5.0 (compatible; LTC-Insight-Updater/1.0)";

export async function fetchTaoyuan() {
  const res = await fetch(LIST_URL, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`桃園頁面抓取失敗 HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const items = [];
  const seen = new Set();
  $('a[href*=".pdf"]').each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();
    if (!href || !text) return;
    const url = href.startsWith("http") ? href : new URL(href, LIST_URL).toString();
    if (seen.has(url)) return;
    seen.add(url);
    items.push({ agency: AGENCY, agencyShort: AGENCY_SHORT, rawTitle: text, url });
  });

  return items;
}
