import Link from "next/link";
import "@/styles/registration.css";
export function RegistrationPolicy({ privacy = false }: { privacy?: boolean }) {
  return (
    <div className="reg-shell">
      <article className="reg-card">
        <p className="eyebrow">AGRITRACE · PHIÊN BẢN 18/10/2026</p>
        <h1>{privacy ? "Chính sách quyền riêng tư" : "Điều khoản sử dụng"}</h1>
        <p className="notice">
          Nội dung áp dụng cho môi trường review của AgriTrace, đang được chủ dự
          án xem xét trước khi sử dụng chính thức.
        </p>
        {privacy ? (
          <>
            <h2>Thông tin được tiếp nhận</h2>
            <p>
              Hồ sơ gồm thông tin tổ chức/chủ thể, người đại diện, liên hệ, quản
              trị viên, hoạt động, lựa chọn dịch vụ và tài liệu bạn chủ động
              cung cấp. Mật khẩu được băm; mã OTP và bằng chứng xác thực không
              hiển thị trong hồ sơ xét duyệt. Không yêu cầu tải ảnh CCCD trong
              biểu mẫu này.
            </p>
            <h2>Mục đích và quyền truy cập</h2>
            <p>
              Thông tin phục vụ xác thực email, xét duyệt hồ sơ, quản lý tài
              khoản và cung cấp dịch vụ. Tài liệu đăng ký và ủy quyền chỉ cho
              chủ hồ sơ và quản trị viên nền tảng có quyền truy cập; không tự
              công khai lên trang QR. Công bố chứng nhận trên trang truy xuất là
              bước riêng có xét duyệt.
            </p>
            <h2>Lưu trữ và yêu cầu của bạn</h2>
            <p>
              Hồ sơ, lịch sử xét duyệt và tài liệu đã nộp được lưu để đối chiếu.
              Bạn có thể gửi yêu cầu quyền dữ liệu cá nhân trong mục Tài khoản
              sau khi đăng nhập; yêu cầu sẽ được xem xét và phản hồi. Việc gửi
              yêu cầu không tự xóa lịch sử truy xuất hoặc bằng chứng đã ghi.
            </p>
            <h2>Thông báo và tiếp thị</h2>
            <p>
              Email xác thực, xét duyệt và giao dịch dịch vụ phục vụ việc vận
              hành tài khoản. Lựa chọn nhận tin giới thiệu dịch vụ là tùy chọn
              riêng và mặc định không được chọn.
            </p>
          </>
        ) : (
          <>
            <h2>Đăng ký và xét duyệt</h2>
            <p>
              Bạn cung cấp thông tin chính xác, có quyền đại diện hoặc được ủy
              quyền hợp lệ. Nộp hồ sơ không đồng nghĩa đã được duyệt, có quyền
              nghiệp vụ hay kết nối thành công với mạng sổ cái.
            </p>
            <h2>Trách nhiệm với tài khoản và dữ liệu</h2>
            <p>
              Quản trị viên doanh nghiệp bảo vệ thông tin đăng nhập, phân quyền
              đúng cho nhân sự và chỉ ghi dữ liệu thuộc phạm vi được giao. Không
              cung cấp khóa ký riêng, mật khẩu của hệ thống khác hoặc tài liệu
              không thuộc quyền sử dụng của mình.
            </p>
            <h2>Dịch vụ và bằng chứng truy xuất</h2>
            <p>
              Lựa chọn dịch vụ tại bước đăng ký phục vụ tiếp nhận hồ sơ. Báo
              giá, hợp đồng và kích hoạt được xử lý sau xét duyệt. Thông tin QR
              và trạng thái bằng chứng không thay thế chứng nhận chất lượng hay
              quyết định của đơn vị kiểm định.
            </p>
            <h2>Phạm vi môi trường review</h2>
            <p>
              Thanh toán hiện là mô phỏng, chưa thu tiền thật. Tính năng, hồ sơ
              và thông báo trong bản review phục vụ đánh giá sản phẩm; chưa phải
              cam kết phát hành hoặc cung cấp dịch vụ chính thức.
            </p>
          </>
        )}
        <Link className="button secondary" href="/register">
          Về biểu mẫu đăng ký
        </Link>
      </article>
    </div>
  );
}
