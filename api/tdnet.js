export default async function handler(req, res) {
  const TARGET =
    "https://webapi.yanoshin.jp/webapi/tdnet/list/recent.json?limit=100";

  try {
    const upstream = await fetch(TARGET, {
      headers: {
        "User-Agent": "jukyu-radar/1.0 (+https://jukyu-radar.vercel.app)",
        "Accept": "application/json",
      },
    });

    if (!upstream.ok) {
      throw new Error("upstream status " + upstream.status);
    }

    const data = await upstream.json();

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=180");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: "fetch_failed", detail: String(err) });
  }
}
