import { ApiError, apiBaseUrl, getPublicTrace } from "./public-trace";

function respond(status: number, body: unknown): typeof fetch {
  return jest.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("getPublicTrace", () => {
  it("reads the public projection without credentials", async () => {
    const fetchImpl = respond(200, { success: true, data: { lotId: "8f6c", productName: "Gạo ST25" } });
    const lot = await getPublicTrace("trace-token", { baseUrl: "https://api.test/api", fetchImpl });
    expect(lot?.productName).toBe("Gạo ST25");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.test/api/public/trace/trace-token",
      expect.objectContaining({ credentials: "omit" }),
    );
  });

  it("maps a missing trace to null", async () => {
    await expect(getPublicTrace("missing", { baseUrl: "x", fetchImpl: respond(404, {}) })).resolves.toBeNull();
  });

  it("surfaces the API error message", async () => {
    const fetchImpl = respond(503, { success: false, error: { code: "UNAVAILABLE", message: ["Bảo trì", "thử lại sau"] } });
    await expect(getPublicTrace("abc", { baseUrl: "x", fetchImpl })).rejects.toEqual(new ApiError(503, "Bảo trì; thử lại sau"));
  });

  it("explains a network failure in Vietnamese", async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(getPublicTrace("abc", { baseUrl: "x", fetchImpl })).rejects.toEqual(
      new ApiError(0, "Không kết nối được máy chủ AgriTrace. Kiểm tra mạng rồi thử lại."),
    );
  });

  it("rejects malformed tokens before any request", async () => {
    const fetchImpl = respond(200, {});
    await expect(getPublicTrace("../lots", { baseUrl: "x", fetchImpl })).rejects.toBeInstanceOf(ApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a success status without the response envelope", async () => {
    await expect(getPublicTrace("abc", { baseUrl: "x", fetchImpl: respond(200, { lotId: "1" }) })).rejects.toBeInstanceOf(ApiError);
  });

  it("normalizes the configured base URL", () => {
    expect(apiBaseUrl("https://agritrace.dev/api/")).toBe("https://agritrace.dev/api");
    expect(apiBaseUrl("")).toBe("http://localhost:8080/api");
  });
});
