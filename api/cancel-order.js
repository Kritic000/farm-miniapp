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
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      return res.status(200).send("ok");
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : (req.body || {});

    body.token = GS_API_TOKEN;
    body.action = "cancelOrder";

    const r = await fetch(GS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await r.text();
    res.status(r.status).send(text);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
