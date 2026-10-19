import { EnterpriseServiceProvider } from "@/components/workspace/service-context";
export default function ServiceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <EnterpriseServiceProvider>{children}</EnterpriseServiceProvider>;
}
