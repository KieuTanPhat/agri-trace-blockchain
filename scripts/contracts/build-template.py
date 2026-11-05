"""Author the versioned, static test contract; runtime only overlays user fields."""
from pathlib import Path
import hashlib, json, textwrap
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
root=Path(__file__).resolve().parents[2]
assets=root/'apps/api/assets/contracts'
pdfmetrics.registerFont(TTFont('Noto',str(assets/'fonts/NotoSans-Regular.ttf')))
pdfmetrics.registerFont(TTFont('NotoBold',str(assets/'fonts/NotoSans-Bold.ttf')))
out=assets/'service-test-v1.pdf'
c=canvas.Canvas(str(out),pagesize=(595.28,841.89),invariant=1)
c.setTitle('AgriTrace - Mẫu hợp đồng dịch vụ thử nghiệm v1')
def txt(x,y,t,size=10,bold=False,color='#243b32'):
 c.setFillColor(color);c.setFont('NotoBold' if bold else 'Noto',size);c.drawString(x,y,t)
def head(page):
 txt(40,795,'AGRITRACE',17,True,'#067044');txt(40,774,'HỢP ĐỒNG DỊCH VỤ · MẪU THỬ NGHIỆM',11,True)
 c.setStrokeColorRGB(.78,.84,.8);c.line(40,758,555,758)
 txt(40,30,'service-test-v1 · Chưa dùng để ký kết thương mại',8,color='#68796e');txt(504,30,f'{page} / 2',8)
def field(label,y):
 txt(40,y,label.upper(),8,True,'#66786c')
 c.setStrokeColorRGB(.84,.88,.85);c.line(40,y-54,555,y-54)
head(1);txt(40,734,'01  THÔNG TIN CHỦ THỂ',12,True)
for label,y in [('Doanh nghiệp / tổ chức',709),('Người đại diện · Mã số thuế',634),('Tên thanh toán',559),('Địa chỉ thanh toán',484),('Email nhận hợp đồng',389)]:field(label,y)
txt(40,302,'02  GÓI DỊCH VỤ ĐƯỢC CHỌN',12,True)
# Dynamic summary and issue reference are merged here by the API.
txt(40,115,'Phạm vi và điều kiện sử dụng được ghi tại trang 2.',9)
txt(40,94,'Xác nhận trên Web ghi nhận sự đồng ý với đúng bản PDF đang xem.',9)
txt(40,73,'Đây là mẫu kiểm thử luồng; không phải chữ ký số hoặc hóa đơn thuế.',9)
c.showPage();head(2);txt(40,734,'03  NỘI DUNG HỢP TÁC THỬ NGHIỆM',12,True)
sections=[
('1. Phạm vi dịch vụ','AgriTrace cung cấp chức năng truy xuất nguồn gốc theo gói tại trang 1: quản lý hồ sơ sản phẩm, vùng sản xuất, vụ, nhật ký chăm sóc, thu hoạch, lô hàng và mã QR. Không bao gồm kế toán hoặc quản trị hoạt động nội bộ doanh nghiệp.'),
('2. Thời hạn và chi phí','Thời hạn, phí khởi tạo, phí duy trì và hạn mức sử dụng theo phiên bản giá được hệ thống ghi nhận khi lập hợp đồng. Thuế và phí ngoài gói chưa được xác định trong mẫu thử nghiệm. Chưa sử dụng mẫu này để thu tiền thương mại.'),
('3. Thanh toán và kích hoạt','Dịch vụ chỉ được kích hoạt khi máy chủ xác nhận giao dịch hợp lệ và hồ sơ, năng lực đáp ứng điều kiện. Quét QR hoặc đóng hộp thanh toán không phải bằng chứng thanh toán. Giao dịch thử nghiệm được ghi riêng, không ghi nhận doanh thu thật.'),
('4. Trách nhiệm của doanh nghiệp','Doanh nghiệp chịu trách nhiệm về thông tin đăng ký, dữ liệu truy xuất và phân quyền nhân viên; chỉ cung cấp ảnh, chứng từ được phép sử dụng. Các dữ liệu pháp lý và liên hệ riêng tư không được công khai qua QR.'),
('5. Kết nối blockchain','Hệ thống chuẩn bị kết nối blockchain theo quy trình riêng. Thanh toán, kích hoạt tài khoản và trạng thái ghi sổ là các kết quả khác nhau; chỉ ghi lên chuỗi khi kết nối và quyền đã được xác nhận.'),
('6. Lưu trữ và đối chiếu','Bản PDF được giữ nguyên sau xác nhận, lưu kèm mã kiểm tra SHA-256 và gửi đến email thanh toán khi giao dịch hoàn tất. Hệ thống lưu lịch sử chọn gói, xem hợp đồng, xác nhận và thanh toán để đối chiếu.'),
('7. Giá trị của mẫu','Mẫu này phục vụ kiểm thử kỹ thuật. Nội dung pháp lý, thuế, bên cung cấp và điều kiện thương mại cần được hoàn thiện, phê duyệt trước khi đưa vào sử dụng chính thức. Thao tác xác nhận không tạo chữ ký điện tử có chứng thư.'),
]
y=704
for title,body in sections:
 txt(40,y,title,10,True);y-=19
 words=body.split();line=''
 for word in words:
  candidate=(line+' '+word).strip()
  if pdfmetrics.stringWidth(candidate,'Noto',9)>510:
   txt(40,y,line,9);y-=14;line=word
  else:line=candidate
 if line:txt(40,y,line,9);y-=14
 y-=17
c.save()
(assets/'template-manifest.json').write_text(json.dumps({'version':'service-test-v1','sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'fontSha256':hashlib.sha256((assets/'fonts/NotoSans-Regular.ttf').read_bytes()).hexdigest()},indent=2)+'\n')
print(out)
