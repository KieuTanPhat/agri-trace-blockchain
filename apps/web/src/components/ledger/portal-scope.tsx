"use client";
import {createContext,useContext} from "react";

// Private portals must inherit the admitted page's hidden/inert boundary.
// Undefined keeps the normal body portal for public pages and standalone kit use.
const PortalScope=createContext<HTMLElement|null|undefined>(undefined);
export const LedgerPortalScope=PortalScope.Provider;
export const useLedgerPortalContainer=()=>useContext(PortalScope);
