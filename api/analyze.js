export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const { imageBase64 } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: "No image received" });
    }

    // TEMPORARY fake analysis (Phase 1)
    return res.status(200).json({
      verdict: "MISLEADING",
      confidence: 0.76,
      explanation:
        "This is a placeholder analysis. The backend successfully received the image and processed the request.",
    });
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: err.message,
    });
  }
}
