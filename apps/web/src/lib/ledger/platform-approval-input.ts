import { z } from "zod";
export const temporaryPasswordSchema = z.string().refine((p) => {
  const bytes = new TextEncoder().encode(p).length;
  return bytes >= 12 && bytes <= 72;
}, "Mật khẩu tạm phải từ 12 đến 72 byte UTF-8");
