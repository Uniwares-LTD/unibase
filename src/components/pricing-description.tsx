import { useFormatter, useTranslations } from "next-intl";
import type { AiPricing } from "@/lib/config/ai-pricing";
export function PricingDescription({ pricing }: { pricing: AiPricing }) {
  const t = useTranslations("pricing"),
    format = useFormatter();
  if (pricing.mode === "fixed")
    return <>{t("fixed", { amount: format.number(pricing.credits) })}</>;
  const rule = pricing.mode === "hybrid" ? pricing.usage : pricing;
  const usage =
    rule.mode === "provider-cost"
      ? t("provider", {
          amount: rule.creditsPerCurrencyUnit,
          currency: rule.currency,
        })
      : rule.rate.basis === "total"
        ? t("total", { amount: rule.rate.creditsPerMillion })
        : t("split", {
            input: rule.rate.inputCreditsPerMillion,
            output: rule.rate.outputCreditsPerMillion,
          });
  return (
    <>
      {pricing.mode === "hybrid"
        ? t("base", { amount: format.number(pricing.baseCredits) })
        : ""}
      {usage}
      {t("maximum", { amount: format.number(pricing.maxCredits) })}
    </>
  );
}
