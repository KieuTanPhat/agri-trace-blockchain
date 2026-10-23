"use client";
import {createContext,useContext,useState} from "react";
import type {components} from "@/lib/generated/api";
import {useAuth} from "@/lib/auth-store";
import {getAuthorizationScope} from "@/lib/auth-scope";
type Draft={input:components["schemas"]["ServiceQuoteInput"];preview:components["schemas"]["ServicePreviewView"]};
const Context=createContext<{draft:Draft|null;setDraft:(value:Draft|null)=>void}|null>(null);
function State({children}:{children:React.ReactNode}){const[draft,setDraft]=useState<Draft|null>(null);return <Context.Provider value={{draft,setDraft}}>{children}</Context.Provider>;}
export function LedgerServiceDraftProvider({children}:{children:React.ReactNode}){const{user}=useAuth();return <State key={getAuthorizationScope(user && {...user,accessRevision:undefined})}>{children}</State>;}
export function useLedgerServiceDraft(){const value=useContext(Context);if(!value)throw new Error("Service draft provider is required");return value;}
