# Commercial Intelligence

PartnerMarket Global CRM v2.4 adds a first-class Commercial Intelligence workspace for revenue forecasting, opportunity risk, account attention and CRM data quality.

## Scope

The intelligence endpoint is always isolated to the authenticated workspace. When the CRM account filter is active, forecast, risk, quality and duplicate results are additionally scoped to that account where applicable.

## Forecast and pipeline hygiene

The intelligence view reports:

- total and probability-weighted open pipeline;
- expected closes in the next 30 days;
- overdue pipeline value and deal count;
- opportunities without an expected close date;
- opportunities without a next step;
- opportunities with no update within the selected 30, 60, 90 or 180-day risk window;
- six-month pipeline and weighted forecast by expected close month.

Risk scoring is transparent. It is composed from overdue close dates, stale updates, missing next steps, missing primary contacts and missing account links. The UI displays the contributing reasons for every flagged opportunity.

## Account attention

Accounts are surfaced when relationship health is weak, no contact has occurred within twice the selected opportunity-risk window, or overdue tasks and follow-ups remain open. The account inactivity threshold is capped at 365 days. Account risk is read-only and links back to the existing account and follow-up workflows.

## Data quality

The quality score reviews operationally important fields across active contacts, active accounts and open opportunities. It covers contactability, account assignment, buying-role context, consent classification, company segmentation and forecast completeness.

Possible duplicate groups are detected by normalized contact email, account name and account domain. Duplicate detection is deliberately non-destructive: the CRM never merges, deletes or rewrites records automatically.

## API

`GET /api/intelligence`

Optional query parameters:

- `account`: restrict results to one account in the active workspace;
- `days`: inactivity risk threshold between 30 and 180 days. Account inactivity uses twice the selected threshold, capped at 365 days.

The endpoint returns forecast totals, monthly forecast, risky opportunities, risky accounts, data-quality metrics and duplicate groups.

## Performance

Migration `0005_commercial_intelligence_indexes.sql` adds non-destructive indexes for expected close dates, opportunity updates, account relationship health, overdue tasks and follow-ups, contact email lookup and account name/domain lookup. All indexes use `IF NOT EXISTS` and require no data rewrite.

## Operational guidance

Use the intelligence view as a prioritization layer. Validate deal context with the owner before changing stages or close dates, confirm duplicate ownership and activity history before consolidating records, and resolve consent or communication restrictions before outbound activity.
