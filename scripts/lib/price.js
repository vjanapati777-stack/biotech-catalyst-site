// Stooq gives free EOD price data, no key, no auth. Slightly delayed
// (previous close) but fine for a screener that refreshes once a day.
async function fetchLatestClose(ticker) {
  try {
    const url = `https://stooq.com/q/d/l/?s=${ticker.toLowerCase()}.us&i=d`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const csv = await res.text();
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return null;
    const last = lines[lines.length - 1].split(',');
    // header: Date,Open,High,Low,Close,Volume
    const close = parseFloat(last[4]);
    return Number.isFinite(close) ? close : null;
  } catch {
    return null;
  }
}

module.exports = { fetchLatestClose };
