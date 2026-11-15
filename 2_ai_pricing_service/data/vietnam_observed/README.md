# Observed Vietnamese market data intake

The reviewed sample transcribes official public Khánh Hòa reports; it does not
contain synthetic demand labels. It is a source-review sample, not a sufficient
training corpus. Four segments and two status columns must not be counted as
eight independent months. The source directory, coverage gaps and exact meaning
of each statistic are documented in
[VIETNAM_OBSERVED_DATA_SOURCES.md](../../../docs/agent/VIETNAM_OBSERVED_DATA_SOURCES.md).

From `2_ai_pricing_service`, inspect without training or replacing a model:

```powershell
.venv/Scripts/python.exe -m app.training.vietnam_market_data data/vietnam_observed/khanh_hoa_occupancy_sample.json --output ../.tmp/ai-data-review/vietnam-market-readiness.json
.venv/Scripts/python.exe -m pytest tests/test_vietnam_market_data.py -q -p no:cacheprovider
```

The 112-row sample yields four series with 14 official months each. Estimated
values remain available for provenance review and are excluded from official
target coverage. Review output identifies missing months and insufficient
history. The default 36-month screen is an initial research threshold only;
passing it never claims accuracy or authorizes model promotion.

Every observation includes its month, report month, source URL/page/hash,
accommodation segment, unit and geographic boundary. Nine newly reviewed report
publication dates remain null; a PDF signature is not proof of public release.
The January 2024 official aggregate exceeds every listed segment in its source.
All four observations for that month retain the printed values and a review
flag. The intake reports this unresolved issue even if coverage later suffices.
Keep source estimates/revisions intact. Never infer missing occupancy, fabricate
holiday uplift, or merge a changed provincial boundary into a continuous series.
