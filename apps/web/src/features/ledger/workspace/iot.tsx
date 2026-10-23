"use client";
import {useState} from "react";
import {z} from "zod";
import {useAuth} from "@/lib/auth-store";
import {getAuthorizationScope} from "@/lib/auth-scope";
import {sendSensorReading} from "@/lib/api-client";
import {saveStoredIotReading} from "@/lib/iot-local-store";
import {useLedgerQuery} from "@/lib/ledger/data";
import {opsApi} from "@/lib/ledger/ops-api";
import {isoToLocal,localToIso} from "@/lib/ledger/ops-dates";
import {CommandForm} from "@/components/ledger/kit/command-dialog";
import {SelectField,TextField} from "@/components/ledger/kit/form-fields";
import {PageHeader,PageBody,Callout} from "@/components/ledger/kit/page";
import {t as tr} from "@/lib/ledger/i18n";
const schema=z.object({deviceId:z.string().trim().min(1).max(100),cycleId:z.string().uuid(),sensorType:z.string().min(1),value:z.coerce.number<number>().finite(),unit:z.string().trim().min(1).max(30),recordedAt:z.string().min(1)});
export default function IotPage(){const{user}=useAuth();const cycles=useLedgerQuery({queryKey:["ws-cycles"],queryFn:opsApi.cycles});const[accepted,setAccepted]=useState<string>();const active=(cycles.data??[]).filter(c=>["PLANTED","GROWING"].includes(c.currentState)&&(c.canWriteProduction??(!c.chainId&&user?.role.code==="FARM_STAFF")));
return <><PageHeader title={tr("Mô phỏng cảm biến")} description={tr("Gửi dữ liệu cảm biến cho vụ được phân công. Kết quả tiếp nhận do máy chủ quyết định.")}/><PageBody>{accepted&&<Callout tone="info">{tr("Đã tiếp nhận")}: {accepted}</Callout>}<div className="max-w-2xl rounded-md border border-line bg-card p-4"><CommandForm title={tr("Bản ghi cảm biến")} endpoint="POST /iot/readings" schema={schema} defaultValues={{deviceId:"",cycleId:"",sensorType:"TEMPERATURE",value:0,unit:"°C",recordedAt:isoToLocal(new Date().toISOString())}} submitLabel={tr("Gửi bản ghi")} invalidate={[["ws-cycles"]]} run={async(v,cmd)=>{const sent={...v,recordedAt:localToIso(v.recordedAt)!},r=await sendSensorReading(sent,cmd.idempotencyKey);if(r.status!=="accepted")throw r.error;if(r.readingId){saveStoredIotReading({...sent,readingId:r.readingId,acceptedAt:new Date().toISOString(),status:"accepted"},getAuthorizationScope(user));setAccepted(r.readingId);}return r;}}>{f=><div className="grid gap-3 sm:grid-cols-2"><SelectField control={f.control} name="cycleId" label={tr("Vụ sản xuất")} options={active.map(c=>({value:c.id,label:c.cycleCode}))}/><TextField control={f.control} name="deviceId" label={tr("Mã thiết bị")}/><SelectField control={f.control} name="sensorType" label={tr("Loại cảm biến")} options={["TEMPERATURE","HUMIDITY","SOIL_MOISTURE"].map(x=>({value:x,label:x}))}/><TextField control={f.control} name="value" label={tr("Giá trị")} type="number"/><TextField control={f.control} name="unit" label={tr("Đơn vị")}/><TextField control={f.control} name="recordedAt" label={tr("Thời điểm đo")} type="datetime-local"/></div>}</CommandForm></div></PageBody></>;}
