"use client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

/** Commands that change custody, authority, signatures or quantities ask for a second confirmation. */
const rules: [RegExp, string][] = [
  [/\/harvests$/, "Ghi thu hoạch sẽ tạo lô nguồn và mã QR; lịch sử đã ghi không sửa trực tiếp được."],
  [/\/cancel$/, "Hủy phiếu hoặc yêu cầu này. Thao tác không hoàn tác được."],
  [/\/revoke$/, "Thu hồi quyền, lời mời hoặc khóa ký này."],
  [/\/(reject|decline)$/, "Từ chối yêu cầu này và gửi kết quả cho các bên liên quan."],
  [/\/(review|decision)$/, "Gửi kết quả xét duyệt. Kết quả được ghi vào lịch sử."],
  [/\/(approve|accept)$/, "Chấp nhận hoặc phê duyệt yêu cầu này."],
  [/\/(sign|submit|c2\/submit)$/, "Ký xác nhận bằng khóa của bạn cho nội dung đang hiển thị."],
  [/\/dispatch$/, "Xuất hàng khỏi cơ sở; lượng chuyển sang trạng thái đang chuyển."],
  [/\/receive$/, "Xác nhận lượng thực nhận. Lượng đã xác nhận không sửa được."],
  [/\/(resolve|returns)$/, "Ghi phương án xử lý chênh lệch cho phần hàng chờ đối soát."],
  [/\/(lock|unlock|suspend|activate|status|restore)$/, "Đổi trạng thái hoạt động của hồ sơ hoặc tài khoản."],
  [/\/(complete|link)$/, "Kích hoạt hồ sơ hoặc liên kết vào chuỗi để bắt đầu ghi nghiệp vụ."],
  [/\/withdraw$/, "Rút hồ sơ đã gửi."],
  [/^\/distribution\/transfers$/, "Tạo phiếu giao nhận và giữ chỗ lượng hàng dự kiến giao."],
  [/^\/distribution\/site-transfers$/, "Lập phiếu chuyển hàng giữa hai cơ sở."],
  [/^\/distribution\/quantities$/, "Ghi bán hoặc hao hụt sẽ giảm lượng khả dụng của lô."],
  [/^\/distribution\/quarantine$/, "Thay đổi lượng đang cách ly tại cơ sở."],
  [/^\/distribution\/allocations$/, "Phân bổ lượng của lô vào cơ sở."],
  [/^\/distribution\/notices$/, "Phát cảnh báo hoặc thu hồi cho lô; thông báo hiển thị trên QR."],
  [/^\/enterprise-workspace\/ownership-transfers/, "Đề nghị hoặc trả lời chuyển quyền chủ quản doanh nghiệp."],
  [/^\/enterprise-workspace\/(members|roles)\/[0-9a-f-]{36}$/, "Thay đổi quyền hoặc trạng thái của thành viên, nhóm quyền."],
];

export function importantAction(path: string): string | null {
  const clean = path.split("?")[0];
  return rules.find(([pattern]) => pattern.test(clean))?.[1] ?? null;
}

type Ask = (message: string, title?: string) => Promise<boolean>;
const ConfirmContext = createContext<Ask | null>(null);

/** Shared confirmation dialog; without a provider every confirmation passes. */
export function useConfirm(): Ask {
  return useContext(ConfirmContext) ?? (async () => true);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const [request, setRequest] = useState<{ title: string; message: string } | null>(null);
  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setRequest(null);
  }, []);
  const ask = useCallback<Ask>((message, title = "Xác nhận thao tác") => {
    resolver.current?.(false);
    setRequest({ title, message });
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <Dialog open={!!request} onOpenChange={(open) => { if (!open) settle(false); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{request?.title}</DialogTitle><DialogDescription>{request?.message}</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => settle(false)}>Quay lại</Button>
            <Button type="button" onClick={() => settle(true)}>Xác nhận</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}
