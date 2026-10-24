import {cleanup,render,screen} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import Home from "@/features/ledger/public/home";
import {SITE_CONTACT} from "@/lib/site-contact";
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn()})}));
vi.mock("next/image",()=>({default:({alt}:{alt:string})=><span role="img" aria-label={alt}/>}));
afterEach(cleanup);
it("offers public scan and solutions without a demonstration lot or account buttons",()=>{
 const {container}=render(<Home/>);expect(screen.getByRole("heading",{level:1})).toHaveTextContent("Hành trình nông sản");
 const hrefs=screen.getAllByRole("link").map(a=>a.getAttribute("href"));
 expect(hrefs).toEqual(expect.arrayContaining(["/scan","/solutions","/contact"]));
 expect(hrefs).not.toContain("/register");
 expect(hrefs).not.toContain("/login");
 expect(hrefs.some(h=>h?.startsWith("/trace/"))).toBe(false);
 expect(container.textContent).not.toMatch(/demo|lô mẫu|dữ liệu minh họa/i);
});
it("keeps the shared email and Zalo contact destinations",()=>{
 render(<Home/>);const hrefs=screen.getAllByRole("link").map(a=>a.getAttribute("href"));
 expect(hrefs).toContain(SITE_CONTACT.emailUrl);expect(hrefs).toContain(SITE_CONTACT.zaloUrl);
});
it("describes public trace and separates ledger evidence from warnings and certificates",()=>{
 const {container}=render(<Home/>);expect(container.textContent).toContain("Trạng thái sổ cái, cảnh báo và chứng nhận được trình bày riêng.");
 expect(container.textContent).not.toMatch(/Dữ liệu nghiệp vụ được ký số|Chữ ký số của tổ chức/);
});
