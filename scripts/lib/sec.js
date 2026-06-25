// SEC EDGAR is free, no API key, but REQUIRES a descriptive User-Agent
// with a real contact (it will start blocking/throttling you otherwise).
// Set this via env var SEC_USER_AGENT, e.g. "BiotechScreener you@example.com"
const UA = process.env.SEC_USER_AGENT || 'BiotechScreener contact@example.com';

const HEADERS = { 'User-Agent': UA, 'Accept-Encoding': 'gzip,deflate' };

// Be polite: SEC asks for <=10 req/sec. We go well under that.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

// --- 1. Universe by SIC code (free, no key) ---------------------------
// SIC 8731 = Services-Commercial Physical & Biological Research
// SIC 2836 = Biological Products (No Diagnostic Substances)
// These two SIC codes are the standard classification for clinical-stage /
// biotech companies on EDGAR. (2834 = Pharmaceutical Preparations is
// broader / catches more traditional pharma — add it later if you want a
// wider net.)
const BIOTECH_SIC_CODES = ['8731', '2836'];

// NOTE: we deliberately use efts.sec.gov (the full-text search JSON API)
// here instead of the older www.sec.gov/cgi-bin/browse-edgar company
// search. The legacy page sits behind Akamai bot protection that can
// silently serve an unparseable response to data-center IPs (like GitHub
// Actions runners) without ever returning an HTTP error — which is why an
// earlier version of this file quietly found 0 companies. efts.sec.gov has
// no such protection and returns plain JSON.
function extractCikAndName(hit) {
  const src = hit._source || {};
  let cik = src.cik || (Array.isArray(src.ciks) && src.ciks[0]) || null;
  let name = src.entity_name || (Array.isArray(src.display_names) && src.display_names[0]) || null;

  // display_names is often like "ACME CORP (0001234567) (Filer)" — pull the
  // CIK out of it if we didn't get one directly, and clean the name.
  if (name) {
    const m = name.match(/\((\d{10})\)/);
    if (!cik && m) cik = m[1];
    name = name.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  }
  if (cik) cik = String(cik).replace(/^0+/, '') || '0';
  return cik && name ? { cik, name } : null;
}

async function fetchUniverseForSic(sic) {
  const results = [];
  let from = 0;
  const pageSize = 100;
  let loggedSample = false;
  while (true) {
    const url = `https://efts.sec.gov/LATEST/search-index?q=&forms=10-K&sics=${sic}&from=${from}&size=${pageSize}`;
    let data;
    try {
      data = await getJson(url);
    } catch (e) {
      console.log(`  SIC ${sic} page from=${from} failed: ${e.message}`);
      break;
    }
    const hits = data?.hits?.hits || [];
    if (!loggedSample && hits.length > 0) {
      // One-time diagnostic so we can see the exact shape SEC is returning,
      // in case extractCikAndName ever needs adjusting again.
      console.log('Sample EFTS hit (for debugging):', JSON.stringify(hits[0]).slice(0, 500));
      loggedSample = true;
    }
    if (hits.length === 0) break;
    for (const hit of hits) {
      const parsed = extractCikAndName(hit);
      if (parsed) results.push(parsed);
    }
    from += pageSize;
    await sleep(150);
    if (from > 9800) break; // EFTS hard caps at from+size <= 10000
  }
  return results;
}

async function fetchBiotechUniverse() {
  const all = [];
  for (const sic of BIOTECH_SIC_CODES) {
    const page = await fetchUniverseForSic(sic);
    all.push(...page);
  }
  // de-dupe by CIK
  const seen = new Set();
  return all.filter((c) => {
    if (seen.has(c.cik)) return false;
    seen.add(c.cik);
    return true;
  });
}

// --- 2. CIK -> ticker map (single bulk JSON file, free) ----------------
async function fetchTickerMap() {
  const data = await getJson('https://www.sec.gov/files/company_tickers.json');
  const map = new Map(); // cik (no padding) -> { ticker, title }
  for (const key of Object.keys(data)) {
    const row = data[key];
    map.set(String(row.cik_str), { ticker: row.ticker, title: row.title });
  }
  return map;
}

// --- 3. Cash position + burn rate via XBRL company facts ---------------
const CASH_TAGS = [
  'CashAndCashEquivalentsAtCarryingValue',
  'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
  'Cash',
];
const SHORT_TERM_INVESTMENT_TAGS = ['ShortTermInvestments', 'MarketableSecuritiesCurrent'];
const BURN_TAGS = ['NetCashProvidedByUsedInOperatingActivities'];

function latestUsdValue(factEntries) {
  if (!factEntries) return null;
  let best = null;
  for (const e of factEntries) {
    if (e.unit !== 'USD' && e.uom !== 'USD') continue;
    if (!best || new Date(e.end) > new Date(best.end)) best = e;
  }
  return best;
}

function collectFacts(companyFacts, tag) {
  const node = companyFacts?.facts?.['us-gaap']?.[tag];
  if (!node) return null;
  const usd = node.units?.USD;
  if (!usd) return null;
  return usd;
}

async function fetchCashAndBurn(cik) {
  const padded = String(cik).padStart(10, '0');
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`;
  let facts;
  try {
    facts = await getJson(url);
  } catch (e) {
    return { cash: null, shortTermInvestments: null, quarterlyBurn: null, error: e.message };
  }

  let cashEntry = null;
  for (const tag of CASH_TAGS) {
    const entries = collectFacts(facts, tag);
    const v = latestUsdValue(entries);
    if (v) { cashEntry = v; break; }
  }

  let stiEntry = null;
  for (const tag of SHORT_TERM_INVESTMENT_TAGS) {
    const entries = collectFacts(facts, tag);
    const v = latestUsdValue(entries);
    if (v) { stiEntry = v; break; }
  }

  // Burn: find the most recent ~3-month (quarterly) operating cash flow entry
  let burnEntry = null;
  for (const tag of BURN_TAGS) {
    const entries = collectFacts(facts, tag);
    if (!entries) continue;
    const quarterly = entries.filter((e) => {
      const start = new Date(e.start);
      const end = new Date(e.end);
      const days = (end - start) / (1000 * 60 * 60 * 24);
      return days > 75 && days < 100; // roughly one quarter
    });
    const v = latestUsdValue(quarterly);
    if (v) { burnEntry = v; break; }
  }

  return {
    cash: cashEntry ? cashEntry.val : null,
    cashAsOf: cashEntry ? cashEntry.end : null,
    shortTermInvestments: stiEntry ? stiEntry.val : null,
    quarterlyBurn: burnEntry ? burnEntry.val : null, // negative = cash outflow
  };
}

module.exports = {
  fetchBiotechUniverse,
  fetchTickerMap,
  fetchCashAndBurn,
  sleep,
};
