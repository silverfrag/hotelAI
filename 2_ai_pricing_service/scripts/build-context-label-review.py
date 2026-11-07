"""Create an OFFLINE human review packet. No Qwen calls and no quality scores.

Proposals are assistant drafts from source passages, not approved gold. The test
may not run until the user has reviewed every test item and the dev sample.
"""
import hashlib
import html
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
m2 = root / "artifacts/hotelai-ai-v1/20261029-092250/M2"
source = m2 / "reference-candidates"
index = json.loads((m2 / "reference-candidate-index.json").read_text(encoding="utf8"))
documents = {row["id"]: json.loads((source / (row["id"] + ".json")).read_text(encoding="utf8")) for row in index}
dev_sample = ["bb008d9dafcd11a11275", "c4c34a04bd8b9a0698b7", "e266f7d34f50fac589f1",
              "eda02764a0ea4de09286", "047f91766f1177269ae6", "130b8da4b1d9784c33ce",
              "2fab7e8968c1e67cadd3", "313448972b8b082245fe", "ddcd2bd82db8478077ed", "7cc46190b252e137a188"]
tourism_test = ["0799c9dcb37ef7cc8b14", "51dedc556eaaeb0f0c99", "756b0b55f6c2eef0be84",
                "98c6098f7a6e66b1161b", "41e3f0ce6a8dcbe96539", "9b904985ceecf4b0f14f",
                "0d5f2cad48a321a45f19", "e50b590ccd8fafc63f8b", "fd11d051ce2843035800",
                "ae5d52dbb70b8bf1ee03", "016a8161e8e35ee5d4f4", "0203ee499e8a03df4b98",
                "6bcbf27aee91a83fee24", "809fe97d3eba681a5ca9"]
land_test = ["0e5c01c7c23f1edeb7b7", "1c1e4551ec1460e27d49", "3c2b2956c5adc32ca1a5",
             "4e05c8c37235a51712c1", "629df2bc8f9d7aeabb3f", "6f9cbd8e8b93e1411820",
             "fbcc1f80ed1ef11f7386", "fde277548af2d63dddb4"]
admin_test = ["c4cf0a07148e5e696f0b", "88c79f091188528dd5c8", "a0e4dd9c03d3b99ce9ca",
              "c1b933309db24dadc2ac", "22ffae0bbe2725761cf1", "8b783500502973b68be4",
              "7a69705de82d2afe862c", "9e3c1736618f86f60e33"]
test_ids = tourism_test + land_test + admin_test
assert len(set(test_ids)) == 30 and not set(dev_sample) & set(test_ids)
remaining = [row["id"] for row in sorted(index, key=lambda row: (row["characters"], row["id"]))
             if row["id"] not in dev_sample + test_ids]
dev_ids = dev_sample + remaining[:20]
reserve_ids = [identifier for identifier in documents if identifier not in dev_ids + test_ids]
assert len(dev_ids) == 30 and len(reserve_ids) == 20


def paragraph(identifier, needle):
    return next(line for line in documents[identifier]["article_text"].splitlines()[2:] if needle.casefold() in line.casefold())


def fact(identifier, name, kind, start, end, needle, note=""):
    text = documents[identifier]["article_text"]
    quote = paragraph(identifier, needle)
    geographic_quote = next((line for line in text.splitlines() if "đà nẵng" in line.casefold()), "")
    assert quote in text and geographic_quote
    return {"fact_type": kind, "subject": name, "geography": "VN-DN", "start_date": start,
            "end_date": end, "event_status": "scheduled", "time_evidence": quote,
            "geographic_evidence": geographic_quote, "review_note": note}


proposals = {}
newyear = dev_sample[0]
proposals[newyear] = [
    fact(newyear, "Lễ hội Chào năm mới Đà Nẵng 2027", "event", "2026-12-30", "2027-01-03", "561/KH-UBND"),
    fact(newyear, "Chương trình khai mạc", "event", "2026-12-31", "2026-12-31", "19 giờ"),
    fact(newyear, "Đà Nẵng - Chạm thời khắc 0h00", "event", "2026-12-31", "2026-12-31", "thời khắc 0h00",
         "Ngày theo đêm chương trình nguồn nêu; cần duyệt cách biểu diễn chương trình qua thời khắc giao năm."),
    fact(newyear, "Hạn chế lưu thông tuyến phố đi bộ Bạch Đằng", "travel_disruption", "2026-12-30", "2027-01-03", "đóng toàn bộ",
         "Chỉ ghi đúng việc đóng tuyến theo nguồn; không suy ra tác động tới nhu cầu hoặc doanh thu."),
]
proposals[dev_sample[1]] = [fact(dev_sample[1], "Giải Heineken Pickleball World Cup 2026", "event",
    "2026-08-30", "2026-09-06", "từ ngày 30-8", "Năm dùng chung trong cùng khoảng ngày; không lấy ngày hội nghị tổng kết 06/11 làm ngày thi đấu.")]
proposals[dev_sample[2]] = [fact(dev_sample[2], "Phun lửa, phun nước cầu Rồng", "event",
    "2026-08-28", "2026-09-02", "được tổ chức liên tục", "Năm 2026 nằm trong chính đoạn nêu kỳ nghỉ lễ; không lấy từ ngày đăng.")]
proposals[dev_sample[3]] = [fact(dev_sample[3], "Tour Sơn Trà Xanh – Lên rừng, xuống biển", "event",
    "2025-04-26", "2025-05-02", "Trong không khí", "Năm 2025 là năm mùa du lịch được nêu trong đoạn xảy ra; không dùng làm dữ liệu thị trường hiện tại.")]
for identifier in tourism_test[:3]:
    proposals[identifier] = [fact(identifier, "Hội nghị đối thoại với doanh nghiệp ngành du lịch năm 2026",
        "event", "2026-10-14", "2026-10-14", "14-10",
        "Cần duyệt liên kết địa lý từ ngữ cảnh chủ trì/thành phố trong bài. Ba bài này cùng một hội nghị, là MỘT cụm, không phải ba sự kiện độc lập. Các đề xuất dự án/định hướng không phải lịch sự kiện đã xác nhận.")]


def cluster(identifier):
    if identifier in tourism_test[:3]: return "tourism-dialogue-2026-10-14"
    if identifier in land_test: return "land-administration"
    if identifier in (admin_test[2], admin_test[3]): return "portal-procurement-2026"
    if identifier in (admin_test[5], admin_test[6]): return "citizen-reception-2026-11-20"
    if identifier in (dev_sample[1], dev_sample[2], "bba0cf55950178fd466a", "d80c9a6393eb87d48cb3"):
        return "national-day-and-pickleball-2026"
    return identifier


rows = []
for split, identifiers in (("test", test_ids), ("dev", dev_sample)):
    for number, identifier in enumerate(identifiers, 1):
        doc = documents[identifier]
        proposed = proposals.get(identifier, [])
        if identifier in land_test:
            reason = "Thông tin đất đai/dự án/cho thuê tài sản không phải ưu đãi phòng khách sạn hay sự kiện du lịch có lịch hợp lệ."
        elif identifier in admin_test:
            reason = "Thông báo hành chính, đấu thầu hoặc tiếp công dân không thuộc ba loại thông tin thị trường v1. Ngày nhận hồ sơ/ngày văn bản không phải ngày sự kiện."
        elif not proposed:
            reason = "Chưa đủ loại/địa lý/khoảng hiệu lực tuyệt đối cho một thông tin v1. Lịch lặp, giờ mở cửa, mùa, lịch sử và ngày đăng không được tự biến thành kỳ hiệu lực."
        else:
            reason = "Đề xuất các thông tin có chứng cứ trong nguồn; người dùng phải duyệt trước khi trở thành nhãn tham chiếu."
        note = ""
        if identifier == "98c6098f7a6e66b1161b":
            note = "Có khuyến cáo liên quan du lịch nhưng chưa xác định được khoảng hiệu lực tuyệt đối; cần duyệt, không giả định còn hiệu lực chỉ vì mới tải."
        if identifier == "7cc46190b252e137a188":
            note = "Ngày/năm sự kiện có trong bài, nhưng địa lý Đông Giang chưa có mapping được kiểm chứng vào phạm vi v1. Đề xuất bỏ theo quy tắc không đoán địa danh; người dùng cần duyệt."
        row = {"review_id": ("T" if split == "test" else "D") + f"{number:02d}", "document_id": identifier,
               "split": split, "event_cluster": cluster(identifier), "source_url": doc["source_url"],
               "attribution": doc["source_attribution"], "text_sha256": doc["article_text_sha256"],
               "title": doc["article_text"].splitlines()[0], "source_text": doc["article_text"],
               "proposed_label": "positive" if proposed else "negative", "proposed_facts": proposed,
               "reason": reason, "uncertainty_note": note,
               "annotation_origin": "assistant_draft_from_original_text; no_Qwen_labels",
               "user_approved": False}
        rows.append(row)

packet = {"version": "early-reference-review-v1", "kind": "real_source_human_label_review",
          "source_documents_collected": len(documents), "reference_split_proposal": {"dev": dev_ids, "test": test_ids, "reserve": reserve_ids},
          "official_quality_evaluation_allowed": False, "qwen_test_executed": False,
          "test_positive_documents": sum(row["proposed_label"] == "positive" for row in rows if row["split"] == "test"),
          "test_positive_event_clusters": 1, "dev_sample_documents": 10,
          "limitations": ["Test draft currently has only one positive event cluster; evidence would be weak even if point gates pass.",
                          "No positive hotel_offer references; no supported general accuracy claim for that class.",
                          "Single source domain; historical texts evaluate extraction, not current market conditions.",
                          "Remaining 20 dev drafts still need assistant annotation before a complete 60-document reference set."],
          "rows": rows}
destination = m2 / "label-review"
destination.mkdir(exist_ok=True)
payload = json.dumps(packet, ensure_ascii=False, indent=2)
(destination / "review-packet.json").write_text(payload, encoding="utf8")
digest = hashlib.sha256(payload.encode()).hexdigest()
(destination / "packet.sha256").write_text(digest + "\n", encoding="ascii")

header = '''<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HotelAI — duyệt nhãn tham chiếu M2</title><style>
body{font:16px/1.6 system-ui;margin:0;background:#f4f6f8;color:#17232d}main{max-width:1050px;margin:auto;padding:26px}
section,details{background:white;border:1px solid #d4dde5;border-radius:10px;padding:18px;margin:14px 0}summary{cursor:pointer;font-weight:650}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f7fa;padding:14px;font:14px/1.7 system-ui}textarea{width:98%;min-height:65px}
.notice{border-left:5px solid #b77708;background:#fff6df}button{padding:10px 16px;border:0;border-radius:6px;background:#14526c;color:white;cursor:pointer}
a{color:#14526c}small{color:#516270}label{display:block;margin:10px 0}h1{font-size:27px}</style><main>
<h1>Duyệt nhãn tham chiếu HotelAI — M2</h1>
<section class="notice"><b>CHƯA PHẢI GOLD ĐÃ DUYỆT — CHƯA CHẤM GATE QWEN3.</b>
<p>30 test + 10 dev mẫu, lấy từ văn bản thật và có nguồn. Đây là nhãn trích xuất thông tin, không phải nhãn conversion.</p>
<p><b>Giới hạn cần rà:</b> ba bài test dương đề xuất cùng một hội nghị (một cụm). Tập này còn hẹp; chưa thể khẳng định chất lượng tổng quát hoặc chất lượng loại ưu đãi phòng. Có thể cần bổ sung mẫu dương trước khi khóa test.</p>
<p>Âm nghĩa là chưa đủ bộ loại + địa lý + thời gian hiệu lực + dẫn chứng theo phạm vi v1; không khẳng định nội dung không có giá trị.</p>
<p>Hãy đọc nguồn và từng thông tin; ghi sửa/loại/bổ sung nếu cần. Chưa chắc thì đánh dấu cần sửa. Gửi quyết định trong chat hoặc lưu bản rà soát bằng nút bên dưới. Trang này chạy offline và không gửi dữ liệu lên server.</p></section>
<section><button id="export">Lưu nhận xét JSON</button> <span id="count"></span><br><small>Không có nút tự duyệt tất cả. Nhãn chỉ có hiệu lực sau xác nhận của người dùng.</small></section>
<div id="items"></div><small id="hash"></small>
'''
data = payload.replace("<", "\\u003c")
script = '''<script>
const packet=JSON.parse(document.getElementById('data').textContent), items=document.getElementById('items');
function node(tag,text,parent){const el=document.createElement(tag);el.textContent=text;parent.appendChild(el);return el;}
for(const row of packet.rows){const box=node('details','',items);node('summary',`${row.review_id} · ${row.proposed_label==='positive'?'Dương đề xuất':'Âm đề xuất'} · ${row.title}`,box);
const link=node('a','Mở nguồn gốc',box);link.href=row.source_url;link.target='_blank';link.rel='noopener noreferrer';
node('p',row.reason,box);if(row.uncertainty_note)node('p','CẦN RÀ: '+row.uncertainty_note,box);
node('h3','Thông tin/nhãn đề xuất',box);node('pre',JSON.stringify(row.proposed_facts,null,2),box);
node('h3','Toàn văn đã tách khỏi tin liên quan/bình luận',box);node('pre',row.source_text,box);
const label=node('label','',box), checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.dataset.id=row.review_id;label.append(checkbox,document.createTextNode(' Tôi đã đọc và đồng ý với nhãn đề xuất (nếu cần sửa, để trống và ghi rõ bên dưới).'));
const feedback=node('textarea','',box);feedback.dataset.id=row.review_id;feedback.placeholder='Sửa loại, địa lý, thời gian, dẫn chứng hoặc ghi chưa chắc…';
node('small','Cụm: '+row.event_cluster+' · SHA-256: '+row.text_sha256,box);checkbox.addEventListener('change',count);
}
function count(){document.getElementById('count').textContent=`Đồng ý ${document.querySelectorAll('input:checked').length}/40 mục`;}
document.getElementById('export').onclick=()=>{const reviews=packet.rows.map(r=>({review_id:r.review_id,document_id:r.document_id,approved:document.querySelector(`input[data-id="${r.review_id}"]`).checked,feedback:document.querySelector(`textarea[data-id="${r.review_id}"]`).value}));const blob=new Blob([JSON.stringify({packet_version:packet.version,packet_sha256:document.getElementById('hash').dataset.hash,reviews},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='hotelai-m2-label-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};count();
</script></main></html>'''
page = header + '<script type="application/json" id="data">' + data + '</script>'
page += '<script>document.getElementById("hash").dataset.hash=' + json.dumps(digest) + ';document.getElementById("hash").textContent="Packet SHA-256: "+document.getElementById("hash").dataset.hash;</script>'
page += script
(destination / "index.html").write_text(page, encoding="utf8")
(destination / "README.md").write_text(
    '# Gói nhãn nháp sớm — 30 test + 10 dev\n\nMở `index.html` để đọc toàn văn, dẫn chứng và đề xuất. '
    'Dữ liệu máy đọc: `review-packet.json`; hash ở `packet.sha256`. '
    'Chưa có nhãn được người dùng duyệt, chưa chạy test Qwen3. '
    'Test hiện chỉ có một cụm sự kiện dương: cần rà độ đa dạng trước khi khóa test. '
    '20 dev còn lại chưa có nhãn hoàn chỉnh, 20 văn bản được giữ dự phòng; không tính dự phòng vào bộ tham chiếu 60.\n', encoding='utf8')
print(json.dumps({"packet": str(destination.relative_to(root)), "test": 30, "dev_sample": 10,
                  "test_positive_documents": packet["test_positive_documents"], "positive_clusters": 1,
                  "official_evaluation_allowed": False, "sha256": digest}))
