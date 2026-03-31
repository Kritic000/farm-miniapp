export default async function handler(req, res) {
  try {
    const GS_API_URL = process.env.GS_API_URL;
    const GS_API_TOKEN = process.env.GS_API_TOKEN;

    if (!GS_API_URL) {
      return res.status(500).json({ error: "Missing GS_API_URL env var" });
    }

    if (!GS_API_TOKEN) {
      return res.status(500).json({ error: "Missing GS_API_TOKEN env var" });
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      return res.status(200).send("ok");
    }

    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const tgUserId = req.query.tgUserId || "";
    const phone = req.query.phone || "";
    const limit = req.query.limit || "30";

    const url =
      `${GS_API_URL}?action=orders` +
      `&token=${encodeURIComponent(GS_API_TOKEN)}` +
      `&tgUserId=${encodeURIComponent(tgUserId)}` +
      `&phone=${encodeURIComponent(phone)}` +
      `&limit=${encodeURIComponent(limit)}`;

    const r = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const text = await r.text();
    res.status(r.status).send(text);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
