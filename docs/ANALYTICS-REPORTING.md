# Analytics & Reporting

PartnerMarket Global CRM v2.5 adds a management-grade Analytics & Reporting Center for executive reviews, sales operations, account planning and data-backed coaching.

## Reporting scope

Every report is isolated to the authenticated workspace. Reports also respect the active CRM account filter and may optionally be restricted to one workspace member.

Supported periods:

- last 30 days;
- last 90 days;
- last 180 days;
- last 12 months;
- custom date ranges up to 730 days.

Every selected period is compared with the immediately preceding period of equal length.

## Executive scorecard

The report summarizes:

- won revenue and period-over-period change;
- won deal count and win rate;
- average successful deal size;
- average sales-cycle length;
- open and probability-weighted pipeline;
- expected-close-date coverage;
- next-step coverage;
- close-date accuracy for won opportunities;
- commercial activity and active-account reach;
- outbound email delivery performance.

## Detailed report sections

The interface includes:

- won-revenue trend;
- activity trend;
- current pipeline funnel;
- activity-channel mix;
- relationship-health distribution;
- task and follow-up completion and on-time rates;
- email delivery, recipient volume and delivery attempts;
- team performance by owner;
- source performance and win rate;
- loss-reason analysis;
- account revenue, pipeline, engagement, concentration and relationship health.

## Definitions

Period revenue is recognized from opportunities marked `won` whose `closed_at` falls inside the selected period.

Win rate is won opportunities divided by won plus lost opportunities closed during the period.

Current pipeline is a point-in-time snapshot of opportunities not marked won or lost. Weighted pipeline multiplies opportunity value by probability.

Close-date accuracy is the percentage of measurable won opportunities closed within seven days before or after their expected close date.

Source performance uses opportunities created during the selected period. This prevents old opportunities from being attributed to a new reporting period merely because their stage later changed.

Task and follow-up completion rates use items due during the selected period as the cohort. On-time rates compare completion timestamps with due timestamps, preventing completion percentages from exceeding 100% because of work created in another period.

## Exports

The report can be:

- exported as a multi-section CSV;
- downloaded as structured JSON;
- printed or saved as PDF through the browser print dialog.

CSV and JSON exports use the same active workspace, account, owner and date filters as the visible report.

## API

`GET /api/analytics`

Optional query parameters:

- `days`: rolling period between 7 and 730 days;
- `from`: custom start date in `YYYY-MM-DD` format;
- `to`: custom end date in `YYYY-MM-DD` format;
- `account`: restrict the report to one account in the active workspace;
- `owner`: restrict owner-based report sections to one workspace member.

When `from` and `to` are supplied, the custom dates take precedence over `days`.

## Interpretation safeguards

Pipeline funnel reporting is a current snapshot, not historical stage-transition analysis. Forecast coverage measures data completeness, while close-date accuracy measures realized scheduling accuracy on won opportunities.

Managers should interpret low-volume percentages carefully. The report exposes the underlying counts alongside rates so conclusions can be checked against sample size.
