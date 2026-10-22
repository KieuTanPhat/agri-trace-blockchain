import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  registrationDefaults,
  type RegistrationDraft,
} from "@/lib/registration-form";
import { useRegistrationProtocol } from "./use-registration-protocol";
afterEach(() => vi.unstubAllGlobals());
it("reconciles an uncertain OTP send with its original body and key, without requiring a code", async () => {
  const requests: { body: unknown; key: string | null }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        body: JSON.parse(String(init?.body)),
        key: new Headers(init?.headers).get("Idempotency-Key"),
      });
      if (requests.length === 1) throw new TypeError("response lost");
      return Response.json({
        success: true,
        data: {
          verificationId: "otp-retry",
          expiresAt: "2027-01-01T00:00:00Z",
          resendAfter: "2026-10-23T00:00:00Z",
          queued: true,
        },
      });
    }),
  );
  const { result } = renderHook(() =>
    useRegistrationProtocol({
      draft: { ...registrationDefaults, email: "owner@example.invalid" },
      files: {},
      onComplete: vi.fn(),
      onFileError: vi.fn(),
    }),
  );
  await act(() => result.current.send());
  expect(result.current.frozen).toBe(true);
  await act(() => result.current.retry(""));
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(result.current.frozen).toBe(false);
  expect(result.current.receipt?.verificationId).toBe("otp-retry");
});
it("requires a fresh OTP proof after requesting a new code following a rejected profile", async () => {
  let verifies = 0,
    registrations = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      let data: unknown;
      if (url.endsWith("/request"))
        data = {
          verificationId: "otp",
          expiresAt: "2027-01-01T00:00:00Z",
          resendAfter: "2026-10-23T00:00:00Z",
          queued: true,
        };
      else if (url.endsWith("/verify")) {
        verifies++;
        data = {
          verificationId: "otp",
          token: `proof-${verifies}`,
          expiresAt: "2027-01-01T00:00:00Z",
        };
      } else {
        registrations++;
        if (registrations === 1)
          return Response.json(
            {
              success: false,
              error: { code: "INVALID_PROFILE", message: "Invalid profile" },
            },
            { status: 400 },
          );
        data = { enrollmentId: "enrollment", status: "PENDING_REVIEW" };
      }
      return Response.json({ success: true, data });
    }),
  );
  const { result } = renderHook(() =>
    useRegistrationProtocol({
      draft: {
        ...registrationDefaults,
        email: "owner@example.invalid",
        declaration: true,
        termsAccepted: true,
        privacyAcknowledged: true,
      },
      files: {},
      onComplete: vi.fn(),
      onFileError: vi.fn(),
    }),
  );
  await act(() => result.current.send());
  await act(() => result.current.verify("123456"));
  await act(() => result.current.send());
  await act(() => result.current.verify("654321"));
  expect(verifies).toBe(2);
  expect(registrations).toBe(2);
});
it("freezes an unknown registration result and retries the original consented body", async () => {
  const sent: string[] = [],
    done = vi.fn();
  let verifies = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/request"))
        return Response.json({
          success: true,
          data: {
            verificationId: "otp",
            expiresAt: "2027-01-01T00:00:00Z",
            resendAfter: "2026-10-23T00:00:00Z",
            queued: true,
          },
        });
      if (path.endsWith("/verify")) {
        verifies++;
        return Response.json({
          success: true,
          data: {
            verificationId: "otp",
            token: "proof",
            expiresAt: "2027-01-01T00:00:00Z",
          },
        });
      }
      sent.push(String(init?.body));
      if (sent.length === 1) throw new TypeError("committed response lost");
      return Response.json({
        success: true,
        data: { enrollmentId: "enrollment", status: "PENDING_REVIEW" },
      });
    }),
  );
  let draft = {
    ...registrationDefaults,
    email: "owner@example.invalid",
    organizationName: "Original",
    declaration: true,
    termsAccepted: true,
    privacyAcknowledged: true,
  };
  const { result, rerender } = renderHook(() =>
    useRegistrationProtocol({
      draft,
      files: {},
      onComplete: done,
      onFileError: vi.fn(),
    }),
  );
  await act(() => result.current.send());
  await act(() => result.current.verify("123456"));
  expect(result.current.frozen).toBe(true);
  expect(done).not.toHaveBeenCalled();
  draft = { ...draft, organizationName: "Edited after loss" };
  rerender();
  await act(() => result.current.retry(""));
  expect(sent).toHaveLength(2);
  expect(sent[1]).toBe(sent[0]);
  expect(JSON.parse(sent[1]).organizationName).toBe("Original");
  expect(verifies).toBe(1);
  expect(done).toHaveBeenCalledTimes(1);
});
it("uploads the required processor certificate even when FARM is not requested", async () => {
  const draft: RegistrationDraft = {
    ...registrationDefaults,
    registrationRole: "PROCESSOR",
    legalForm: "ENTERPRISE",
    organizationName: "Công ty chế biến kiểm thử",
    businessId: "0123456789",
    registrationNumber: "GP01",
    representative: "Nguyễn An",
    representativeTitle: "Giám đốc",
    fullName: "Nguyễn An",
    email: "owner@example.invalid",
    contactEmail: "contact@example.invalid",
    phone: "0912345678",
    provinceCode: "79",
    province: "Thành phố Hồ Chí Minh",
    wardCode: "001",
    ward: "Phường kiểm thử",
    address: "Số 1 đường kiểm thử",
    activities: ["PROCESSOR"],
    organizationType: "PROCESSOR",
    processingTypes: ["PACKING"],
    foodSafetyCertificateNumber: "ATTP01",
    foodSafetyCertificateExpiry: "2027-10-23",
    declaration: true,
    termsAccepted: true,
    privacyAcknowledged: true,
  };
  const legal = "11111111-1111-4111-8111-111111111111",
    certificate = "22222222-2222-4222-8222-222222222222",
    uploaded: string[] = [],
    payloads: unknown[] = [];
  const file = new File(["%PDF-1.4\nfixture"], "fixture.pdf", {
    type: "application/pdf",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      let data: unknown;
      if (url.endsWith("/auth/registration-otp/request"))
        data = {
          verificationId: "33333333-3333-4333-8333-333333333333",
          expiresAt: "2027-01-01T00:00:00.000Z",
          resendAfter: "2026-10-23T00:00:00.000Z",
          queued: true,
        };
      else if (url.endsWith("/auth/registration-otp/verify"))
        data = {
          verificationId: "33333333-3333-4333-8333-333333333333",
          token: "fixture-proof",
          expiresAt: "2027-01-01T00:00:00.000Z",
        };
      else if (
        url.endsWith("/auth/registration-documents") &&
        init?.body instanceof FormData
      ) {
        uploaded.push(String(init.body.get("kind")));
        data = {
          id: String(init.body.get("id")),
          kind: String(init.body.get("kind")),
          fileName: "fixture.pdf",
          mediaType: "application/pdf",
          size: file.size,
          sha256: "a".repeat(64),
        };
      } else if (url.endsWith("/auth/register")) {
        payloads.push(JSON.parse(String(init?.body)));
        data = {
          enrollmentId: "44444444-4444-4444-8444-444444444444",
          status: "PENDING_REVIEW",
        };
      } else throw new Error("Unexpected registration endpoint");
      return Response.json({ success: true, data });
    }),
  );
  const done = vi.fn();
  const { result } = renderHook(() =>
    useRegistrationProtocol({
      draft,
      files: {
        LEGAL_REGISTRATION: { id: legal, file },
        CERTIFICATE: { id: certificate, file },
      },
      onComplete: done,
      onFileError: vi.fn(),
    }),
  );
  await act(() => result.current.send());
  await waitFor(() => expect(result.current.receipt).not.toBeNull());
  await act(() => result.current.verify("123456"));
  expect(uploaded).toEqual(["LEGAL_REGISTRATION", "CERTIFICATE"]);
  expect(payloads[0]).toMatchObject({
    organizationType: "PROCESSOR",
    details: {
      activities: ["PROCESSOR"],
      documentIds: [legal, certificate],
      processing: {
        processingTypes: ["PACKING"],
        foodSafetyCertificateNumber: "ATTP01",
      },
    },
  });
  expect(done).toHaveBeenCalledTimes(1);
});
