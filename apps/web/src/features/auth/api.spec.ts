import { expect, it, vi } from "vitest";
it("reads the API's nested error envelope", async () => {
  vi.resetModules();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: { code: "UNAUTHORIZED", message: "Sai email hoặc mật khẩu" },
        }),
        { status: 401 },
      ),
    ),
  );
  const { login } = await import("@/features/auth/api");
  await expect(login("user@example.com", "wrong")).rejects.toMatchObject({
    status: 401,
    code: "UNAUTHORIZED",
    message: "Sai email hoặc mật khẩu",
  });
  vi.unstubAllGlobals();
});
