"""Offline lab artifact with an analytic TEST FIXTURE, never learned market data."""
import hashlib
import html
import json
import math
import sys
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / '2_ai_pricing_service'))
from app.core.stay_market_contract import StayCore, CoreNight
from app.services.stay_price_optimizer import optimize_stay


class AnalyticFixture:
    kind = 'test_fixture'
    version = 'analytic_fixture_optimizer_v1_not_a_trained_model'

    def in_domain(self, core, prices):
        return all(Decimal('.85') <= p / night.policy_price <= Decimal('1.25')
                   for p, night in zip(prices, sorted(core.nights, key=lambda n: n.night)))

    def predict_acceptance(self, core, prices):
        ratio = float(sum(prices) / sum(n.policy_price for n in core.nights))
        return 1 / (1 + math.exp(8 * (ratio - 1.05)))


start = date(2026, 12, 31)
core = StayCore(origin='backend_inventory_policy', room_type_id=1, capacity=2, guests=2,
    check_in=start, check_out=start + timedelta(days=2), policy_version='test_fixture_policy_not_operational',
    nights=tuple(CoreNight(night=start + timedelta(days=i), available_rooms=3, policy_price=price,
        floor=price * Decimal('.9'), ceiling=price * Decimal('1.2'), variable_cost=price * Decimal('.5'))
        for i, price in enumerate([Decimal('1000000'), Decimal('1250000')])))
result = optimize_stay(core, AnalyticFixture(), model_ready=True, coverage_ready=True, mode='lab')
assert result['effective_source'] == 'lab_test_fixture'
destination = root / 'artifacts/hotelai-ai-v1/20261029-092250/M2/independent-optimizer-lab'
destination.mkdir(exist_ok=True)
report = {'kind': 'test_fixture_benchmark', 'no_operational_quote_issued': True,
          'no_training_data_written': True, 'market_accuracy_evidence': False,
          'model_description': 'Hand-written logistic curve for software demonstration; not fitted to observations.',
          'core': core.model_dump(mode='json'), 'result': result}
(destination / 'benchmark.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
money = lambda number: f'{number:,.0f}'.replace(',', '.') + ' đ'
rows = []
for candidate in result['candidates']:
    chosen = candidate['factor'] == result['chosen_factor']
    rows.append('<tr' + (' class="chosen"' if chosen else '') + '><td>' + candidate['factor'] + '</td><td>'
        + '</td><td>'.join(money(p) for p in candidate['nightly_prices']) + '</td><td>' + money(candidate['total'])
        + '</td><td>' + html.escape(candidate['status']) + '</td><td>'
        + (f"{candidate['probability']:.3f}" if 'probability' in candidate else '—') + '</td><td>'
        + (money(Decimal(candidate['expected_contribution'])) if 'expected_contribution' in candidate else '—') + '</td></tr>')
page = '<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>HotelAI — optimizer lab fixture</title><style>body{font:16px system-ui;margin:32px;color:#182b35}h1{font-size:24px}.warning{background:#fff0cc;border:2px solid #996000;padding:20px;max-width:1000px}table{border-collapse:collapse;font-size:14px;margin-top:24px}td,th{padding:9px;border:1px solid #bfcdd4;text-align:right}th{background:#edf3f6}.chosen{background:#d5f5e4;font-weight:bold}</style>'
page += '<h1>HotelAI · Lab / benchmark bộ tối ưu</h1><p class="warning"><strong>' + result['label'] + '</strong><br>Đường xác suất viết tay, không học từ dữ liệu. Chỉ kiểm tra phần mềm tìm cực đại trong tập phương án hợp lệ. Không phát hành quote, không ghi dataset conversion.</p>'
page += '<p>Hai đêm fixture qua năm mới. Làm tròn half-up 1.000 VND/phòng/đêm. Giá hiển thị theo chính sách: <strong>' + money(result['displayed_total']) + '</strong>. Kết quả lab: <strong>' + money(result['proposed_total']) + '</strong>; hệ số ' + result['chosen_factor'] + '.</p>'
page += '<p>Hàng xanh là phương án được chọn. “Xác suất fixture” không phải xác suất khách thật chấp nhận báo giá. Biên đóng góp kỳ vọng fixture không chứng minh doanh thu tăng.</p><table><thead><tr><th>Hệ số</th><th>Đêm 31/12</th><th>Đêm 01/01</th><th>Tổng VND</th><th>Trạng thái</th><th>Xác suất fixture</th><th>Biên kỳ vọng fixture</th></tr></thead><tbody>' + ''.join(rows) + '</tbody></table></html>'
(destination / 'index.html').write_text(page, encoding='utf8')
(destination / 'manifest.json').write_text(json.dumps([{'path': p.name, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
    for p in sorted(destination.iterdir()) if p.name != 'manifest.json'], indent=2), encoding='utf8')
print(json.dumps({'kind': 'test_fixture_benchmark', 'evidence': str(destination), 'market_accuracy_evidence': False}))
