/** Native adapter boundary. Stage A never calls the browser cookie endpoints. */
export type ConsumerProfile = {
  id: string;
  fullName: string;
  phone: string;
  contactEmail?: string;
  province?: string;
  ward?: string;
  businessAddress?: string;
};
export type RegistrationInput = {
  phone: string;
  password: string;
  fullName: string;
  contactEmail?: string;
  provinceCode: string;
  wardCode: string;
  businessAddress?: string;
  consentVersion: string;
  phoneProof: string;
};
export interface AuthService {
  login(
    input: { phone: string; password: string },
    signal: AbortSignal,
  ): Promise<ConsumerProfile>;
  logout(): Promise<void>;
  register?(
    input: RegistrationInput,
    signal: AbortSignal,
  ): Promise<ConsumerProfile>;
  resetPassword?(
    input: { phone: string; password: string; phoneProof: string },
    signal: AbortSignal,
  ): Promise<void>;
}
export interface PhoneVerifier {
  cancel?(): void;
  send(
    phone: string,
    signal: AbortSignal,
  ): Promise<{ challengeId: string; resendAt: number }>;
  confirm(
    challengeId: string,
    code: string,
    signal: AbortSignal,
  ): Promise<string>;
}
export function authDemoEnabled(
  development: boolean,
  flag: string | undefined,
) {
  return development && flag === "true";
}
