// scraper/fetchers/taichung.mjs
// 台中二階段抓取：列表頁（分頁）→ 內文頁（全文＋PDF附件）
//
// 重要：/1617526/Lpsimplelist?Page=N 這個短網址格式會被 robots.txt 擋掉，
// 必須用完整路徑格式，且 PageSize 要排在 Page 前面，才不會被擋：
//   /26198/1614263/1617520/1617525/1617526?PageSize=30&Page=N&type=
import * as cheerio from "cheerio";

const LIST_BASE = "https://www.health.taichung.gov.tw/26198/1614263/1617520/1617525/1617526";
const PAGE_SIZE = 30;
const TOTAL_PAGES = 5; // 共約147筆，每頁30筆；若台中之後總筆數變多，這裡要調整
const AGENCY = "臺中市政府衛生局";
const AGENCY_SHORT = "台中";
const UA = "Mozilla/5.0 (compatible; LTC-Insight-Updater/1.0)";
const REQUEST_DELAY_MS = 800;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchListPage(pageNum) {
  const url = `${LIST_BASE}?PageSize=${PAGE_SIZE}&Page=${pageNum}&type=`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const items = [];
  $('a[href*="/post"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href || !/\/\d+\/post$/.test(href)) return;
    const rawText = $(el).text().trim();
    if (!rawText) return;
    const dateMatch = rawText.match(/(\d{4}-\d{2}-\d{2})\s*$/);
    const listDate = dateMatch ? dateMatch[1] : null;
    const title = dateMatch ? rawText.slice(0, dateMatch.index).trim() : rawText;
    const cleanTitle = title.replace(/^\d+(?=[^\d])/, "").trim();
    const absoluteUrl = href.startsWith("http") ? href : new URL(href, "https://www.health.taichung.gov.tw").toString();
    items.push({ title: cleanTitle, listDate, detailUrl: absoluteUrl });
  });

  const seen = new Set();
  return items.filter((it) => {
    if (seen.has(it.detailUrl)) return false;
    seen.add(it.detailUrl);
    return true;
  });
}

async function fetchDetail(item) {
  const html = await fetchHtml(item.detailUrl);
  const $ = cheerio.load(html);

  let fullText = "";
  $("body").find("p").each((_, el) => {
    const t = $(el).text().trim();
    if (/^[一二三四五六七八九十]、/.test(t) && t.length > 10) fullText += t + "\n";
  });
  fullText = fullText.trim();
  if (!fullText) {
    const bodyPlainText = $("body").text();
    const clauseMatches = bodyPlainText.match(/[一二三四五六七八九十]、[^一二三四五六七八九十]{10,}?(?=[一二三四五六七八九十]、|檔案下載|發布單位|$)/g);
    if (clauseMatches) fullText = clauseMatches.map((s) => s.trim()).join("\n");
  }

  const pdfLinks = [];
  $('a[href*="/media/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href && /\.pdf($|\?)/i.test(href)) pdfLinks.push(href.startsWith("http") ? href : new URL(href, item.detailUrl).toString());
  });

  const bodyText = $("body").text();
  const publishDateMatch = bodyText.match(/發布日期[：:]\s*(\d{4}-\d{2}-\d{2})/);

  return {
    title: item.title,
    fullText: fullText || null,
    pdfUrl: pdfLinks[0] || null,
    detailUrl: item.detailUrl,
    publishDate: publishDateMatch ? publishDateMatch[1] : item.listDate
  };
}

export async function fetchTaichung({ pages = null } = {}) {
  const pageNums = pages || Array.from({ length: TOTAL_PAGES }, (_, i) => i + 1);
  let listItems = [];
  for (const p of pageNums) {
    try {
      const items = await fetchListPage(p);
      listItems.push(...items);
    } catch (e) {
      console.error(`  ✗ 台中第 ${p} 頁抓取失敗：${e.message}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  const seenUrls = new Set();
  listItems = listItems.filter((it) => {
    if (seenUrls.has(it.detailUrl)) return false;
    seenUrls.add(it.detailUrl);
    return true;
  });

  const results = [];
  for (const item of listItems) {
    try {
      const detail = await fetchDetail(item);
      results.push({
        agency: AGENCY,
        agencyShort: AGENCY_SHORT,
        rawTitle: detail.title,
        date: detail.publishDate,
        url: detail.pdfUrl || detail.detailUrl,
        fullText: detail.fullText || undefined
      });
    } catch (e) {
      console.error(`  ✗ 內文頁抓取失敗 ${item.detailUrl}：${e.message}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }
  return results;
}
