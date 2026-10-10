import Image from "next/image";
import Link from "next/link";
import { LandingHeader, JourneyStages } from "@/components/landing-navigation";

export default function HomePage() {
  return (
    <div className="landing-page">
      <svg
        className="icon-definitions"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <symbol id="i-arrow" viewBox="0 0 24 24">
            <path d="M5 12h14m-6-6 6 6-6 6" />
          </symbol>
          <symbol id="i-qr" viewBox="0 0 24 24">
            <path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6" />
            <path d="M7 7h3v3H7zm7 0h3v3h-3zM7 14h3v3H7zm7 0h3m-3 0v3h3v-1" />
          </symbol>
          <symbol id="i-leaf" viewBox="0 0 24 24">
            <path d="M20 3c1 12-3 17-10 17-5 0-7-4-5-8S12 6 20 3ZM3 22 16 9" />
          </symbol>
          <symbol id="i-shield" viewBox="0 0 24 24">
            <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6" />
          </symbol>
          <symbol id="i-truck" viewBox="0 0 24 24">
            <path d="M2 5h13v12H2zM15 9h4l3 4v4h-7" />
            <circle cx="6" cy="18" r="2" />
            <circle cx="18" cy="18" r="2" />
          </symbol>
          <symbol id="i-box" viewBox="0 0 24 24">
            <path d="m12 2 9 5v10l-9 5-9-5V7zm0 10v10M3 7l9 5 9-5M7 4l10 6" />
          </symbol>
          <symbol id="i-store" viewBox="0 0 24 24">
            <path d="M3 10h18l-2-7H5zM4 10v11h16V10M9 21v-7h6v7M3 10c0 4 4 4 4 0 0 4 5 4 5 0 0 4 5 4 5 0 0 4 4 4 4 0" />
          </symbol>
          <symbol id="i-check" viewBox="0 0 24 24">
            <path d="m5 12 4 4L19 6" />
          </symbol>
          <symbol id="i-clock" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </symbol>
          <symbol id="i-camera" viewBox="0 0 24 24">
            <path d="M3 6h5l2-3h4l2 3h5v14H3z" />
            <circle cx="12" cy="13" r="4" />
          </symbol>
          <symbol id="i-upload" viewBox="0 0 24 24">
            <path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6" />
          </symbol>
          <symbol id="i-close" viewBox="0 0 24 24">
            <path d="m6 6 12 12M18 6 6 18" />
          </symbol>
          <symbol id="i-menu" viewBox="0 0 24 24">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </symbol>
          <symbol id="i-search" viewBox="0 0 24 24">
            <circle cx="10" cy="10" r="6" />
            <path d="m15 15 6 6" />
          </symbol>
          <symbol id="i-info" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v6m0-10v1" />
          </symbol>
        </defs>
      </svg>
      <a className="skip-link" href="#main">
        Đi đến nội dung
      </a>
      <LandingHeader />
      <main id="main">
        <section className="hero hero-banner" id="top">
          <div className="hero-orbit" aria-hidden="true"></div>
          <div className="container hero-grid">
            <div className="hero-copy">
              <p className="eyebrow light">
                <span className="tiny-dot"></span> TRUY XUẤT NGUỒN GỐC NÔNG SẢN
              </p>
              <h1>
                Mỗi nông sản,
                <br />
                một hành trình <span>minh bạch.</span>
              </h1>
              <p className="hero-description">
                Biết nông sản đến từ đâu, được chăm sóc thế nào và đi qua những
                chặng nào. Một mã QR kết nối bạn với câu chuyện phía sau mỗi lô
                hàng.
              </p>
              <div className="hero-actions">
                <Link className="button" href="/scan">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-qr" />
                  </svg>{" "}
                  Quét QR truy xuất{" "}
                  <svg className="icon arrow">
                    <use href="#i-arrow" />
                  </svg>
                </Link>
                <a className="hero-text-link text-link" href="#how">
                  Khám phá hành trình <span>→</span>
                </a>
              </div>
              <div className="hero-footnote">
                <svg className="icon" aria-hidden="true">
                  <use href="#i-shield" />
                </svg>{" "}
                Tra cứu công khai. Không cần tài khoản.
              </div>
            </div>
            <div className="hero-visual">
              <div className="photo-tag">
                <span className="tiny-dot"></span> TỪ NÔNG TRẠI ĐẾN BÀN ĂN
              </div>
            </div>
          </div>
          <div className="container hero-bottom">
            <span>MINH BẠCH QUA TỪNG CHẶNG</span>
            <div>
              <span>Trang trại</span>
              <i></i>
              <span>Vận chuyển</span>
              <i></i>
              <span>Điểm bán</span>
              <i></i>
              <span>Người tiêu dùng</span>
            </div>
          </div>
        </section>

        <section className="audience-strip" aria-label="Các bên tham gia">
          <div className="container audience-inner stats-row">
            <div className="stat-card">
              <span className="stat-icon">
                <svg className="icon" aria-hidden="true">
                  <use href="#i-leaf" />
                </svg>
              </span>
              <div className="stat-body">
                <strong>Nông trại</strong>
                <span className="stat-label">Ghi nhận nguồn gốc</span>
              </div>
            </div>
            <div className="stat-card">
              <span className="stat-icon">
                <svg className="icon" aria-hidden="true">
                  <use href="#i-truck" />
                </svg>
              </span>
              <div className="stat-body">
                <strong>Vận chuyển</strong>
                <span className="stat-label">Kết nối hành trình</span>
              </div>
            </div>
            <div className="stat-card">
              <span className="stat-icon">
                <svg className="icon" aria-hidden="true">
                  <use href="#i-store" />
                </svg>
              </span>
              <div className="stat-body">
                <strong>Nhà bán lẻ</strong>
                <span className="stat-label">Tiếp nhận lô hàng</span>
              </div>
            </div>
            <div className="stat-card">
              <span className="stat-icon">
                <svg className="icon" aria-hidden="true">
                  <use href="#i-qr" />
                </svg>
              </span>
              <div className="stat-body">
                <strong>Người tiêu dùng</strong>
                <span className="stat-label">Tra cứu bằng QR</span>
              </div>
            </div>
          </div>
        </section>

        <section className="section problem-section">
          <div className="container panel">
            <div className="section-heading split-heading">
              <div>
                <p className="eyebrow">TỪ CÂU HỎI ĐẾN NIỀM TIN</p>
                <h2>
                  Nông sản có hành trình.
                  <br />
                  Thông tin cũng cần như vậy.
                </h2>
              </div>
              <p className="section-intro">
                Khi nhật ký canh tác, thu hoạch và giao nhận nằm ở nhiều nơi,
                việc biết nguồn gốc một lô hàng trở nên khó khăn. AgriTrace kết
                nối những mảnh thông tin đó.
              </p>
            </div>
            <div className="problem-grid">
              <article>
                <span className="number-label">01 / NGUỒN GỐC</span>
                <h3>Không chỉ là tên trên nhãn.</h3>
                <p>
                  Liên kết lô hàng với nông trại, thửa đất và chu kỳ sản xuất đã
                  tạo ra nó.
                </p>
              </article>
              <article>
                <span className="number-label">02 / HÀNH TRÌNH</span>
                <h3>Giao nhận có dấu vết.</h3>
                <p>
                  Kết nối các mốc thu hoạch, vận chuyển và tiếp nhận thành lịch
                  sử có thể tra cứu.
                </p>
              </article>
              <article>
                <span className="number-label">03 / BẰNG CHỨNG</span>
                <h3>Thông tin có thể đối chiếu.</h3>
                <p>
                  Hiển thị trạng thái xác minh dữ liệu để biết bằng chứng đã
                  được xác nhận hay còn đang chờ.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="section how-section" id="how">
          <div className="container panel">
            <div className="section-heading">
              <p className="eyebrow">MỘT HÀNH TRÌNH LIÊN TỤC</p>
              <h2>Từ mầm xanh đến mã QR.</h2>
              <p className="section-intro">
                Mỗi bước được gắn với đúng lô nông sản, để câu chuyện nguồn gốc
                không bị đứt đoạn khi sản phẩm di chuyển.
              </p>
            </div>
            <div className="process-grid">
              <article>
                <div className="step-top">
                  <span>01</span>
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-leaf" />
                  </svg>
                </div>
                <h3>Sản xuất</h3>
                <p>Khởi tạo chu kỳ, ghi nhận gieo trồng và nhật ký chăm sóc.</p>
                <span className="step-caption">BẮT ĐẦU TẠI NÔNG TRẠI</span>
              </article>
              <article>
                <div className="step-top">
                  <span>02</span>
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-box" />
                  </svg>
                </div>
                <h3>Thu hoạch</h3>
                <p>
                  Mỗi lần thu hoạch tạo một lô riêng, có lượng thu hoạch và mã
                  QR.
                </p>
                <span className="step-caption">MỖI LÔ, MỘT ĐỊNH DANH</span>
              </article>
              <article>
                <div className="step-top">
                  <span>03</span>
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-truck" />
                  </svg>
                </div>
                <h3>Vận chuyển</h3>
                <p>Gán đơn vị vận chuyển, ghi các mốc bắt đầu và đến nơi.</p>
                <span className="step-caption">GIỮ DẤU VẾT GIAO NHẬN</span>
              </article>
              <article>
                <div className="step-top">
                  <span>04</span>
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-store" />
                  </svg>
                </div>
                <h3>Tiếp nhận</h3>
                <p>Nhà bán lẻ ghi nhận tiếp nhận hoặc từ chối lô được giao.</p>
                <span className="step-caption">RÕ RÀNG TẠI ĐIỂM ĐẾN</span>
              </article>
              <article>
                <div className="step-top">
                  <span>05</span>
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-qr" />
                  </svg>
                </div>
                <h3>Tra cứu QR</h3>
                <p>
                  Người tiêu dùng xem lịch sử công khai và trạng thái bằng
                  chứng.
                </p>
                <span className="step-caption">MỘT LẦN QUÉT ĐỂ HIỂU</span>
              </article>
            </div>
            <p className="inline-note">
              <svg className="icon" aria-hidden="true">
                <use href="#i-info" />
              </svg>{" "}
              Một chu kỳ sản xuất có thể có nhiều lần thu hoạch. Mỗi lô giữ lịch
              sử của lần thu hoạch tạo ra nó.
            </p>
          </div>
        </section>

        <section className="section journey-section" id="journey">
          <div className="container journey-grid panel">
            <div className="journey-photo-wrap">
              <Image
                src="/farm-landscape.png"
                alt="Nông trại và khu vực canh tác"
                width="1536"
                height="1024"
                loading="lazy"
              />
              <span className="image-label">CÂU CHUYỆN BẮT ĐẦU TỪ ĐẤT</span>
              <div className="image-quote">
                Đi xa đến đâu,
                <br />
                <strong>vẫn biết nơi bắt đầu.</strong>
              </div>
            </div>
            <div className="journey-copy">
              <p className="eyebrow">THEO DẤU MỘT LÔ NÔNG SẢN</p>
              <h2>
                Một lô hàng.
                <br />
                Nhiều chặng kết nối.
              </h2>
              <p className="section-intro">
                Khám phá cách thông tin đi cùng sản phẩm qua từng bước trong
                chuỗi cung ứng.
              </p>
              <JourneyStages />
            </div>
          </div>
        </section>

        <section className="section evidence-section" id="evidence">
          <div className="container panel">
            <div className="section-heading split-heading">
              <div>
                <p className="eyebrow light">
                  MINH BẠCH CẢ TRẠNG THÁI BẰNG CHỨNG
                </p>
                <h2>
                  Niềm tin cần thông tin.
                  <br />
                  <span>Và thông tin cần đối chiếu.</span>
                </h2>
              </div>
              <p className="section-intro">
                AgriTrace liên kết sự kiện truy xuất với bằng chứng trên
                Hyperledger Fabric. Trạng thái được hiển thị theo kết quả xác
                minh của từng lô.
              </p>
            </div>
            <div className="proof-grid">
              <article>
                <span className="proof-symbol verified">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-shield" />
                  </svg>
                </span>
                <span className="status-pill verified">ĐÃ XÁC MINH</span>
                <h3>Bằng chứng đã khớp.</h3>
                <p>
                  Các bằng chứng liên quan được xác nhận và mã băm dữ liệu khớp
                  với lịch sử ghi nhận.
                </p>
              </article>
              <article>
                <span className="proof-symbol pending">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-clock" />
                  </svg>
                </span>
                <span className="status-pill pending">ĐANG CHỜ</span>
                <h3>Chưa có đủ xác nhận.</h3>
                <p>
                  Sự kiện đã ghi nhận nhưng bằng chứng còn chờ xác nhận trên
                  blockchain.
                </p>
              </article>
              <article>
                <span className="proof-symbol unavailable">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-info" />
                  </svg>
                </span>
                <span className="status-pill unavailable">CẦN KIỂM TRA</span>
                <h3>Hiển thị đúng vấn đề.</h3>
                <p>
                  Sai lệch dữ liệu và lỗi kết nối có trạng thái riêng để người
                  tra cứu hiểu kết quả.
                </p>
              </article>
            </div>
            <div className="evidence-note">
              <svg className="icon" aria-hidden="true">
                <use href="#i-info" />
              </svg>
              <p>
                Xác minh blockchain giúp kiểm tra{" "}
                <strong>tính toàn vẹn của lịch sử dữ liệu</strong>. Chất lượng
                nông sản cần được đánh giá bằng các bằng chứng và quy trình kiểm
                định phù hợp.
              </p>
            </div>
          </div>
        </section>

        <section className="section roles-section" id="roles">
          <div className="container panel">
            <div className="section-heading">
              <p className="eyebrow">
                CÙNG MỘT CHUỖI, CÙNG MỘT NGUỒN THÔNG TIN
              </p>
              <h2>Mỗi vai trò, một giá trị.</h2>
              <p className="section-intro">
                Từ người trồng đến người mua, mỗi bên tiếp cận thông tin và thực
                hiện công việc phù hợp với vai trò của mình.
              </p>
            </div>
            <div className="role-grid">
              <article>
                <span className="role-icon">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-leaf" />
                  </svg>
                </span>
                <span className="role-number">01</span>
                <h3>Nông trại</h3>
                <p>
                  Quản lý chu kỳ sản xuất, nhật ký chăm sóc, thu hoạch và lô
                  nông sản thuộc tổ chức.
                </p>
                <span className="role-footer">GHI NHẬN NGUỒN GỐC</span>
              </article>
              <article>
                <span className="role-icon">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-truck" />
                  </svg>
                </span>
                <span className="role-number">02</span>
                <h3>Đơn vị vận chuyển</h3>
                <p>
                  Thực hiện vận chuyển trên chuyến được gán, cập nhật các mốc di
                  chuyển và bàn giao.
                </p>
                <span className="role-footer">KẾT NỐI HÀNH TRÌNH</span>
              </article>
              <article>
                <span className="role-icon">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-store" />
                  </svg>
                </span>
                <span className="role-number">03</span>
                <h3>Nhà bán lẻ</h3>
                <p>
                  Ghi nhận tiếp nhận hoặc từ chối, tra cứu thông tin lô được
                  giao đến tổ chức.
                </p>
                <span className="role-footer">RÕ RÀNG KHI TIẾP NHẬN</span>
              </article>
              <article>
                <span className="role-icon">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-qr" />
                  </svg>
                </span>
                <span className="role-number">04</span>
                <h3>Người tiêu dùng</h3>
                <p>
                  Quét QR để xem nguồn gốc, lịch sử và trạng thái xác minh của
                  dữ liệu công khai.
                </p>
                <span className="role-footer">HIỂU TRƯỚC KHI CHỌN</span>
              </article>
            </div>
            <p className="inline-note">
              <svg className="icon" aria-hidden="true">
                <use href="#i-shield" />
              </svg>{" "}
              Quản trị viên quản lý tổ chức, tài khoản và danh mục. Kiểm toán
              viên tra cứu lịch sử, bằng chứng theo quyền được cấp.
            </p>
          </div>
        </section>

        <section className="section try-section" id="try">
          <div className="container">
            <div className="try-card">
              <div className="try-copy">
                <p className="eyebrow">TRA CỨU NGUỒN GỐC</p>
                <h2>
                  Quét một mã.
                  <br />
                  Hiểu cả hành trình.
                </h2>
                <p>
                  Mở camera, tải ảnh QR hoặc nhập mã truy xuất trên sản phẩm để
                  tìm hiểu nguồn gốc và lịch sử lô nông sản.
                </p>
                <div className="try-actions">
                  <Link className="button" href="/scan">
                    <svg className="icon" aria-hidden="true">
                      <use href="#i-qr" />
                    </svg>{" "}
                    Quét QR ngay{" "}
                    <svg className="icon" aria-hidden="true">
                      <use href="#i-arrow" />
                    </svg>
                  </Link>
                </div>
              </div>
              <div className="trace-guide">
                <h3>Thông tin đi cùng sản phẩm</h3>
                <ul className="trace-benefits">
                  <li>
                    <svg className="icon" aria-hidden="true">
                      <use href="#i-leaf" />
                    </svg>
                    <div>
                      <strong>Nguồn gốc nông sản</strong>
                      <span>Nông trại và chu kỳ sản xuất liên quan.</span>
                    </div>
                  </li>
                  <li>
                    <svg className="icon" aria-hidden="true">
                      <use href="#i-truck" />
                    </svg>
                    <div>
                      <strong>Lịch sử hành trình</strong>
                      <span>Các mốc thu hoạch, vận chuyển và tiếp nhận.</span>
                    </div>
                  </li>
                  <li>
                    <svg className="icon" aria-hidden="true">
                      <use href="#i-shield" />
                    </svg>
                    <div>
                      <strong>Trạng thái bằng chứng</strong>
                      <span>Kết quả xác minh dữ liệu được công khai.</span>
                    </div>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="section faq-section">
          <div className="container faq-grid panel">
            <div>
              <p className="eyebrow">NHỮNG ĐIỀU BẠN MUỐN BIẾT</p>
              <h2>
                Hiểu rõ trước
                <br />
                khi bắt đầu.
              </h2>
            </div>
            <div className="faq-list">
              <details>
                <summary>Tôi có cần tài khoản để xem nguồn gốc?</summary>
                <p>
                  Không. Trang tra cứu QR công khai dành cho người tiêu dùng có
                  thể mở mà không cần đăng nhập hay ví blockchain.
                </p>
              </details>
              <details>
                <summary>Mã QR cho tôi biết những gì?</summary>
                <p>
                  Nguồn gốc lô nông sản, chu kỳ sản xuất liên quan, các sự kiện
                  được công khai trong lịch sử và trạng thái xác minh bằng
                  chứng.
                </p>
              </details>
              <details>
                <summary>
                  “Đã xác minh” có nghĩa nông sản được chứng nhận an toàn?
                </summary>
                <p>
                  Trạng thái này thể hiện tính toàn vẹn của dữ liệu lịch sử sau
                  khi đối chiếu bằng chứng. Việc đánh giá an toàn và chất lượng
                  sản phẩm cần các chứng nhận, phép thử và quy trình chuyên môn
                  riêng.
                </p>
              </details>
              <details>
                <summary>Tôi quét QR truy xuất thế nào?</summary>
                <p>
                  Chọn Quét QR và cho phép camera để đọc mã trên sản phẩm. Bạn
                  cũng có thể tải ảnh chứa QR hoặc nhập mã truy xuất. Kết quả
                  được mở trên hệ thống AgriTrace để xem thông tin công khai của
                  lô nông sản.
                </p>
              </details>
            </div>
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <div className="container footer-top">
          <div>
            <a className="brand" href="#top">
              <Image
                src="/agritrace/brand/agritrace-logo.svg"
                alt="AgriTrace"
                width="170"
                height="47"
                loading="lazy"
              />
            </a>
            <p>
              Nguồn gốc rõ ràng.
              <br />
              Hành trình có thể tra cứu.
            </p>
          </div>
          <div className="footer-links">
            <a href="#how">Cách hoạt động</a>
            <a href="#evidence">Sự minh bạch</a>
            <Link className="text-button" href="/scan">
              Quét QR
            </Link>
          </div>
        </div>
        <div className="container footer-bottom">
          <span>AgriTrace · Truy xuất nguồn gốc nông sản</span>
          <span>Kết nối chuỗi nông sản · 2026</span>
          <a href="#top">Về đầu trang ↑</a>
        </div>
      </footer>
    </div>
  );
}
