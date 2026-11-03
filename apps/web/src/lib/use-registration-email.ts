"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "./api-client";
import { isRegistrationEmailValid } from "./registration-form";
import type { components } from "./generated/api";

/** Checks that no account or enterprise contact already uses the address. */
export function useRegistrationEmail(
  email: string,
  enabled: boolean,
  takenMessage = "Email đã được đăng ký. Vui lòng dùng email khác hoặc đăng nhập.",
) {
  const normalized = email.trim().toLowerCase();
  const current = useRef(normalized);
  current.current = normalized;
  const alive = useRef(true);
  const flight = useRef<{
    email: string;
    promise: Promise<
      components["schemas"]["RegistrationEmailAvailabilityViewDto"]
    >;
  } | null>(null);
  const [state, setState] = useState({ email: "", checking: false, error: "" });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const check = useCallback(async (candidate: string) => {
    if (!isRegistrationEmailValid(candidate))
      return { available: false, error: "Nhập email hợp lệ." };
    if (current.current === candidate && alive.current)
      setState({ email: candidate, checking: true, error: "" });
    const promise =
      flight.current?.email === candidate
        ? flight.current.promise
        : request<
            components["schemas"]["RegistrationEmailAvailabilityViewDto"]
          >(
            "/auth/registration-email-availability",
            {
              method: "POST",
              body: JSON.stringify({ email: candidate }),
              signal: AbortSignal.timeout(10_000),
            },
            false,
          );
    flight.current = { email: candidate, promise };
    try {
      const result = await promise;
      const isCurrent = current.current === candidate;
      const error = result.available ? "" : takenMessage;
      if (isCurrent && alive.current)
        setState({
          email: candidate,
          checking: false,
          error,
        });
      return {
        available: isCurrent && result.available,
        error: isCurrent
          ? error
          : "Email thay đổi trong lúc kiểm tra. Vui lòng thử lại.",
      };
    } catch (cause) {
      const isCurrent = current.current === candidate;
      const error =
        (cause as { status?: number }).status === 429
          ? "Bạn kiểm tra email quá nhiều lần. Vui lòng thử lại sau."
          : "Chưa kiểm tra được email. Vui lòng thử lại.";
      if (isCurrent && alive.current)
        setState({
          email: candidate,
          checking: false,
          error,
        });
      return { available: false, error };
    } finally {
      if (flight.current?.promise === promise) flight.current = null;
    }
  }, [takenMessage]);
  useEffect(() => {
    if (!enabled || !isRegistrationEmailValid(normalized)) return;
    const timer = setTimeout(() => {
      void check(normalized);
    }, 500);
    return () => clearTimeout(timer);
  }, [normalized, enabled, check]);
  return {
    checking: state.email === normalized && state.checking,
    error: state.email === normalized ? state.error : "",
    check: () => check(normalized),
  };
}
