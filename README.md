# Runway — Biotech Catalyst Screener

## What this is
- A daily-refreshed database of every EDGAR-classified biotech company: price, cash position, estimated cash runway, and any clinical trial readout due in the next 4 months. Built from free sources: SEC EDGAR + ClinicalTrials.gov.
- A "Look up one stock" mode that works for any ticker, combining the same SEC/trial data with a live Claude + web search pass for things like PDUFA dates.

## Deploy it — do this, in order

1. Unzip this folder. Push the whole folder to a new GitHub repository (create the repo at github.com/new, then follow GitHub's "push an existing folder" instructions it shows you).

2. In your new GitHub repo, go to **Settings → Secrets and variables → Actions → New repository secret**. Add one secret named `SEC_USER_AGENT` with your name and email, like `Jane Smith jane@email.com`. SEC requires this on every request — it's how they identify who's calling their API, not a credential.

3. Go to the **Actions** tab in your repo, click on "Refresh biotech data," click **Run workflow** to trigger it manually. This populates `data/biotech-data.json` for the first time. It will take several minutes — let it finish. After this, it also runs automatically every day on its own.

4. Go to vercel.com, sign up with GitHub, click **New Project**, import this repo, click **Deploy**.

5. In the Vercel project, go to **Settings → Environment Variables**, add one named `ANTHROPIC_API_KEY` with a key from console.anthropic.com (create one there if you don't have one, and add billing). Redeploy after adding it.

6. Open the URL Vercel gives you. The site is live. Use "Screen the universe" for list/ranking queries, "Look up one stock" for any single ticker.

## Keeping it running
- The data refreshes itself every day automatically — you don't need to do anything.
- If "Screen the universe" ever shows 0 results, go to the Actions tab and check if the last run failed — click into it to see the error in the logs.
- SEC occasionally tweaks the exact format of its company-search page. If the universe count in the logs looks wrong (0 companies, or far fewer than expected), that's the most likely cause — open this URL in a browser to sanity check what SEC is currently returning: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&SIC=8731&type=10-K&count=10&output=atom`, and compare it to what `scripts/lib/sec.js` expects.
