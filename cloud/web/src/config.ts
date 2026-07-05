/**
 * Runtime config. `VITE_API_BASE` points at the deployed Worker
 * (https://api.shipaso.com); empty runs against the legacy demo path. Kept in
 * one place so the shell + future routes share it.
 */
export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
export const hasApiBase = API_BASE.length > 0;
