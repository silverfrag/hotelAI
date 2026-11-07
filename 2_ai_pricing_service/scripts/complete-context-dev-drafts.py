"""Persist assistant labels for the remaining dev documents after source review.

No model calls, test edits, user approval inference or automatic negative labels.
The early packet remains byte-for-byte unchanged while the user reviews it.
"""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
m2 = root / 'artifacts/hotelai-ai-v1/20261029-092250/M2'
early_path = m2 / 'label-review/review-packet.json'
early_raw = early_path.read_bytes()
packet = json.loads(early_raw)
reasons = {
    '550c268c83599ba7a54d': 'Báo cáo điều hành/kinh tế tháng 8; ngày nghị quyết và thống kê không phải lịch sự kiện du lịch.',
    '8a144b60187cbfe0aef7': 'Báo cáo 9 tháng và nhiệm vụ quý; ngày công văn không phải ngày diễn ra sự kiện thị trường.',
    '227db98e84baf282edbc': 'Thống kê du lịch tháng 4 và kỷ niệm 1975–2026; không có tên/lịch tuyệt đối của sự kiện cụ thể. Không biến khoảng kỷ niệm thành 51 năm hiệu lực.',
    '7bbaca2c49d0c5b2e44a': 'Điều hành tháng 5, quy hoạch và đón đoàn; không có lịch du lịch cụ thể đủ bằng chứng.',
    'd80c9a6393eb87d48cb3': 'Vũ hội đường phố xảy ra đêm 29-8 nhưng năm chỉ ở metadata ngày đăng. Không mượn năm đăng 2026 cho nhãn.',
    '4eaa8802969d97ae779a': 'Hội nghị giao ban Công đoàn nội bộ; hoạt động Tết tương lai chưa có ngày tuyệt đối, không thuộc thông tin thị trường đủ điều kiện.',
    '101e221f92de4b872a50': 'Đề nghị vận hành hồ chứa và nguy cơ El Niño; không phải thông báo gián đoạn du lịch có phạm vi/ngày tuyệt đối đầy đủ. “Từ nay” không tự dùng ngày đăng làm đầu khoảng.',
    'a8439b93a571cdc833b2': 'Báo cáo kinh tế 6 tháng; gián đoạn Hormuz ở ngoài Đà Nẵng, không suy ra tác động địa phương hoặc khoảng hiệu lực.',
    '6ed61d82a20aafbad8b6': 'Báo cáo chỉ đạo tháng 10; các ngày công văn/nghị quyết không phải lịch sự kiện du lịch.',
    '2af381befa2531e1c3a6': 'Họp rà soát dự án đầu tư; thời gian khởi công dự kiến chưa có lịch ngày và thông tin du lịch hợp lệ.',
    'f3722703b0865aa47945': 'Lễ hội Cầu Bông lặp mùng 7 tháng Giêng âm lịch hằng năm, không có năm áp dụng; năm vinh danh 2024 không phải năm lễ hội.',
    'e841152fbdcdea56961c': 'Báo cáo chỉ đạo tháng 7; ngày công văn/nghị quyết là thời gian văn bản, không phải lịch sự kiện thị trường.',
    'efeded0f9e9408a83baa': 'Trao Huy hiệu Đảng và tiểu sử cá nhân; không thuộc ba loại thông tin thị trường v1, không dùng ngày sinh/ngày quyết định.',
    '164fd6eebdecd6fd587f': 'Số liệu giải ngân vốn; ngày chốt thống kê không phải sự kiện, ưu đãi phòng hoặc gián đoạn du lịch.',
    '5a6c774dbaab3182f76f': 'Họp đôn đốc giải ngân; các mốc dự kiến thanh toán vốn không phải thời gian sự kiện du lịch.',
    '49000a36e21599bfe10d': 'Tiếp xúc cử tri và kiến nghị hạ tầng; kiến nghị chống sạt lở không phải thông báo cấm đường/gián đoạn đã xác lập ngày.',
    '51369b2b7449f9bfbbf0': 'Khảo sát đề xuất đặt tên đường; chưa phải quyết định đổi tên có ngày hiệu lực hay thông báo gián đoạn du lịch.',
    '3b3162c306245f262695': 'Khởi công nhà ở lực lượng vũ trang và tiến độ theo quý; không là ưu đãi phòng, sự kiện du lịch hoặc thông báo gián đoạn có ngày đủ điều kiện.',
    '3aa2efcbddc0c0888089': 'Kiểm tra quy hoạch/tiến độ cầu đường; hạn thi công và nghiệm thu không tự là thời gian gián đoạn du lịch, không có thông báo hạn chế đi lại xác định.',
    '4a7b86fb144a96b7e6ab': 'Hội nghị quản lý giáo dục trực tuyến và nhiệm vụ chuyển đổi số; không là sự kiện thị trường du lịch theo phạm vi nhãn v1.',
}
remaining = packet['reference_split_proposal']['dev'][10:]
assert set(remaining) == set(reasons)
rows = [row for row in packet['rows'] if row['split'] == 'dev']
for number, identifier in enumerate(remaining, 11):
    doc = json.loads((m2 / 'reference-candidates' / (identifier + '.json')).read_text(encoding='utf8'))
    rows.append({'review_id': f'D{number:02}', 'document_id': identifier, 'split': 'dev',
                 'event_cluster': 'national-day-and-pickleball-2026' if identifier == 'd80c9a6393eb87d48cb3' else identifier,
                 'source_url': doc['source_url'], 'attribution': doc['source_attribution'],
                 'title': doc['article_text'].splitlines()[0], 'source_text': doc['article_text'],
                 'text_sha256': doc['article_text_sha256'], 'proposed_label': 'negative', 'proposed_facts': [],
                 'reason': reasons[identifier], 'user_approved': False,
                 'annotation_origin': 'assistant_draft_from_original_text; no_Qwen_labels'})
assert len(rows) == 30
output = {'version': 'complete-dev-draft-v1', 'early_packet_sha256': hashlib.sha256(early_raw).hexdigest(),
          'user_dev_sample_review_pending': True, 'official_test_executed': False, 'documents': rows}
destination = m2 / 'dev-label-drafts.json'
destination.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf8')
assert early_path.read_bytes() == early_raw
print(json.dumps({'dev_drafts': len(rows), 'negative_drafts': sum(row['proposed_label'] == 'negative' for row in rows),
                  'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'early_packet_unchanged': True}))
