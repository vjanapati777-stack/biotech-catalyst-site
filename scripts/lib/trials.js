// ClinicalTrials.gov API v2 — free, no key required.
// Docs: https://clinicaltrials.gov/data-api/api

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTrialsForSponsor(companyName) {
  const params = new URLSearchParams({
    'query.spons': companyName,
    'filter.overallStatus': 'RECRUITING,ACTIVE_NOT_RECRUITING,ENROLLING_BY_INVITATION',
    'fields': 'NCTId,BriefTitle,PrimaryCompletionDate,OverallStatus,Phase,LeadSponsorName',
    'pageSize': '20',
  });
  const url = `https://clinicaltrials.gov/api/v2/studies?${params.toString()}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return [];
  const data = await res.json();
  return data.studies || [];
}

// Returns trials whose primary completion date falls within [today, today+windowMonths]
function filterNearTerm(studies, windowMonths = 4) {
  const now = new Date();
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() + windowMonths);

  const out = [];
  for (const s of studies) {
    const proto = s.protocolSection;
    if (!proto) continue;
    const dateStruct = proto.statusModule?.primaryCompletionDateStruct;
    const dateStr = dateStruct?.date;
    if (!dateStr) continue;
    // dates can be "YYYY-MM" or "YYYY-MM-DD"
    const d = new Date(dateStr.length === 7 ? dateStr + '-01' : dateStr);
    if (d >= now && d <= cutoff) {
      out.push({
        nctId: proto.identificationModule?.nctId,
        title: proto.identificationModule?.briefTitle,
        phase: (proto.designModule?.phases || []).join(', '),
        status: proto.statusModule?.overallStatus,
        primaryCompletionDate: dateStr,
      });
    }
  }
  return out;
}

async function fetchNearTermTrialCatalysts(companyName, windowMonths = 4) {
  try {
    const studies = await fetchTrialsForSponsor(companyName);
    return filterNearTerm(studies, windowMonths);
  } catch (e) {
    return [];
  }
}

module.exports = { fetchNearTermTrialCatalysts, sleep };
