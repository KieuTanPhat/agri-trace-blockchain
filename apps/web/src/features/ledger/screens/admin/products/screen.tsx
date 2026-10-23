"use client";
import Link from "next/link";
import {useState} from "react";
import {EnrollmentProducts} from "../enterprises/enrollment-products";
import {PageBody,PageHeader,EmptyState} from "@/components/ledger/kit/page";
import {DataTable} from "@/components/ledger/kit/data-table";
import {FilterBar,FilterSelect} from "@/components/ledger/kit/filters";
import {Guard} from "@/components/ledger/kit/guard";
import {api} from "@/lib/ledger/platform-api";
import {useLedgerQuery} from "@/lib/ledger/data";
import {t} from "@/lib/ledger/i18n";
import {useLedgerParams,LedgerRouteScreen} from "@/components/ledger/route-screen";
import type{LedgerScreenProps}from"@/lib/ledger/route-input";
import {useLocale}from"@/components/ledger/locale";
export function ProductsRead(){return <Guard permission="products.read"><Products/></Guard>;}
function Products(){
 const {organizationId}=useLedgerParams<{organizationId?:string}>();
 const catalog=useLedgerQuery({queryKey:["catalog"],queryFn:api.governance.catalog}),orgs=useLedgerQuery({queryKey:["organizations"],queryFn:api.enterprises.organizations});
 const [search,setSearch]=useState(""),[filter,setFilter]=useState("");
 const products=catalog.data?.products??[],needle=search.toLocaleLowerCase("vi");
 const entries=(orgs.data??[]).filter(o=>o.type!=="AUDITOR").sort((a,b)=>a.name.localeCompare(b.name,"vi")).map(o=>({id:o.id,name:o.name,products:products.filter(p=>p.organizationId===o.id)}));
 entries.push({id:"shared",name:t("Danh mục dùng chung"),products:products.filter(p=>!p.organizationId)});
 const rows=entries.filter(e=>(filter==="HAS"?e.products.length>0:filter==="NONE"?e.products.length===0:true)&&(!needle||e.name.toLocaleLowerCase("vi").includes(needle)||e.products.some(p=>`${p.productName} ${p.sku??""} ${p.gtin??""} ${p.variety??""}`.toLocaleLowerCase("vi").includes(needle))));
 const found=organizationId==="shared"||orgs.data?.some(o=>o.id===organizationId);
 return <><PageHeader title={t("Sản phẩm")} description={t("Tra cứu sản phẩm và thông tin công bố của tổ chức")} actions={organizationId&&<Link href="/admin/products">{t("Tất cả tổ chức")}</Link>}/><PageBody>{organizationId?(orgs.data&&!found?<EmptyState title={t("Không tìm thấy tổ chức")}/>:<EnrollmentProducts organizationId={organizationId} catalogScope/>):<><FilterBar search={search} onSearch={setSearch} placeholder={t("Tìm tổ chức, sản phẩm, SKU, GTIN hoặc giống")} active={!!search||!!filter} onReset={()=>{setSearch("");setFilter("")}}><FilterSelect label={t("Sản phẩm")} value={filter} onChange={setFilter} options={[{value:"HAS",label:t("Có sản phẩm")},{value:"NONE",label:t("Chưa có sản phẩm")}]} /></FilterBar><div className="min-w-0 overflow-hidden rounded-md border border-line bg-card"><DataTable rows={rows} loading={catalog.isLoading||orgs.isLoading} error={catalog.error??orgs.error} onRetry={()=>{void catalog.refetch();void orgs.refetch()}} rowKey={r=>r.id} href={r=>"/admin/products/"+r.id} columns={[{key:"name",header:t("Tổ chức"),cell:r=><span className="flex flex-col gap-1"><Link href={"/admin/products/"+r.id} onClick={e=>e.stopPropagation()} className="text-brand hover:underline">{r.name}</Link>{needle&&<span className="text-[12px] text-ink-2">{r.products.filter(p=>`${p.productName} ${p.sku??""} ${p.gtin??""} ${p.variety??""}`.toLocaleLowerCase("vi").includes(needle)).map(p=>p.productName).join(" · ")}</span>}</span>},{key:"total",header:t("Sản phẩm"),cell:r=>r.products.length},{key:"active",header:t("Đang hoạt động"),cell:r=>r.products.filter(p=>p.status==="ACTIVE").length}]}/></div></>}</PageBody></>;
}
export default function LedgerScreen({route}:LedgerScreenProps){useLocale();return <LedgerRouteScreen route={route} name="admin-products"><ProductsRead/></LedgerRouteScreen>;}