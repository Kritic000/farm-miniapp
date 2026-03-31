export default async function handler(req, res) {
  try {
    const GS_API_URL = process.env.GS_API_URL;
    const GS_API_TOKEN = process.env.GS_API_TOKEN;

    if (!GS_API_URL) {
      res.status(500).json({ error: "Missing GS_API_URL env var" });
      return;
    }

    if (!GS_API_TOKEN) {
      res.status(500).json({ error: "Missing GS_API_TOKEN env var" });
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.status(200).send("ok");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : (req.body || {});

    body.token = GS_API_TOKEN;

    const r = await fetch(`${GS_API_URL}?action=order`, {
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
