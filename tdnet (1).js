// ─────────────────────────────────────────────
//  需給レーダー ／ データ取得の係（Vercel サーバーレス関数）
//
//  役割：TDnet（適時開示）の最新データを、Vercel のサーバー側で
//        取りに行って、ダッシュボードに返します。
//        サーバー側で取得するため、ブラウザの CORS 制限や
//        外部の中継サーバーの不調に一切左右されません。
//
//  呼び出し先：  https://（あなたのサイト）/api/tdnet
// ─────────────────────────────────────────────

export default async function handler(req, res) {
  // 取得元：やのしん TDnet WEB-API（直近300件）
  const TARGET =
    "https://webapi.yanoshin.jp/webapi/tdnet/list/recent.json?limit=300";

  try {
    const upstream = await fetch(TARGET, {
      headers: {
        // 相手サーバーへの行儀として名乗っておく
        "User-Agent": "jukyu-radar/1.0 (+https://jukyu-radar.vercel.app)",
        "Accept": "application/json",
      },
    });

    if (!upstream.ok) {
      throw new Error("upstream status " + upstream.status);
    }

    const data = await upstream.json();

    // 60秒キャッシュ（相手サーバーに優しく・表示は速く）
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=180");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: "fetch_failed", detail: String(err) });
  }
}
