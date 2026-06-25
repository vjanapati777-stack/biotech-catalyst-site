const data = require('../data/biotech-data.json');

// GET /api/screen?maxPrice=10&minRunway=0&catalystOnly=true&limit=100&sort=cash
module.exports = (req, res) => {
  const q = req.query || {};
  const maxPrice = q.maxPrice ? parseFloat(q.maxPrice) : null;
  const minCash = q.minCash ? parseFloat(q.minCash) : null;
  const catalystOnly = q.catalystOnly === 'true';
  const limit = q.limit ? Math.min(parseInt(q.limit, 10), 500) : 100;
  const sort = q.sort || 'cash'; // 'cash' | 'runway' | 'catalysts'

  let rows = data.companies.filter((c) => c.price != null);

  if (maxPrice != null) rows = rows.filter((c) => c.price <= maxPrice);
  if (minCash != null) rows = rows.filter((c) => (c.totalCashPosition || 0) >= minCash);
  if (catalystOnly) rows = rows.filter((c) => c.catalystCount > 0);

  rows.sort((a, b) => {
    if (sort === 'runway') return (b.estimatedRunwayMonths || 0) - (a.estimatedRunwayMonths || 0);
    if (sort === 'catalysts') return (b.catalystCount || 0) - (a.catalystCount || 0);
    return (b.totalCashPosition || 0) - (a.totalCashPosition || 0);
  });

  res.status(200).json({
    generatedAt: data.generatedAt,
    totalMatching: rows.length,
    results: rows.slice(0, limit),
  });
};
