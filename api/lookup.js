name: Refresh biotech data

on:
  schedule:
    # Runs once a day at 11:00 UTC (after US markets close prior day's data settles)
    - cron: '0 11 * * *'
  workflow_dispatch: {} # lets you trigger it manually from the Actions tab

jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Run refresh script
        env:
          SEC_USER_AGENT: ${{ secrets.SEC_USER_AGENT }}
        run: node scripts/refresh.js

      - name: Commit updated data
        run: |
          git config user.name "biotech-data-bot"
          git config user.email "actions@github.com"
          git add data/biotech-data.json
          git diff --staged --quiet || git commit -m "Daily data refresh"
          git push
