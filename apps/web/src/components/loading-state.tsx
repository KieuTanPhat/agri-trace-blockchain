export function LoadingState({ title = "Đang tải" }: { title?: string }) {
  return (
    <section className="panel state-box" role="status" aria-busy="true">
      <p className="eyebrow">Đang tải</p>
      <h2>{title}</h2>
      <p className="muted">Hệ thống đang lấy dữ liệu mới nhất, bạn chờ một chút nhé.</p>
      <div className="skeleton-lines" aria-hidden="true">
        <span className="skeleton" />
        <span className="skeleton" />
        <span className="skeleton short" />
      </div>
    </section>
  );
}
