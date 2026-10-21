// Technical notice for the private development pilot. NOT a production policy.
export const devConsumerNotice = {
  version: "DEV-CONSUMER-TEST-20261020",
  sections: [
    {
      title: "Thử nghiệm xác minh thật — chưa phát hành",
      body: "Chỉ dùng số điện thoại của chính bạn và hồ sơ thử nghiệm. Nhấn gửi mã sẽ liên hệ Google Firebase để gửi/kiểm SMS; có thể phát sinh phí cho dự án. Không chia sẻ mã OTP.",
    },
    {
      title: "Dữ liệu được xử lý",
      body: "Firebase nhận số điện thoại và thông tin kỹ thuật xác minh. API AgriTrace nhận số điện thoại, họ tên, tỉnh/phường, email/địa chỉ tùy chọn và phiên bản thông báo bạn đồng ý để lưu hồ sơ thử nghiệm. Mật khẩu được băm; mã OTP không gửi tới API. Không có analytics trong luồng này.",
    },
    {
      title: "Phiên trên thiết bị",
      body: "Access token và hồ sơ chỉ ở bộ nhớ; refresh credential ở kho bảo mật thiết bị. Lịch sử QR vẫn là dữ liệu công khai cục bộ, không đồng bộ lên server. Đăng xuất khi thử nghiệm xong.",
    },
    {
      title: "Chưa phải chính sách chính thức",
      body: "Đây là thông báo kỹ thuật cho bản dev, chưa thay thế Điều khoản/Chính sách đã duyệt. Không dùng bản này cho người dùng bên ngoài. Production chưa mở đăng ký; chính sách đầy đủ sẽ được chủ dự án duyệt riêng.",
    },
  ],
};
