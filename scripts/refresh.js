// Run by the GitHub Action on a schedule (see .github/workflows/refresh.yml).
// Builds data/biotech-data.json: every EDGAR-classified biotech company
// that has a public ticker, with latest price, cash position, burn rate,
// and any clinical trial readout due in the next 4 months.
//
// Run locally with:  SEC_USER_AGENT="YourApp you@email.com" node scripts/refresh.js

const fs = require('fs');
const path = require('path');
const { fetchBiotechUniverse, fetchTickerMap, fetchCashAndBurn, sleep } = require('./lib/sec');
const { fetchNearTermTrialCatalysts } = require('./lib/trials');
const { fetchLatestClose } = require('./lib/price');

const OUT_PATH = path.join(__dirname, '..', 'data', 'biotech-data.json');
const DELAY_MS = 120; // stay well under SEC's 10 req/sec guidance

async function main() {
  console.log('Fetching biotech universe from EDGAR (SIC 8731, 2836)...');
  const universe = await fetchBiotechUniverse();
  console.log(`Found ${universe.length} companies classified as biotech.`);

  console.log('Fetching CIK -> ticker map...');
  const tickerMap = await fetchTickerMap();

  // Only keep companies that actually have a public ticker
  const withTickers = universe
    .map((c) => {
      const t = tickerMap.get(String(c.cik));
      return t ? { cik: c.cik, name: t.title || c.name, ticker: t.ticker } : null;
    })
    .filter(Boolean);

  console.log(`${withTickers.length} have a public ticker. Enriching each (this takes a while)...`);

  const results = [];
  let i = 0;
  for (const co of withTickers) {
    i += 1;
    if (i % 25 === 0) console.log(`  ...${i}/${withTickers.length}`);

    const [priceVal, cashInfo, catalysts] = await Promise.all([
      fetchLatestClose(co.ticker),
      fetchCashAndBurn(co.cik),
      fetchNearTermTrialCatalysts(co.name, 4),
    ]);

    let runwayMonths = null;
    if (cashInfo.cash != null && cashInfo.quarterlyBurn != null && cashInfo.quarterlyBurn < 0) {
      const monthlyBurn = Math.abs(cashInfo.quarterlyBurn) / 3;
      const totalCash = cashInfo.cash + (cashInfo.shortTermInvestments || 0);
      runwayMonths = monthlyBurn > 0 ? Math.round((totalCash / monthlyBurn) * 10) / 10 : null;
    }

    results.push({
      ticker: co.ticker,
      name: co.name,
      cik: co.cik,
      price: priceVal,
      cash: cashInfo.cash,
      cashAsOf: cashInfo.cashAsOf,
      shortTermInvestments: cashInfo.shortTermInvestments,
      totalCashPosition:
        cashInfo.cash != null ? cashInfo.cash + (cashInfo.shortTermInvestments || 0) : null,
      estimatedRunwayMonths: runwayMonths,
      nearTermCatalysts: catalysts,
      catalystCount: catalysts.length,
    });

    await sleep(DELAY_MS);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    totalCompanies: results.length,
    companies: results,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${results.length} companies to ${OUT_PATH}`);
}

main().catch((e) => {
  console.error('Refresh failed:', e);
  process.exit(1);
});
