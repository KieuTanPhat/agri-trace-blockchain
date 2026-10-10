import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CameraScanner } from "./camera-scanner";

const { decode } = vi.hoisted(() => ({ decode: vi.fn() }));
vi.mock("jsqr", () => ({ default: decode }));
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  decode.mockReset();
});

it("does not request camera automatically and explains denied permission", async () => {
  const getUserMedia = vi
    .fn()
    .mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  render(<CameraScanner onTrace={vi.fn()} />);
  expect(getUserMedia).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Mở camera" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Chưa được cấp quyền camera",
    ),
  );
});

it("releases media delivered after the scanner has been unmounted", async () => {
  let finish!: (value: MediaStream) => void;
  const stop = vi.fn();
  const getUserMedia = vi.fn(
    () =>
      new Promise<MediaStream>((resolve) => {
        finish = resolve;
      }),
  );
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  const view = render(<CameraScanner onTrace={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Mở camera" }));
  await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
  view.unmount();
  await act(async () => {
    finish({ getTracks: () => [{ stop }] } as unknown as MediaStream);
  });
  expect(stop).toHaveBeenCalledOnce();
});

it("rejects unsupported uploads without decoding", () => {
  render(<CameraScanner onTrace={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Chọn ảnh mã QR"), {
    target: { files: [new File(["text"], "text.txt", { type: "text/plain" })] },
  });
  expect(screen.getByRole("status")).toHaveTextContent("Chọn ảnh PNG");
  expect(decode).not.toHaveBeenCalled();
});

it.each([
  ["http://legacy.example/trace/real-token", "/trace/real-token"],
  ["https://external.example/admin", null],
])("decodes uploaded QR locally and validates %s", async (data, expected) => {
  const onTrace = vi.fn();
  const revoke = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:qa"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revoke,
  });
  vi.stubGlobal(
    "Image",
    class {
      width = 120;
      height = 120;
      src = "";
      decode = vi.fn().mockResolvedValue(undefined);
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({
      data: new Uint8ClampedArray(16),
      width: 2,
      height: 2,
    }),
  } as unknown as CanvasRenderingContext2D);
  decode.mockReturnValue({ data });
  render(<CameraScanner onTrace={onTrace} />);
  fireEvent.change(screen.getByLabelText("Chọn ảnh mã QR"), {
    target: { files: [new File(["qr"], "qr.png", { type: "image/png" })] },
  });
  await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:qa"));
  if (expected) expect(onTrace).toHaveBeenCalledWith(expected);
  else {
    expect(onTrace).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Chưa tìm thấy");
  }
});
