/** The App Store locale a storefront country maps to; en-US when unknown. */
export const STOREFRONT_LOCALE: Record<string, string> = {
  US: "en-US", GB: "en-GB", AU: "en-AU", CA: "en-CA", DE: "de-DE", FR: "fr-FR", ES: "es-ES", MX: "es-MX",
  IT: "it", BR: "pt-BR", PT: "pt-PT", NL: "nl-NL", JP: "ja", KR: "ko", CN: "zh-Hans", TW: "zh-Hant",
  RU: "ru", TR: "tr", PL: "pl", SE: "sv", DK: "da", FI: "fi", NO: "no",
};

export function storefrontLocale(country: string | null | undefined): string {
  return STOREFRONT_LOCALE[(country || "US").toUpperCase()] ?? "en-US";
}
