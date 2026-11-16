// scraper/fetchers/hualien.mjs
// 花蓮縣長期照顧管理中心：https://long-term.hlshb.gov.tw
//
// 該站的「列表頁」（/news/1、/note/…）是前端框架動態載入（原始 HTML 只有 {{item.title}} 樣板），
// 靜態抓取拿不到清單；但「單篇內文頁」（/news/detail/{編號}）是完整的伺服器端渲染。
// 因此改用「依編號逐篇探測」：從上次掃描到的編號往後掃，連續多筆查無資料即停止。
// 掃描進度記錄在 scraper/state/hualien.json，由 update-all.mjs 在成功寫入後更新。
import * as cheerio from "cheerio";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://long-term.hlshb.gov.tw";
// 內文頁路徑：news 已實測可用；note（長照解釋函）為依站內導覽推測的同型路徑，查無時自動視為未命中
const SECTIONS = ["news", "note"];
const AGENCY = "花蓮縣衛生局";
const AGENCY_SHORT = "花蓮";
const UA = "Mozilla/5.0 (compatible; LTC-Insight-Updater/1.0)";

const KNOWN_ID_FLOOR = 1887;   // 已確認存在的內文頁編號（news/detail/1887）；掃描至少要超過此值才允許提前停止
const MAX_CONSECUTIVE_MISS = 60; // 超過已知編號後，連續這麼多筆查無資料即視為已到尾端
const CONCURRENCY = 4;
const BATCH_DELAY_MS = 400;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, "..", "state", "hualien.json");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 解析單篇內文頁；查無有效標題（h2）時回傳 null（視為未命中） */
export function parseDetail(html, detailUrl) {
  const $ = cheerio.load(html);
  const title = $("h2").first().text().replace(/\s+/g, " ").trim();
  if (!title) return null;

  let fullText = "";
  $("p").each((_, el) => {
    const t = $(el).text().trim();
    if (/^(?:[一二三四五六七八九十]、|[（(][一二三四五六七八九十][）)])/.test(t) && t.length > 6) {
      fullText += t + "\n";
    }
  });

  let pdfUrl = null;
  $('a[href*="/img/files/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!pdfUrl && href && /\.pdf($|\?)/i.test(href)) pdfUrl = new URL(href, detailUrl).toString();
  });

  return { title, fullText: fullText.trim() || undefined, pdfUrl };
}

async function fetchDetailPage(id) {
  for (const section of SECTIONS) {
    const url = `${BASE}/${section}/detail/${id}`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) continue;
      const parsed = parseDetail(await res.text(), url);
      if (parsed) return { ...parsed, detailUrl: url };
    } catch {
      // 單篇失敗視為未命中，不中斷整體掃描
    }
  }
  return null;
}

/**
 * 依編號掃描。fetchPage 可注入（測試用）。
 * 回傳 { items, lastId }：lastId 為本次掃描中最大的有效頁面編號（沒有任何命中則維持 startAfter）
 */
export async function scanIds({ startAfter, fetchPage = fetchDetailPage, delayMs = BATCH_DELAY_MS }) {
  const items = [];
  let lastId = startAfter;
  let consecutiveMiss = 0;
  let id = startAfter + 1;

  while (true) {
    const ids = Array.from({ length: CONCURRENCY }, (_, i) => id + i);
    const pages = await Promise.all(ids.map((n) => fetchPage(n)));
    for (let i = 0; i < ids.length; i++) {
      const n = ids[i];
      const page = pages[i];
      if (page) {
        consecutiveMiss = 0;
        lastId = Math.max(lastId, n);
        items.push({
          agency: AGENCY,
          agencyShort: AGENCY_SHORT,
          rawTitle: page.title,
          url: page.pdfUrl || page.detailUrl,
          fullText: page.fullText
        });
      } else {
        consecutiveMiss++;
      }
    }
    id += CONCURRENCY;
    if (id > KNOWN_ID_FLOOR && consecutiveMiss >= MAX_CONSECUTIVE_MISS) break;
    if (delayMs) await sleep(delayMs);
  }
  return { items, lastId };
}

async function readState() {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf-8"));
  } catch {
    return { lastId: 0 };
  }
}

let pendingLastId = null;

export async function fetchHualien() {
  const state = await readState();
  console.log(`  花蓮：由編號 ${state.lastId + 1} 起探測內文頁`);
  const { items, lastId } = await scanIds({ startAfter: state.lastId });
  pendingLastId = lastId;
  console.log(`  花蓮：掃描至編號 ${lastId}，取得 ${items.length} 篇內文頁`);
  return items;
}

/** 在 index.html 成功寫入後呼叫，才把掃描進度存檔（失敗/dry-run 時不更新，下次會重掃） */
export async function commitHualienState() {
  if (pendingLastId == null) return;
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify({ lastId: pendingLastId }, null, 2) + "\n", "utf-8");
}
