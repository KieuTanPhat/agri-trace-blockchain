import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ledgerRequest } from "@/lib/ledger/request";
import { RegistrationDocumentDownload } from "./document-download";

vi.mock("@/lib/ledger/request", () => ({ ledgerRequest: vi.fn() }));
const document = {
  id: "doc-1",
  fileName: "giay-phep.png",
  kind: "LEGAL_REGISTRATION" as const,
  mediaType: "image/png",
  size: 3,
  sha256: createHash("sha256").update("abc").digest("hex"),
};
const content = { ...document, contentBase64: "YWJj" };
const revoke = vi.fn();
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:private-document");
      static revokeObjectURL = revoke;
    },
  );
  vi.mocked(ledgerRequest).mockReset();
  revoke.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("opens an authenticated, hash-verified image in a dialog without forcing a download", async () => {
  vi.mocked(ledgerRequest).mockResolvedValue(content);
  const download = vi.spyOn(HTMLAnchorElement.prototype, "click");
  const view = render(<RegistrationDocumentDownload document={document} />);
  expect(ledgerRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Xem giay-phep.png" }));
  const image = await screen.findByRole("img", { name: document.fileName });
  expect(image).toHaveAttribute("src", "blob:private-document");
  expect(ledgerRequest).toHaveBeenCalledWith(
    "/enterprise-registration-documents/doc-1",
  );
  expect(download).not.toHaveBeenCalled();
  view.unmount();
  expect(revoke).toHaveBeenCalledWith("blob:private-document");
});

it("previews PDFs but refuses content whose hash no longer matches", async () => {
  vi.mocked(ledgerRequest).mockResolvedValueOnce({
    ...content,
    mediaType: "application/pdf",
  });
  const view = render(<RegistrationDocumentDownload document={document} />);
  fireEvent.click(screen.getByRole("button", { name: "Xem giay-phep.png" }));
  await waitFor(() =>
    expect(screen.getByTitle(document.fileName)).toHaveAttribute(
      "src",
      "blob:private-document",
    ),
  );
  view.unmount();
  vi.mocked(ledgerRequest).mockResolvedValueOnce({
    ...content,
    sha256: "0".repeat(64),
  });
  render(<RegistrationDocumentDownload document={document} />);
  fireEvent.click(screen.getByRole("button", { name: "Xem giay-phep.png" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(/khớp hash/),
  );
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});
