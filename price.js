const { fetchTickerMap, fetchCashAndBurn } = require('../scripts/lib/sec');
const { fetchNearTermTrialCatalysts } = require('../scripts/lib/trials');
const { fetchLatestClose } = require('../scripts/lib/price');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { query } = req.body || {};
  if (!query) return res.status(400).json({ error: 'Missing query (ticker or company name)' });

  try {
    // 1. Resolve to a ticker/CIK using SEC's own bulk ticker file
    const tickerMap = await fetchTickerMap();
    const needle = query.trim().toLowerCase();
    let match = null;
    for (const [cik, info] of tickerMap.entries()) {
      if (info.ticker.toLowerCase() === needle || info.title.toLowerCase().includes(needle)) {
        match = { cik, ...info };
        if (info.ticker.toLowerCase() === needle) break; // exact ticker match wins
      }
    }
    if (!match) return res.status(404).json({ error: `Could not find a public company matching "${query}"` });

    // 2. Pull structured data straight from SEC + ClinicalTrials.gov
    const [price, cashInfo, catalysts] = await Promise.all([
      fetchLatestClose(match.ticker),
      fetchCashAndBurn(match.cik),
      fetchNearTermTrialCatalysts(match.title, 4),
    ]);

    let runwayMonths = null;
    if (cashInfo.cash != null && cashInfo.quarterlyBurn != null && cashInfo.quarterlyBurn < 0) {
      const monthlyBurn = Math.abs(cashInfo.quarterlyBurn) / 3;
      const totalCash = cashInfo.cash + (cashInfo.shortTermInvestments || 0);
      runwayMonths = monthlyBurn > 0 ? Math.round((totalCash / monthlyBurn) * 10) / 10 : null;
    }

    const structured = {
      ticker: match.ticker,
      name: match.title,
      price,
      cash: cashInfo.cash,
      cashAsOf: cashInfo.cashAsOf,
      shortTermInvestments: cashInfo.shortTermInvestments,
      estimatedRunwayMonths: runwayMonths,
      trialCatalysts: catalysts,
    };

    // 3. Hand the grounded numbers to Claude + web search to fill in
    //    PDUFA dates, partnership news, and anything SEC/CT.gov structured
    //    data doesn't capture, and to write the narrative.
    const systemPrompt = `You are a biotech research assistant. You have been given VERIFIED structured data pulled directly from SEC EDGAR and ClinicalTrials.gov for one company — treat these numbers as ground truth, do not contradict them. Use web search ONLY to find: (1) any near-term catalyst in the next 1-4 months not already listed (FDA decision/PDUFA dates, conference data presentations, partnership decisions, earnings dates), and (2) brief context on what the company does. Then output ONLY a single JSON object, no markdown fences, no preamble, matching:

{
  "company_name": string,
  "ticker": string,
  "price": number or null,
  "cash_position": string (human readable, e.g. "$142.3M cash + short-term investments as of Q1 2026"),
  "estimated_runway_months": number or null,
  "near_term_catalysts": [ {"catalyst": string, "expected_window": string, "source": string} ],
  "summary": string (3-4 sentences plain language),
  "sources": [ {"name": string, "url": string} ]
}

Never give a buy/sell/hold recommendation. If you cannot verify a catalyst date with a real source, do not include it.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Verified structured data:\n${JSON.stringify(structured, null, 2)}\n\nResearch and brief me on ${match.title} (${match.ticker}).`,
          },
        ],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Anthropic API error' });

    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
