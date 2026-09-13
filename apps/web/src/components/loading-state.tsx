export function LoadingState({ title = "Đang tải" }: { title?: string }) {
  return (
    <section className="panel state-box">
      <p className="eyebrow">Đang tải</p>
      <h2>{title}</h2>
      <p className="muted">Hệ thống đang lấy dữ liệu mới nhất, bạn chờ một chút nhé.</p>
    </section>
  );
}
