// api/verify.js
// A tiny fact-check endpoint for TruthBubble.
// Method: GET (simple) or POST (JSON)
//   GET  /api/verify?text=...           -> checks a piece of text
//   POST /api/verify { text, url? }     -> same, JSON body
//
// Env vars you must set in Vercel (Settings → Environment Variables):
//   OPENAI_API_KEY   (required)
//   TAVILY_API_KEY   (optional; if missing we'll skip web search)

export default async function handler(req, res) {
  // --- CORS (so the Android app can call this) ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return res
        .status(500)
        .json({ error: "Server is missing OPENAI_API_KEY. Add it in Vercel → Settings → Environment Variables and redeploy." });
    }

    // Read input (GET ?text=... OR POST {text})
    let text = "";
    if (req.method === "GET") {
      text = (req.query?.text ?? "").toString();
    } else if (req.method === "POST") {
      // Vercel automatically parses JSON for Node functions if content-type is application/json
      text = (req.body?.text ?? "").toString();
    } else {
      return res.status(405).json({ error: "Method not allowed. Use GET or POST." });
    }

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Please provide 'text' to verify." });
    }

    // --- Optional: quick web search with Tavily (if key provided) ---
    let webSummary = "";
    let webSources = [];
    const tavilyKey = process.env.TAVILY_API_KEY;
    if (tavilyKey) {
      try {
        const tavilyResp = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Tavily accepts the API key in the JSON body. If their API changes, this stays harmless.
          body: JSON.stringify({
            api_key: tavilyKey,
            query: text.slice(0, 500),
            search_depth: "basic",
            include_answer: true,
            max_results: 5
          })
        });

        if (tavilyResp.ok) {
          const tjson = await tavilyResp.json();
          // Normalize a few likely shapes
          webSummary = tjson.answer || tjson.summary || "";
          const items = tjson.results || tjson.data || [];
          webSources = items
            .map((r) => ({
              title: r.title || r.source || "source",
              url: r.url || r.link || r.href || ""
            }))
            .filter((s) => s.url);
        }
      } catch (_) {
        // If Tavily fails, we just proceed without sources
      }
    }

    // --- Ask OpenAI to score it (green/yellow/red) using the context ---
    const prompt = `
You are a cautious fact-checking assistant.

Given:
- A social post or claim (POST_TEXT).
- An optional short web-search summary (SEARCH_SUMMARY).
- A few URLs (SOURCES) that might be relevant.

Goal:
- Decide a confidence color for the claim:
  * "green"  = looks accurate / low risk of misinformation
  * "yellow" = uncertain or mixed; needs careful reading / missing context
  * "red"    = likely false or misleading
- Explain your reasoning in 2-4 sentences.
- Return strict JSON with keys: verdict, rationale, sources
  where "sources" is a list of { title, url } taken from input sources or your reasoning.

Return ONLY JSON. No extra text.

POST_TEXT:
${text}

SEARCH_SUMMARY:
${webSummary || "N/A"}

SOURCES:
${JSON.stringify(webSources, null, 2)}
`;

    // Using Chat Completions for widest compatibility
    const oaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: "You return strict JSON only." },
          { role: "user", content: prompt }
        ]
      })
    });

    if (!oaiResp.ok) {
      const errText = await oaiResp.text();
      return res.status(500).json({ error: "OpenAI error", detail: errText });
    }

    const oaiJson = await oaiResp.json();
    const content = oaiJson?.choices?.[0]?.message?.content || "";

    // Try to parse the model's JSON safely
    const json = safeJson(content);
    if (!json) {
      return res.status(500).json({
        error: "Could not parse model output",
        raw: content
      });
    }

    // Normalize output a bit
    const out = {
      verdict: toTraffic(json.verdict),
      rationale: (json.rationale || "").toString(),
      sources: Array.isArray(json.sources)
        ? json.sources
            .map((s) => ({
              title: (s.title || "source").toString(),
              url: (s.url || "").toString()
            }))
            .filter((s) => s.url)
        : webSources
    };

    return res.status(200).json(out);
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: String(err) });
  }
}

// --- helpers ---
function safeJson(s) {
  try {
    // extract first {...} block if there’s extra text
    const m = s.match(/\{[\s\S]*\}/);
    const raw = m ? m[0] : s;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toTraffic(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s.startsWith("g")) return "green";
  if (s.startsWith("y")) return "yellow";
  if (s.startsWith("r")) return "red";
  return "yellow";
}
