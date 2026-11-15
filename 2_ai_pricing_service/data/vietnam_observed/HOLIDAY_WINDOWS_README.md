# Vietnamese holiday-window statistics

`holiday_windows.json` is a 13-observation, source-reviewed intake sample from
five reports published by the Vietnam National Authority of Tourism's Tourism
Information Technology Center. It is **not training-ready** and has no connection
to model promotion or automatic pricing.

| Source | Inclusive holiday window | Transcribed observations |
| --- | --- | --- |
| [Tết 2024](https://thongke.tourism.vn/index.php/news/items/167) | 8–14 February 2024 | National occupancy range and domestic lodging visits; Khánh Hòa lodging/total visitor visits; Kiên Giang occupancy |
| [National Day 2024](https://thongke.tourism.vn/index.php/news/items/216) | 31 August–3 September 2024 | National whole-period occupancy; separate 1–2 September lower bound; Thừa Thiên Huế international lodging visits; Khánh Hòa total visitor visits |
| [Tết 2025](https://thongke.tourism.vn/index.php/news/items/243) | 25 January–2 February 2025 | Khánh Hòa total visitor visits and national domestic visitor visits; neither is a lodging count |
| [Reunification/Labour Day 2025](https://thongke.tourism.vn/index.php/news/items/274) | 30 April–4 May 2025 | Approximate whole-period national occupancy of 70%; update date 12 May 2025 |
| [Tết 2026](https://thongke.tourism.vn/index.php/news/items/371) | 14–22 February 2026 | Approximate national occupancy range of 55–60%; update date 24 February 2026 |

Sources were checked on 27 September 2026. Their displayed update dates are
retained as publication evidence; these are not assumed to be original release
dates or to identify an hour of availability. No explicit open-data reuse license
was identified in the reviewed pages. Source locators and interpretation notes
are included for every observation; future revisions require another source
review rather than silent replacement. The two newest reports add only national
whole-period occupancy. The 2025 report's early-holiday peak lacks exact dates;
the 2026 local summaries mix seven-day and nine-day coverage without dates for
every local metric. Those peaks and local figures are not transcribed as
whole-period targets. No provincial records after July 2025 were added.

## Meaning of a target

Dates use `Asia/Ho_Chi_Minh` and both endpoints are included. A report covering
seven days yields one seven-day target. It does not yield seven daily occupancy
labels, and the two-day National Day peak is not independent of the whole holiday
containing it. The JSON retains `45–50%` as a range and `>60%` as an exclusive
lower bound; it does not invent exact midpoints.

`room_occupancy_rate`, `lodging_guest_visits`, and `tourist_visits` are different
metrics with different units/populations. Guest visits are not unique people,
guest-nights, room-nights, or bookings. Visitor totals may include day trips.
Accommodation coverage is `all_or_unspecified`; none of these figures is a
resort-only sample or a specific hotel's inventory.

Status is attached to each metric, not inferred from an official-looking URL:

- `estimate`: the source identifies an estimate, including an estimated total's
  lodging subset. These observations require a separately declared experiment.
- `reported`: the figure is published without an explicit final designation.
  It is not certified final; the statement can still have measurement error.
- `final`: reserved for sources expressly identifying final data. The sample
  contains **zero** final observations.

The sample has nine estimates and four reported figures. Its 13 rows represent
11 distinct geographic windows across metrics and eight comparable series,
covering five holiday instances across 2024–2026.
These counts are not statistically independent samples: provinces are contained
in the national aggregate; lodging guests are contained in some visitor totals.
The National Day reported occupancy series has two nested windows but only one
non-overlapping window group. The three Khánh Hòa visitor windows span only two
years and cannot teach resort occupancy or price responsiveness. National
estimated occupancy contains Tết 2024 and 2026 ranges; it does not acquire a
missing Tết 2025 occupancy target from that year's visitor count. The Tết 2026
range is conservatively marked estimated because its nationwide-results
paragraph opens with an estimate designation. The 2025 whole-period occupancy
paragraph gives an approximate achieved figure without calling it final or
explicitly estimated, so it remains reported. These statuses stay separate.

Boundary versions are explicit. The 2024/early-2025 Khánh Hòa and Kiên Giang
observations are not automatically joined to provinces after the July 2025
reorganization. The Thừa Thiên Huế record preserves the geography named by its
2024 source. Null `boundary_valid_from` means the intake has not documented the
boundary's earliest validity; it does not assert an unchanging historical series.

## Inspect without training

From `2_ai_pricing_service`:

```powershell
.venv/Scripts/python.exe -m app.training.vietnam_holiday_data data/vietnam_observed/holiday_windows.json --output ../.tmp/ai-data-review/vietnam-holiday-readiness.json
.venv/Scripts/python.exe -m app.training.vietnam_holiday_data data/vietnam_observed/holiday_windows.json --as-of 2024-09-04
.venv/Scripts/python.exe -m pytest tests/test_vietnam_holiday_data.py -q -p no:cacheprovider --basetemp ../.tmp/holiday-intake-tests-new-run
```

Use a fresh workspace `--basetemp` path for each test run. The inspection command
does not import the pricing model, train it, or change an artifact. It refuses
to overwrite its input with a readiness report.

The `--as-of` filter admits only windows completed **before** that civil day and
reports published **before** that day. This conservative policy prevents a
date-only publication from being treated as available at midnight on its release
date. Unknown publication dates remain visible in unrestricted coverage review
and are excluded from as-of review. Historical feature construction still needs
its own as-of joins; filtering this label inventory is not a full backtest.

The inspector separates region/boundary, metric, population, accommodation
segment and status. Repeated publications do not increase distinct target
coverage; differing revisions require review. Overlapping windows form connected
groups, requiring a shared evaluation split or explicit exclusion. It never
chooses a revision, averages conflicting values, or creates a daily series.

The default screen asks for 12 non-overlapping windows across at least three
years within a comparable series. This is an initial research screen, not a
validated sample-size requirement or proof of predictive accuracy. Every sample
series currently fails. Range/bound targets need an interval-aware objective;
they cannot pass as ordinary exact regression labels.

## Next collection and evaluation work

Collect additional years and local holiday reports with the same outcome and
population definition, including quiet periods rather than only successful
destinations. Identify ordinary-period comparison data before claiming a holiday
effect. Keep administrative changes, pandemic regimes, estimate revisions, and
publication timing explicit. Compare models and baselines on held-out complete
holiday instances, grouped to prevent overlapping geographic/windows from
leaking across splits. A model of market holiday occupancy remains separate from
a hotel's daily pickup, cancellation and hourly pricing models.
