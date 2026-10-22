import { describe, expect, it } from "vitest";
import {resolveLedgerRouteInput as resolveInput} from "./route-input";

describe("async canonical route input",()=>{
  it("preserves decoded params and multi-valued query without dropping filters",async()=>{
    expect(await resolveInput({
      params:Promise.resolve({id:"record-1",parts:["a","b"]}),
      searchParams:Promise.resolve({q:"xoài",page:"2",tag:["a","b"]}),
    })).toEqual({params:{id:"record-1",parts:["a","b"]},searchParams:{q:"xoài",page:"2",tag:["a","b"]}});
  });
  it("accepts a static URL with no params or query",async()=>{
    expect(await resolveInput({})).toEqual({params:{},searchParams:{}});
  });
});
