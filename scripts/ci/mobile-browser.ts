import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { publicLot, TOKEN } from "../../apps/mobile/tests/fixtures";

const ARTICLE = "12345678-1234-4234-9234-123456789abc";
const NO_COVER = "12345678-1234-4234-9234-123456789abd";
const articleTitle =
  "Bài viết thử nghiệm với tiêu đề dài để kiểm tra màn hình nhỏ "
    .repeat(3)
    .trim();
const article = {
  id: ARTICLE,
  title: articleTitle,
  summary: "Tóm tắt nội dung công khai.",
  publishedAt: "2026-10-19T00:00:00.000Z",
  // Even an HTTPS value in JSON must never cause a direct CDN request.
  coverUrl: "https://unexpected-cdn.invalid/cover.png",
};
const coverImage = {
  mimeType: "image/png",
  width: 1,
  height: 1,
  dataBase64:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWPgqLL/DwADEAHBRHIeYAAAAABJRU5ErkJggg==",
};

async function main() {
  const directory = resolve(__dirname, "../../apps/mobile");
  const output = resolve(directory, ".ui-artifacts");
  const root = resolve(directory, "dist/web");
  const bundle = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "export:web"],
    {
      cwd: directory,
      stdio: "inherit",
      env: {
        ...process.env,
        EXPO_NO_TELEMETRY: "1",
        EXPO_PUBLIC_API_BASE_URL: "https://mobile-fixture.invalid/api",
      },
    },
  );
  assert.equal(bundle.status, 0, "Web preview bundle must build");
  await mkdir(output, { recursive: true });
  const mime: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".ttf": "font/ttf",
    ".webp": "image/webp",
    ".png": "image/png",
    ".ico": "image/x-icon",
  };
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? "/", "http://local").pathname;
      const path = resolve(root, `.${decodeURIComponent(pathname)}`);
      if (path !== root && !path.startsWith(root + sep)) {
        response.writeHead(403).end();
        return;
      }
      const asset = extname(path) ? path : resolve(root, "index.html");
      const data = await readFile(asset);
      response.writeHead(200, {
        "Content-Type": mime[extname(asset)] ?? "application/octet-stream",
      });
      response.end(data);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({
      channel: process.env.MOBILE_BROWSER_CHANNEL || undefined,
    });
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const width of [320, 390, 768]) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        permissions: [],
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let requests = 0;
      let mode: "ok" | "missing" | "offline" = "ok";
      let coverMode: "ok" | "error" = "ok";
      let coverRequests = 0;
      const externalRequests: string[] = [];
      context.on("request", (request) => {
        const url = new URL(request.url());
        if (
          ["http:", "https:"].includes(url.protocol) &&
          url.origin !== origin &&
          url.origin !== "https://mobile-fixture.invalid"
        )
          externalRequests.push(url.origin);
      });
      await context.route(
        "https://mobile-fixture.invalid/**",
        async (route) => {
          requests++;
          assert.equal(route.request().method(), "GET");
          assert.equal(route.request().headers()["authorization"], undefined);
          assert.equal(route.request().headers()["cookie"], undefined);
          const path = new URL(route.request().url()).pathname;
          if (
            path === "/api/public/products" ||
            path === "/api/public/enterprises"
          ) {
            await route.fulfill({
              contentType: "application/json",
              body: JSON.stringify({
                success: true,
                data: { items: [], nextCursor: null, hasMore: false },
              }),
            });
            return;
          }
          if (path === "/api/public/news") {
            await route.fulfill({
              contentType: "application/json",
              body: JSON.stringify({
                success: true,
                data: { items: [article], nextCursor: null, hasMore: false },
              }),
            });
            return;
          }
          if (path === `/api/public/news/${ARTICLE}/cover`) {
            coverRequests++;
            await route.fulfill({
              status: coverMode === "ok" ? 200 : 502,
              contentType: "application/json",
              body: JSON.stringify(
                coverMode === "ok"
                  ? { success: true, data: coverImage }
                  : { success: false },
              ),
            });
            return;
          }
          if (
            path === `/api/public/news/${ARTICLE}` ||
            path === `/api/public/news/${NO_COVER}`
          ) {
            await route.fulfill({
              contentType: "application/json",
              body: JSON.stringify({
                success: true,
                data: {
                  ...article,
                  ...(path.endsWith(NO_COVER)
                    ? { id: NO_COVER, coverUrl: null }
                    : {}),
                  body: "<script>literal text, not executable</script>",
                },
              }),
            });
            return;
          }
          if (mode === "offline") {
            await route.abort("failed");
            return;
          }
          await route.fulfill({
            status: mode === "missing" ? 404 : 200,
            contentType: "application/json",
            body: JSON.stringify(
              mode === "missing"
                ? { success: false, requestId: "ui-fixture-404" }
                : {
                    success: true,
                    data: publicLot({
                      currentState: "RECALLED",
                      isExpired: true,
                      proofStatus: "VERIFIED",
                    }),
                  },
            ),
          });
        },
      );
      await page.goto(origin);
      await page
        .getByRole("button", { name: "Quét mã truy xuất", exact: true })
        .waitFor();
      assert.equal(requests, 0, "Home must not contact trace API");
      await page.screenshot({
        path: resolve(output, `home-${width}.png`),
        fullPage: true,
      });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "No horizontal overflow",
      );
      await page
        .getByRole("button", { name: "Quét mã truy xuất", exact: true })
        .click();
      const input = page.getByRole("textbox", {
        name: "Mã hoặc đường dẫn truy xuất",
      });
      await input.fill(`https://evil.example/trace/${TOKEN}`);
      await page
        .getByRole("button", { name: "Tra cứu thông tin", exact: true })
        .click();
      await page.getByText("Mã chưa hợp lệ.", { exact: false }).waitFor();
      assert.equal(requests, 0, "Untrusted QR must not trigger API");
      await page.screenshot({
        path: resolve(output, `scan-${width}.png`),
        fullPage: true,
      });
      await input.fill(TOKEN);
      await page
        .getByRole("button", { name: "Tra cứu thông tin", exact: true })
        .click();
      await page.getByText("Rau cải thử nghiệm", { exact: true }).waitFor();
      await page
        .getByText("Lô hàng đã bị thu hồi.", { exact: false })
        .waitFor();
      await page
        .getByText("Lô hàng đã hết hạn sử dụng.", { exact: true })
        .waitFor();
      await page
        .getByText("Không có dữ liệu cảm biến", { exact: false })
        .waitFor();
      assert.equal(
        await page.getByText("VERIFIED", { exact: true }).count(),
        0,
      );
      await page.screenshot({
        path: resolve(output, `trace-${width}.png`),
        fullPage: true,
      });
      await page.goto(`${origin}/history`);
      await page
        .getByRole("button", { name: "Xem lại Rau cải thử nghiệm" })
        .waitFor();
      await page.reload();
      await page
        .getByRole("button", { name: "Xem lại Rau cải thử nghiệm" })
        .waitFor();
      const before = requests;
      await page
        .getByRole("button", { name: "Xem lại Rau cải thử nghiệm" })
        .click();
      await page.getByText("Rau cải thử nghiệm", { exact: true }).waitFor();
      assert.ok(requests > before, "History must fetch fresh data");
      await page.goto(`${origin}/history`);
      await page
        .getByRole("button", { name: "Xóa lịch sử trên thiết bị" })
        .click();
      await page.getByRole("button", { name: "Xác nhận xóa lịch sử" }).click();
      await page
        .getByText("Chưa có lịch sử tra cứu", { exact: true })
        .waitFor();
      mode = "missing";
      await page.goto(`${origin}/trace/${TOKEN}`);
      await page
        .getByText("Mã truy xuất không hợp lệ hoặc không còn được công khai.", {
          exact: true,
        })
        .waitFor();
      mode = "offline";
      await page.getByRole("button", { name: "Thử lại", exact: true }).click();
      await page
        .getByText("Không kết nối được máy chủ", { exact: false })
        .waitFor();
      mode = "ok";
      await page.goto(`${origin}/news`);
      await page.getByText(articleTitle, { exact: true }).waitFor();
      assert.equal(coverRequests, 0, "List must not eagerly fetch every image");
      await page
        .getByRole("button", {
          name: `Tải ảnh bìa ${articleTitle}`,
          exact: true,
        })
        .click();
      await page
        .getByRole("img", { name: `Ảnh bìa ${articleTitle}`, exact: true })
        .first()
        .waitFor();
      await page.waitForFunction(() =>
        Array.from(
          document.querySelectorAll('img[src^="data:image/png;base64,"]'),
        ).some((image) => (image as HTMLImageElement).naturalWidth > 0),
      );
      assert.equal(coverRequests, 1);
      await page
        .getByRole("button", { name: `Đọc bài ${articleTitle}`, exact: true })
        .click();
      await page
        .getByText("<script>literal text, not executable</script>", {
          exact: true,
        })
        .waitFor();
      await page
        .getByRole("img", { name: `Ảnh bìa ${articleTitle}`, exact: true })
        .first()
        .waitFor();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "Article/image cannot overflow horizontally",
      );
      await page.screenshot({
        path: resolve(output, `news-image-${width}.png`),
        fullPage: true,
      });
      coverMode = "error";
      await page.reload();
      await page
        .getByText("Chưa tải được ảnh bìa. Bạn vẫn có thể đọc bài viết.", {
          exact: true,
        })
        .waitFor();
      await page
        .getByText("<script>literal text, not executable</script>", {
          exact: true,
        })
        .waitFor();
      coverMode = "ok";
      await page
        .getByRole("button", { name: "Thử tải lại ảnh bìa", exact: true })
        .click();
      await page
        .getByRole("img", { name: `Ảnh bìa ${articleTitle}`, exact: true })
        .first()
        .waitFor();
      const loaded = coverRequests;
      await page.goto(`${origin}/news/${NO_COVER}`);
      await page
        .getByText("Chưa có ảnh bìa công khai.", { exact: true })
        .waitFor();
      assert.equal(
        coverRequests,
        loaded,
        "Missing cover must not request an image",
      );
      assert.deepEqual(
        externalRequests,
        [],
        "All image traffic must stay on our configured API",
      );
      await page.goto(origin);
      for (const [tab, heading] of [
        ["Sản phẩm", "Sản phẩm"],
        ["Doanh nghiệp", "Doanh nghiệp"],
        ["Tài khoản", "Tài khoản"],
        ["Quét QR", "Quét mã truy xuất"],
        ["Trang chủ", "Hiểu nguồn gốc."],
      ]) {
        const target = page.getByRole("tab", { name: tab, exact: true });
        await target.click();
        await page
          .getByRole("heading", { name: heading, exact: tab !== "Trang chủ" })
          .waitFor();
        assert.equal(await target.getAttribute("aria-selected"), "true");
        const url = page.url();
        await target.click();
        assert.equal(
          page.url(),
          url,
          "Reselecting the same tab must not add another route",
        );
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          "Tab content must fit the viewport",
        );
      }
      await page.screenshot({
        path: resolve(output, `home-navigation-${width}.png`),
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      await context.close();
      console.log(
        `Mobile web preview ${width}px: passed (fixture only, not native camera/API acceptance)`,
      );
    }
  } finally {
    await browser?.close();
    await new Promise<void>((done) => server.close(() => done()));
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
