import {cleanup,render,screen} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {AboutPage,ContactPage,SolutionsPage} from "@/features/ledger/public/pages";
import {LedgerPublicShell} from "@/components/ledger/shell/public-shell";
import {setLocale} from "@/lib/ledger/i18n";
import {pt} from "@/lib/ledger/public-i18n";
import {SITE_CONTACT} from "@/lib/site-contact";
vi.mock("next/navigation",()=>({usePathname:()=>"/"}));
vi.mock("next/image",()=>({default:({alt}:{alt:string})=><span role="img" aria-label={alt}/>}));
afterEach(()=>{cleanup();setLocale("vi");document.documentElement.className="";});
const hrefs=()=>screen.getAllByRole("link").map(a=>a.getAttribute("href"));
describe("public information pages",()=>{
 it.each([["about",AboutPage,"Về AgriTrace"],["solutions",SolutionsPage,"Giải pháp truy xuất theo vai trò"],["contact",ContactPage,"Liên hệ AgriTrace"]] as const)("renders %s without lot links or demonstration data",(_,Page,title)=>{
  const {container}=render(<Page/>);
  expect(screen.getByRole("heading",{level:1})).toHaveTextContent(title);
  expect(hrefs().some(h=>h?.startsWith("/trace/"))).toBe(false);
  expect(container.textContent).not.toMatch(/demo|lô mẫu|dữ liệu minh họa/i);
 });
 it("keeps pricing and business registration inside solutions without invented prices",()=>{
  const {container}=render(<SolutionsPage/>);
  expect(container.querySelector("#bang-gia")).not.toBeNull();
  expect(hrefs()).toContain("/register");
  expect(container.textContent).not.toMatch(/\d[\d.,]*\s*(?:đ|₫|VND|USD|\$)/i);
  expect(screen.getAllByText("Liên hệ báo giá").length).toBeGreaterThan(0);
 });
 it("keeps the shared contact channels",()=>{
  render(<ContactPage/>);
  expect(hrefs()).toEqual(expect.arrayContaining([SITE_CONTACT.emailUrl,SITE_CONTACT.zaloUrl,"/solutions","/scan"]));
 });
 it("renders the English copy after switching locale",()=>{
  setLocale("en");
  render(<AboutPage/>);
  expect(screen.getByRole("heading",{level:1})).toHaveTextContent("About AgriTrace");
  expect(pt("Chuỗi chưa có trong từ điển")).toBe("Chuỗi chưa có trong từ điển");
 });
});
describe("public shell",()=>{
 it("shows only the light theme and restores the admin dark preference on leave",()=>{
  document.documentElement.classList.add("dark");
  const {unmount}=render(<LedgerPublicShell><p>body</p></LedgerPublicShell>);
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  expect(screen.queryByRole("button",{name:/Giao diện (sáng|tối)/})).toBeNull();
  unmount();
  expect(document.documentElement.classList.contains("dark")).toBe(true);
 });
 it("has no sign-in or registration buttons in the header; registration sits under solutions",()=>{
  render(<LedgerPublicShell><p>body</p></LedgerPublicShell>);
  const header=document.querySelector("header")!;
  expect(header.querySelectorAll("a[href='/login']").length).toBe(0);
  const register=[...header.querySelectorAll("a[href='/register']")];
  expect(register).toHaveLength(1);
  expect(register[0].closest(".group")?.querySelector("a[href='/solutions']")).not.toBeNull();
  expect(hrefs()).not.toContain("/news");
 });
});
