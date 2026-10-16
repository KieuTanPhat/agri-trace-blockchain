import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BusinessProfilePanel } from "./business-profile-panel";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api-client", () => api);
vi.mock("./data-form", () => ({
  DataForm: ({
    title,
    path,
    extra,
  }: {
    title: string;
    path: string;
    extra: object;
  }) => (
    <button data-path={path} data-body={JSON.stringify(extra)}>
      {title}
    </button>
  ),
}));
afterEach(() => {
  cleanup();
  api.request.mockReset();
});
describe("Business activation presentation", () => {
  it("uses the server profile version and hides activation after the committed state changes", async () => {
    api.request.mockResolvedValueOnce({ state: "PREPARING", version: 7 });
    const view = render(
      <BusinessProfilePanel chainId="one" canActivate onChanged={vi.fn()} />,
    );
    const action = await screen.findByRole("button", {
      name: "Kích hoạt nghiệp vụ chuỗi",
    });
    expect(action).toHaveAttribute("data-body", '{"version":7}');
    expect(action).toHaveAttribute(
      "data-path",
      "/supply-chains/one/business-profile/activate",
    );
    api.request.mockResolvedValueOnce({ state: "ACTIVE", version: 8 });
    view.rerender(
      <BusinessProfilePanel
        key="reload"
        chainId="one"
        canActivate
        onChanged={vi.fn()}
      />,
    );
    await screen.findByText("Đang hoạt động");
    expect(
      screen.queryByRole("button", { name: "Kích hoạt nghiệp vụ chuỗi" }),
    ).not.toBeInTheDocument();
  });
  it("does not offer activation without current owner permission", async () => {
    api.request.mockResolvedValueOnce({ state: "PREPARING", version: 0 });
    render(
      <BusinessProfilePanel
        chainId="one"
        canActivate={false}
        onChanged={vi.fn()}
      />,
    );
    await screen.findByText("Đang chuẩn bị");
    expect(
      screen.queryByRole("button", { name: "Kích hoạt nghiệp vụ chuỗi" }),
    ).not.toBeInTheDocument();
  });
  it("discards a slow profile from the previous selected chain", async () => {
    let resolve!: (p: object) => void;
    api.request
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      )
      .mockResolvedValueOnce({ state: "ACTIVE", version: 3 });
    const view = render(
      <BusinessProfilePanel chainId="one" canActivate onChanged={vi.fn()} />,
    );
    view.rerender(
      <BusinessProfilePanel chainId="two" canActivate onChanged={vi.fn()} />,
    );
    await screen.findByText("Đang hoạt động");
    await act(async () => resolve({ state: "PREPARING", version: 0 }));
    expect(
      screen.queryByRole("button", { name: "Kích hoạt nghiệp vụ chuỗi" }),
    ).not.toBeInTheDocument();
  });
});
