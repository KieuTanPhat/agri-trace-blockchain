import AuthFlow from "./dev-auth-flow";
import { devConsumerNotice } from "./dev-consumer-notice";
export default function RealAuthFlow({ mode }: { mode: "register" | "reset" }) {
  return <AuthFlow mode={mode} demo={false} document={devConsumerNotice} />;
}
