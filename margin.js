// ─────────────────────────────────────────────
//  需給レーダー ／ 貸借・信用区分の取得係（Vercel サーバーレス関数）
//
//  役割：JPX「制度信用・貸借銘柄一覧」のページを見に行き、
//        最新の Excel（例：20261001_list.xlsx）を自動で見つけて読み込み、
//        「銘柄コード → 貸借 / 信用」の表にしてダウンロードせずに返します。
//        → 毎月の手作業アップロードは不要。月初に自動で新しい版になります。
//
//  呼び出し先：  https://（あなたのサイト）/api/margin
//  返す形：      { asof:"2026-10-01", map:{ "1301":"T", "130A":"S", ... } }
//               T=貸借銘柄 / S=制度信用銘柄 / N=非制度信用銘柄
// ─────────────────────────────────────────────
import { inflateRawSync } from "zlib";

const PAGE = "https://www.jpx.co.jp/listing/others/margin/index.html";
const UA = "jukyu-radar/1.0 (+https://jukyu-radar.vercel.app)";

export default async function handler(req, res) {
  try {
    // ① 一覧ページから最新Excelのリンクを探す
    const html = await (await fetch(PAGE, { headers: { "User-Agent": UA } })).text();
    const links = [...html.matchAll(/href="([^"]*?(\d{8})_list\.xlsx)"/g)];
    if (!links.length) throw new Error("list link not found");
    links.sort((a, b) => b[2].localeCompare(a[2]));          // 日付が新しい順
    const fileUrl = new URL(links[0][1], PAGE).href;
    const ymd = links[0][2];

    // ② Excel をダウンロードして読む
    const buf = Buffer.from(await (await fetch(fileUrl, { headers: { "User-Agent": UA } })).arrayBuffer());
    const map = parseMarginXlsx(buf);
    if (Object.keys(map).length < 1000) throw new Error("too few rows");

    // 6時間キャッシュ（JPXに優しく）。古い版でも1日は表示を続ける
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      asof: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`,
      source: fileUrl,
      map,
    });
  } catch (err) {
    res.status(502).json({ error: "fetch_failed", detail: String(err) });
  }
}

// ---- ここから下は Excel(xlsx) を読むための部品（外部ライブラリ不要） ----

// xlsx は zip なので、必要なファイルだけ取り出す
export function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    const lstart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(lstart, lstart + csize);
    files[name] = () => (method === 8 ? inflateRawSync(raw) : raw).toString("utf8");
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

function xmlText(s) {
  return s.replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

export function parseMarginXlsx(buf) {
  const files = unzip(buf);
  const shared = [];
  if (files["xl/sharedStrings.xml"]) {
    for (const m of files["xl/sharedStrings.xml"]().matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const ts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("");
      shared.push(xmlText(ts));
    }
  }
  const sheetName = Object.keys(files).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  const xml = files[sheetName]();
  const KIND = { "貸借銘柄": "T", "制度信用銘柄": "S", "非制度信用銘柄": "N" };
  const map = {};
  for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {};
    for (const c of row[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = (c[1].match(/r="([A-Z]+)\d+"/) || [])[1];
      const type = (c[1].match(/t="([^"]+)"/) || [])[1];
      const body = c[2] || "";
      let v;
      if (type === "s") v = shared[+((body.match(/<v>([\s\S]*?)<\/v>/) || [])[1])];
      else if (type === "inlineStr") v = xmlText((body.match(/<is>([\s\S]*?)<\/is>/) || [])[1] || "");
      else v = xmlText((body.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || "");
      if (ref) cells[ref] = (v || "").trim();
    }
    const code = (cells.A || "").toUpperCase();
    const kind = KIND[cells.D];
    if (/^[0-9A-Z]{4,5}$/.test(code) && kind) map[code] = kind;
  }
  return map;
}
