import {beforeEach,expect,it,vi} from "vitest";
import {signDistributionC2} from "./distribution-c2";
import {canonicalJson} from "./distribution-signer";
import {sha256Hex} from "./signing/canonical";
const mocks=vi.hoisted(()=>({request:vi.fn(),list:vi.fn(),sign:vi.fn()}));
vi.mock("./api-client",()=>({request:mocks.request}));
vi.mock("./distribution-signer",async original=>({...await original<typeof import("./distribution-signer")>(),distributionKeyStore:{list:mocks.list}}));
vi.mock("./signing/signer",()=>({signPreparedIntent:mocks.sign}));
beforeEach(()=>{vi.resetAllMocks();mocks.list.mockResolvedValue([{id:"key"}]);mocks.sign.mockResolvedValue("signature");});
it("checks c2 prepared snapshot including pickup delivery dates and note against the displayed transfer",async()=>{
 const transfer={id:"transfer",chainId:"chain",senderId:"sender",carrierId:"carrier",receiverId:"receiver",origin:"origin",destination:"destination",vehicleId:null,handoverMode:"DUAL_SIGNED",attestationEpoch:1,plannedPickupAt:"2026-10-23T00:00:00.000Z",plannedDeliveryAt:null,note:"Keep cold",version:7,lines:[{lotId:"lot",quantity:"12.125",unit:"kg"}]};
 const snapshot={id:"transfer",chainId:"chain",senderId:"sender",carrierId:"carrier",receiverId:"receiver",origin:"origin",destination:"destination",vehicleId:null,handoverMode:"DUAL_SIGNED",attestationEpoch:1,plannedPickupAt:transfer.plannedPickupAt,plannedDeliveryAt:null,note:transfer.note,lines:[{lotId:"lot",quantity:"12.125",unit:"kg"}]},canonical=canonicalJson(snapshot),digest=await sha256Hex(new TextEncoder().encode(canonical));
 mocks.request.mockResolvedValueOnce({chainRef:"ref",bindingDigest:"binding",keys:[{keyRef:"key",status:"ACTIVE"}]}).mockResolvedValueOnce({items:[{intentId:"intent",operation:"DISTRIBUTION_ATTEST",payload:{lotId:"lot",snapshot:canonical,snapshotDigest:digest,quantity:"12.125",unit:"kg",phase:"PICKUP",documentId:"transfer",signerUserId:"user",documentVersion:"7"}}]});
 await expect(signDistributionC2(transfer,"PICKUP",{id:"user",organizationId:"sender"})).resolves.toEqual({phase:"PICKUP",version:7,signatures:[{lotId:"lot",intentId:"intent",signature:"signature"}]});expect(mocks.sign).toHaveBeenCalledOnce();
});
