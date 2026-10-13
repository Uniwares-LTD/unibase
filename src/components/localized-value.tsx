import { useFormatter, useTranslations } from "next-intl";
export function NumberLabel({ value }: { value: number }) {
  return <bdi>{useFormatter().number(value)}</bdi>;
}
export function CurrencyLabel({
  amount,
  currency,
}: {
  amount: string;
  currency: string;
}) {
  const format = useFormatter();
  return (
    <bdi>
      {format.number(Number(amount), {
        style: "currency",
        currency,
        maximumFractionDigits: 18,
      })}
    </bdi>
  );
}
export function StateLabel({
  value,
}: {
  value: string | number | null | undefined;
}) {
  const t = useTranslations("states");
  const key = String(value ?? "");
  return <bdi>{t.has(key as never) ? t(key as never) : key || "—"}</bdi>;
}
export function DateLabel({
  value,
  utc = false,
}: {
  value: string;
  utc?: boolean;
}) {
  const format = useFormatter();
  return (
    <time dateTime={value}>
      {format.dateTime(new Date(value), {
        dateStyle: "medium",
        timeStyle: "short",
        ...(utc ? { timeZone: "UTC" } : {}),
      })}
    </time>
  );
}
