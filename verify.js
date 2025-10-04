// File: api/verify.js
// This is a Vercel Serverless Function. It receives { text } and returns a verdict JSON.
// It's a simple starter you can deploy now. Later you can replace the heuristics
// with your “real” verification logic and real sources.

export default async function handler(req, res) {
  // CORS headers so you can test from anywhere (safe defaults)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST with JSON body { text: string }" });
  }

  try {
    const { text } = req.body ?? {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Please provide 'text' to verify." });
    }

    // --- super simple scoring (replace later with your real logic) ---
    const t = text.toLowerCase();
    let score = 0.5;
    const reasons = [];
    const sources = [];

    if (t.includes("forward this") || t.includes("whatsapp")) {
      score -= 0.2;
      reasons.push("Chain-forward language detected");
      sources.push({
        title: "Common WhatsApp hoax patterns (IFCN)",
        url: "https://www.poynter.org/ifcn/",
      });
    }
    if (t.includes("breaking") || t.includes("shocking")) {
      score -= 0.1;
      reasons.push("Sensational phrasing detected");
    }
    if (t.includes("according to") || t.includes("reported by") || t.includes("says")) {
      score += 0.1;
      reasons.push("Claim references a source");
    }
    const digits = (t.match(/\d/g) || []).length;
    if (digits > 10) {
      score += 0.05;
      reasons.push("Contains specific numbers");
    }

    // clamp score between 0 and 1
    score = Math.max(0, Math.min(1, score));

    // map score -> label/color
    let label, color;
    if (score >= 0.75) {
      label = "Likely True"; color = "green";
    } else if (score <= 0.35) {
      label = "Likely False"; color = "red";
    } else {
      label = "Needs Review"; color = "yellow";
    }

    if (reasons.length === 0) reasons.push("Insufficient evidence; needs review");

    // --- THIS response shape is what the ANDROID APP expects ---
    return res.status(200).json({
      label,
      confidence: score,
      reasons,
      color,
      // can be [{ title, url }, ...] OR just ["https://…", "https://…"]
      sources,
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e) });
  }
}
