import AuthFlow from "./dev-auth-flow";
import { legalPreview, PREVIEW_CONSENT_VERSION } from "./legal-preview";
export default function DemoAuthFlow({ mode }: { mode: "register" | "reset" }) {
  return (
    <AuthFlow
      mode={mode}
      demo
      document={{ version: PREVIEW_CONSENT_VERSION, sections: legalPreview }}
    />
  );
}
