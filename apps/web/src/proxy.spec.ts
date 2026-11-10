import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";
beforeEach(()=>{vi.stubEnv("NEXT_PUBLIC_BUSINESS_ORIGIN","https://nongtrace.site");vi.stubEnv("NEXT_PUBLIC_CUSTOMER_ORIGIN","https://agritrace.dev");});
afterEach(()=>vi.unstubAllEnvs());
it("redirects actual Next requests without trusting forwarded hosts",()=>{
 const result=proxy(new NextRequest("https://agritrace.dev/login?next=%2Fenterprise",{headers:{"x-forwarded-host":"evil.example"}}));
 expect(result.status).toBe(307);
 expect(result.headers.get("location")).toBe("https://nongtrace.site/login?next=%2Fenterprise");
});
it.each(["/api/auth/login","/enterprise"])("does not redirect POST bodies at %s",path=>{
 const request=new NextRequest("https://agritrace.dev"+path,{method:"POST",body:"original payload"});
 expect(proxy(request).headers.get("x-middleware-next")).toBe("1");
 expect(request.bodyUsed).toBe(false);
});
it("leaves public trace requests on their original host",()=>{
 expect(proxy(new NextRequest("https://agritrace.dev/trace/old-token")).headers.get("x-middleware-next")).toBe("1");
});
it("routes the client Host when standalone Next exposes its internal URL",()=>{
 const result=proxy(new NextRequest("http://localhost:3000/register?source=customer",{headers:{host:"agritrace.dev"}}));
 expect(result.status).toBe(307);
 expect(result.headers.get("location")).toBe("https://nongtrace.site/register?source=customer");
});
it('replaces untrusted nonces and sends a matching, non-cacheable render policy',()=>{
 vi.stubEnv('NODE_ENV','production');
 const make=()=>proxy(new NextRequest('https://agritrace.dev/trace/test',{headers:{'x-nonce':'attacker-nonce','content-security-policy':"script-src *"}}));
 const first=make(),second=make();
 const nonce=first.headers.get('x-middleware-request-x-nonce');
 expect(nonce).toBeTruthy();
 expect(nonce).not.toBe('attacker-nonce');
 expect(nonce).not.toBe(second.headers.get('x-middleware-request-x-nonce'));
 expect(first.headers.get('content-security-policy')).toBe(first.headers.get('x-middleware-request-content-security-policy'));
 expect(first.headers.get('content-security-policy')).toContain(`'nonce-${nonce}'`);
 expect(first.headers.get('cache-control')).toContain('no-store');
});
