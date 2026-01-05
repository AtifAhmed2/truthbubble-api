import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  // Basic CORS (helps Android sometimes)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const image_base64 = body?.image_base64;
    if (!image_base64 || typeof image_base64 !== "string") {
      return res.status(400).json({
        error: "Missing or invalid 'image_base64' in JSON body",
        expected: { image_base64: "BASE64_STRING" },
      });
    }

    // If Android accidentally sends "data:image/...;base64,XXXX", we still handle it.
    const cleaned = image_base64.includes("base64,")
      ? image_base64.split("base64,")[1]
      : image_base64;

    const dataUrl = `data:image/jpeg;base64,${cleaned}`;

    const system = `You are a fact-checking assistant.
You will receive an Instagram screenshot (image).
Your job:
1) Extract the main claim(s) from the image text.
2) Judge whether the claims are TRUE / MISLEADING / FALSE / UNVERIFIABLE.
3) Provide a short explanation with reasoning.
4) If you cannot verify without sources, say UNVERIFIABLE and explain what is missing.

Return STRICT JSON only:
{
  "verdict": "TRUE|MISLEADING|FALSE|UNVERIFIABLE",
  "claim": "one sentence claim",
  "explanation": "3-6 lines explanation"
}`;

    const userText =
      "Analyze this Instagram screenshot. Identify the main claim and return verdict.";

    const result = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "input_text", text: userText },
            { type: "input_image", image_url: dataUrl },
          ],
        },
      ],
    });

    const raw = result.output_text?.trim() || "";

    // Try to parse strict JSON
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      // If model returns extra text, we still return a safe wrapper
      return res.status(200).json({
        verdict: "UNVERIFIABLE",
        claim: "Could not parse claim reliably",
        explanation:
          "The AI response was not valid JSON. Please retry. (We can tighten formatting next.)",
        raw,
      });
    }

    // Ensure fields exist
    const verdict = parsed.verdict || "UNVERIFIABLE";
    const claim = parsed.claim || "";
    const explanation = parsed.explanation || "";

    return res.status(200).json({ verdict, claim, explanation });
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      message: err?.message || String(err),
    });
  }
}
