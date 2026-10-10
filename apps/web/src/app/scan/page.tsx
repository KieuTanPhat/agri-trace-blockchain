"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Leaf, Search, ShieldCheck, Truck } from "lucide-react";
import { getTracePath } from "@/lib/trace-input";
import { CameraScanner } from "@/components/camera-scanner";

export default function ScanPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  function openTrace(event: FormEvent) {
    event.preventDefault();
    const path = getTracePath(code);
    if (!path) {
      setError("Nhập mã trên QR hoặc đường dẫn /trace/<token> hợp lệ.");
      return;
    }
    setError("");
    router.push(path);
  }
  return (
    <div className="scan-page grid">
      <section className="scan-heading">
        <p className="eyebrow">TRA CỨU CÔNG KHAI</p>
        <h1>Quét mã. Hiểu nguồn gốc.</h1>
        <p className="muted">
          Xem hành trình của nông sản bằng mã QR trên sản phẩm. Không cần tài
          khoản.
        </p>
      </section>
      <div className="scan-layout">
        <CameraScanner onTrace={(path) => router.push(path)} />
        <div className="grid">
          <form
            className="panel form-grid"
            aria-label="Tra cứu nông sản"
            onSubmit={openTrace}
          >
            <div>
              <h2>Nhập mã truy xuất</h2>
              <p className="muted">
                Dùng mã trên sản phẩm hoặc dán đường dẫn truy xuất.
              </p>
            </div>
            <div className="field">
              <label htmlFor="trace-code">Mã truy xuất hoặc đường dẫn</label>
              <input
                className="input"
                id="trace-code"
                placeholder="Nhập mã truy xuất trên sản phẩm"
                autoComplete="off"
                spellCheck={false}
                maxLength={2048}
                required
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  setError("");
                }}
              />
            </div>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <button className="button" type="submit">
              <Search size={18} /> Tra cứu nông sản <ArrowRight size={18} />
            </button>
          </form>
          <section className="panel scan-benefits">
            <h2>Thông tin đi cùng sản phẩm</h2>
            <p>
              <Leaf size={19} /> Nông trại và vụ trồng liên quan
            </p>
            <p>
              <Truck size={19} /> Các mốc thu hoạch và giao nhận
            </p>
            <p>
              <ShieldCheck size={19} /> Trạng thái xác minh dữ liệu
            </p>
            <small>
              Thông tin tra cứu phản ánh dữ liệu được công khai. Trạng thái bằng
              chứng không thay thế chứng nhận chất lượng.
            </small>
          </section>
        </div>
      </div>
    </div>
  );
}
