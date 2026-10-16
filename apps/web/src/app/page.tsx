import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  Check,
  ClipboardCheck,
  FileCheck2,
  Fingerprint,
  Leaf,
  Mail,
  MessageCircle,
  PackageCheck,
  QrCode,
  ScanLine,
  ShieldCheck,
  Sprout,
  Store,
  Truck,
  Users,
} from "lucide-react";
import { SiteFooter, ZaloFloat } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { Reveal } from "@/components/ui/reveal";
import { SITE_CONTACT } from "@/lib/site-contact";

const delay = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

const technologies = [
  "Hyperledger Fabric",
  "Chữ ký số khi bàn giao",
  "Một lô, một mã QR",
  "Bằng chứng đối chiếu được",
  "Chứng nhận có người duyệt",
  "Tra cứu công khai",
];

const values = [
  {
    icon: Sprout,
    kicker: "Nguồn gốc",
    title: "Biết chính xác nông sản đến từ đâu.",
    text: "Mỗi lần thu hoạch tạo một lô riêng, gắn với nông trại và vụ trồng đã tạo ra nó.",
  },
  {
    icon: ClipboardCheck,
    kicker: "Bằng chứng sản xuất",
    title: "Chứng minh nông sản được làm ra thế nào.",
    text: "Nhật ký chăm sóc, dữ liệu cảm biến và các mốc thời gian đi cùng lô, không phải dựng lại sau mùa vụ.",
  },
  {
    icon: FileCheck2,
    kicker: "Tuân thủ",
    title: "Giữ chứng nhận đúng đối tượng.",
    text: "Chứng nhận và kết quả kiểm định gắn với đúng vụ hoặc lô, do người được phân công xem xét.",
  },
  {
    icon: QrCode,
    kicker: "Niềm tin người mua",
    title: "Biến dữ liệu thành câu chuyện kiểm chứng được.",
    text: "Quét QR để xem nguồn gốc, hành trình và trạng thái bằng chứng được công khai.",
  },
];

const features = [
  {
    icon: Leaf,
    eyebrow: "Truy xuất sản xuất",
    title: "Từ vụ trồng đến từng lô thu hoạch.",
    text: "Ghi nhận gieo trồng, chăm sóc và các lần thu hoạch. Mỗi lần thu hoạch tạo đúng một lô và một mã QR.",
    points: [
      "Một vụ trồng có thể có nhiều lần thu hoạch",
      "Mỗi lô giữ lịch sử của lần thu hoạch đã tạo ra nó",
      "Dữ liệu cảm biến được chốt theo từng lần thu hoạch",
    ],
    image: "/farm-landscape.png",
    imageAlt: "Nông trại và khu vực canh tác",
  },
  {
    icon: BadgeCheck,
    eyebrow: "Kiểm định và chứng nhận",
    title: "Chứng nhận gắn với đúng đối tượng.",
    text: "Trang trại nộp chứng nhận, người kiểm định được phân công xem xét và duyệt. Quản trị viên và kiểm toán viên không thể tự duyệt.",
    points: [
      "Chứng nhận thay thế giữ bản cũ cho đến khi bản mới được duyệt",
      "Kiểm định viên chỉ thấy các trang trại được phân công",
      "Chỉ chứng nhận công khai còn hiệu lực mới hiển thị cho người mua",
    ],
    image: null,
    imageAlt: "",
  },
  {
    icon: ScanLine,
    eyebrow: "Trang dành cho người tiêu dùng",
    title: "Một lần quét, hiểu cả hành trình.",
    text: "Trang truy xuất mở ngay trên điện thoại, không cần tài khoản hay ví blockchain.",
    points: [
      "Cảnh báo thu hồi hoặc hết hạn luôn hiện trước tiên",
      "Lịch sử thu hoạch, vận chuyển và tiếp nhận theo thời gian",
      "Trạng thái xác minh bằng chứng hiển thị rõ ràng",
    ],
    image: "/farm-greens.png",
    imageAlt: "Rau xanh tại vườn",
  },
];

const steps = [
  { icon: Sprout, title: "Đăng ký nguồn", text: "Tổ chức, trang trại và vụ trồng được khai báo thành một hồ sơ sản xuất." },
  { icon: ClipboardCheck, title: "Ghi nhận sản xuất", text: "Gieo trồng, chăm sóc và dữ liệu cảm biến được ghi theo thời gian." },
  { icon: FileCheck2, title: "Kiểm định, chứng nhận", text: "Chứng nhận được nộp, xem xét và duyệt bởi người được phân công." },
  { icon: Boxes, title: "Thu hoạch, tạo lô", text: "Mỗi lần thu hoạch tạo một lô có sản lượng và mã QR riêng." },
  { icon: Truck, title: "Vận chuyển, bàn giao", text: "Lô được giao qua đơn vị vận chuyển đến điểm bán với các mốc giao nhận." },
  { icon: PackageCheck, title: "Công khai truy xuất", text: "Người mua quét QR để xem lịch sử và trạng thái bằng chứng." },
];

const chain = [
  { icon: Leaf, title: "Nông trại", text: "Quản lý vụ trồng, nhật ký chăm sóc, thu hoạch và lô thuộc tổ chức." },
  { icon: Truck, title: "Đơn vị vận chuyển", text: "Thực hiện chuyến được gán, cập nhật mốc di chuyển và bàn giao." },
  { icon: Store, title: "Nhà bán lẻ", text: "Ghi nhận tiếp nhận hoặc từ chối, tra cứu thông tin lô được giao." },
  { icon: Users, title: "Người tiêu dùng", text: "Quét QR để xem nguồn gốc, lịch sử và trạng thái xác minh." },
];

const faqs = [
  {
    q: "Tôi có cần tài khoản để xem nguồn gốc?",
    a: "Không. Trang tra cứu QR công khai dành cho người tiêu dùng mở được mà không cần đăng nhập hay ví blockchain.",
  },
  {
    q: "Mã QR cho tôi biết những gì?",
    a: "Nguồn gốc lô nông sản, vụ trồng liên quan, các sự kiện được công khai trong lịch sử và trạng thái xác minh bằng chứng.",
  },
  {
    q: "“Đã xác minh” có nghĩa nông sản được chứng nhận an toàn?",
    a: "Trạng thái này thể hiện tính toàn vẹn của dữ liệu lịch sử sau khi đối chiếu bằng chứng. Đánh giá an toàn và chất lượng cần các chứng nhận, phép thử và quy trình chuyên môn riêng.",
  },
  {
    q: "Tôi quét QR truy xuất thế nào?",
    a: "Chọn Quét QR và cho phép camera đọc mã trên sản phẩm. Bạn cũng có thể tải ảnh chứa QR hoặc nhập mã truy xuất.",
  },
  {
    q: "Doanh nghiệp của tôi muốn triển khai AgriTrace thì làm gì?",
    a: `Liên hệ qua email ${SITE_CONTACT.email} hoặc Zalo ${SITE_CONTACT.zaloPhone}. Chúng tôi sẽ trao đổi về sản phẩm, quy trình và chuỗi cung ứng của bạn.`,
  },
];

export default function HomePage() {
  return (
    <div className="landing">
      <a className="skip-link" href="#main">
        Đi đến nội dung
      </a>
      <SiteHeader />
      <main id="main">
        <section className="lp-hero" id="top">
          <div className="container lp-hero-grid">
            <div className="lp-hero-copy">
              <p className="eyebrow eyebrow-pill enter">
                Truy xuất nguồn gốc nông sản Việt
              </p>
              <h1 className="enter" style={delay(80)}>
                Biến dữ liệu nông trại thành truy xuất nguồn gốc{" "}
                <span className="accent-text">có thể chứng minh.</span>
              </h1>
              <p className="lp-lead enter" style={delay(160)}>
                AgriTrace kết nối vụ trồng, thu hoạch, giao nhận và chứng nhận với
                từng lô nông sản. Một mã QR giúp người mua xem nguồn gốc, hành
                trình và trạng thái bằng chứng.
              </p>
              <p className="lp-promise enter" style={delay(220)}>
                Dữ liệu nông trại · Bằng chứng sản xuất · Niềm tin người tiêu dùng
              </p>
              <div className="lp-actions enter" style={delay(280)}>
                <Link className="button" href="/scan">
                  <QrCode size={18} /> Quét mã QR <ArrowRight size={18} />
                </Link>
                <Link className="button secondary" href="/#contact">
                  Liên hệ tư vấn
                </Link>
              </div>
              <p className="lp-note enter" style={delay(340)}>
                <ShieldCheck size={16} /> Tra cứu công khai. Không cần tài khoản.
              </p>
            </div>
            <div className="lp-hero-visual enter-right" style={delay(200)}>
              <div className="lp-photo">
                <Image
                  src="/farm-greens.png"
                  alt="Rau xanh tươi tại nông trại"
                  fill
                  priority
                  sizes="(max-width: 900px) 100vw, 560px"
                />
              </div>
              <div className="lp-phone float" aria-hidden="true">
                <div className="lp-phone-bar" />
                <div className="lp-phone-head">
                  <span className="lp-phone-logo" />
                  <span className="lp-phone-line wide" />
                </div>
                <div className="lp-phone-status">
                  <Check size={14} /> Đã xác minh
                </div>
                <div className="lp-phone-steps">
                  <span><Sprout size={14} /> Trang trại</span>
                  <span><Truck size={14} /> Vận chuyển</span>
                  <span><Store size={14} /> Điểm bán</span>
                </div>
                <div className="lp-phone-line" />
                <div className="lp-phone-line short" />
              </div>
              <div className="lp-chip lp-chip-a" aria-hidden="true">
                <Fingerprint size={16} /> Một lô, một mã QR
              </div>
            </div>
          </div>
        </section>

        <section className="lp-trust" aria-label="Nền tảng và nguyên tắc">
          <div className="lp-marquee">
            <div className="marquee-track">
              {[0, 1].map((copy) => (
                <ul key={copy} aria-hidden={copy === 1 ? true : undefined}>
                  {technologies.map((item) => (
                    <li key={item}>
                      <Check size={16} /> {item}
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section" id="solution">
          <div className="container">
            <Reveal className="lp-heading">
              <p className="eyebrow">Khi mỗi lô được hậu thuẫn bởi dữ liệu thật</p>
              <h2>Điều thay đổi khi nông sản có hồ sơ sản xuất.</h2>
            </Reveal>
            <ul className="lp-values" role="list">
              {values.map(({ icon: Icon, kicker, title, text }, index) => (
                <Reveal as="li" className="lp-value" delay={index * 70} key={kicker}>
                  <span className="lp-icon"><Icon size={22} /></span>
                  <p className="eyebrow">{kicker}</p>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-section lp-section-cream">
          <div className="container lp-features">
            {features.map(({ icon: Icon, eyebrow, title, text, points, image, imageAlt }, index) => (
              <Reveal className="lp-feature" key={eyebrow}>
                <div className="lp-feature-copy">
                  <p className="eyebrow"><Icon size={16} /> {eyebrow}</p>
                  <h2>{title}</h2>
                  <p className="lp-lead">{text}</p>
                  <ul className="lp-ticks" role="list">
                    {points.map((point) => (
                      <li key={point}><Check size={18} /> {point}</li>
                    ))}
                  </ul>
                </div>
                <div className={`lp-feature-visual${index === 1 ? " lp-certs" : ""}`}>
                  {image ? (
                    <Image src={image} alt={imageAlt} fill sizes="(max-width: 900px) 100vw, 520px" loading="lazy" />
                  ) : (
                    <div className="lp-cert-stack" aria-hidden="true">
                      <div className="lp-cert"><BadgeCheck size={20} /><span>Chứng nhận đang hiệu lực</span><i className="ok" /></div>
                      <div className="lp-cert"><ClipboardCheck size={20} /><span>Đang chờ người kiểm định</span><i className="wait" /></div>
                      <div className="lp-cert"><FileCheck2 size={20} /><span>Bản thay thế chờ duyệt</span><i className="wait" /></div>
                    </div>
                  )}
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="lp-section" id="how">
          <div className="container">
            <Reveal className="lp-heading lp-heading-center">
              <p className="eyebrow">Hành trình liên tục</p>
              <h2>Xây dựng truy xuất khi sản xuất diễn ra, không phải sau đó.</h2>
            </Reveal>
            <Reveal className="lp-steps-wrap">
              <svg className="lp-arc" viewBox="0 0 1000 70" preserveAspectRatio="none" aria-hidden="true">
                <path d="M 80 62 Q 500 -30 920 62" pathLength="1" />
              </svg>
              <ol className="lp-steps">
                {steps.map(({ icon: Icon, title, text }, index) => (
                  <li key={title} style={delay(index * 90)}>
                    <span className="lp-step-no">{index + 1}</span>
                    <Icon className="lp-step-icon" size={20} />
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </li>
                ))}
              </ol>
            </Reveal>
            <p className="lp-inline-note">
              Một vụ trồng có thể có nhiều lần thu hoạch. Mỗi lô giữ lịch sử của lần thu hoạch tạo ra nó.
            </p>
          </div>
        </section>

        <section className="lp-section lp-section-cream">
          <div className="container">
            <Reveal className="lp-heading">
              <p className="eyebrow">Cùng một chuỗi, cùng một nguồn thông tin</p>
              <h2>Mỗi vai trò thấy đúng phần việc của mình.</h2>
            </Reveal>
            <ul className="lp-chain" role="list">
              {chain.map(({ icon: Icon, title, text }, index) => (
                <Reveal as="li" className="lp-chain-item" delay={index * 80} key={title}>
                  <span className="lp-icon"><Icon size={22} /></span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-section" id="integrity">
          <div className="container">
            <Reveal className="lp-heading">
              <p className="eyebrow">Toàn vẹn dữ liệu</p>
              <h2>Hệ nghiệp vụ ghi nhận. Sổ cái giữ bằng chứng.</h2>
              <p className="lp-lead">
                Mỗi sự kiện nghiệp vụ được ghi bởi tài khoản đã xác thực và đối chiếu với
                bằng chứng trên Hyperledger Fabric. Riêng bước bàn giao có thêm chữ ký số
                của tổ chức gửi và nhận. Trạng thái hiển thị theo kết quả xác minh của
                từng lô.
              </p>
            </Reveal>
            <Reveal className="lp-arch">
              <div className="lp-arch-block">
                <strong>Hệ nghiệp vụ AgriTrace</strong>
                <span>Vụ trồng · Thu hoạch · Lô · Giao nhận · Chứng nhận</span>
              </div>
              <div className="lp-arch-link"><ArrowRight size={20} /><span>Ghi bằng chứng</span></div>
              <div className="lp-arch-block lp-arch-ledger">
                <strong>Sổ cái Hyperledger Fabric</strong>
                <span>Bằng chứng toàn vẹn của lịch sử</span>
              </div>
            </Reveal>
            <ul className="lp-proofs" role="list">
              <li><span className="badge success">Đã xác minh</span><p>Bằng chứng đã khớp với lịch sử ghi nhận.</p></li>
              <li><span className="badge warning">Đang chờ</span><p>Sự kiện đã ghi nhận, bằng chứng còn chờ xác nhận.</p></li>
              <li><span className="badge danger">Cần kiểm tra</span><p>Sai lệch hoặc lỗi kết nối có trạng thái riêng.</p></li>
            </ul>
            <p className="lp-inline-note">
              Xác minh chuỗi khối kiểm tra tính toàn vẹn của lịch sử dữ liệu. Chất lượng
              nông sản cần được đánh giá bằng chứng nhận và quy trình kiểm định phù hợp.
            </p>
          </div>
        </section>

        <section className="lp-section lp-section-cream" id="faq">
          <div className="container lp-faq">
            <Reveal className="lp-heading">
              <p className="eyebrow">Những điều bạn muốn biết</p>
              <h2>Hiểu rõ trước khi bắt đầu.</h2>
            </Reveal>
            <Reveal className="lp-faq-list">
              {faqs.map(({ q, a }) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </Reveal>
          </div>
        </section>

        <section className="lp-contact" id="contact">
          <div className="container">
            <Reveal className="lp-contact-card">
              <div>
                <p className="eyebrow">Liên hệ AgriTrace</p>
                <h2>Cần triển khai truy xuất cho nông sản của bạn?</h2>
                <p>
                  Trao đổi với chúng tôi về sản phẩm, quy trình sản xuất và chuỗi cung
                  ứng. Chúng tôi phản hồi qua email hoặc Zalo.
                </p>
              </div>
              <div className="lp-contact-actions">
                <a className="button accent" href={SITE_CONTACT.emailUrl}>
                  <Mail size={18} /> {SITE_CONTACT.email}
                </a>
                <a
                  className="button lp-button-ghost"
                  href={SITE_CONTACT.zaloUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle size={18} /> Zalo {SITE_CONTACT.zaloPhone}
                </a>
              </div>
            </Reveal>
          </div>
        </section>
      </main>
      <SiteFooter />
      <ZaloFloat />
    </div>
  );
}
