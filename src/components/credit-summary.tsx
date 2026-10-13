import { useTranslations, useFormatter, useTimeZone } from "next-intl";
import { EmptyState, Notice } from "./page-patterns";
import Link from "next/link";
import type { CreditAccount } from "@/lib/contracts/credits";
import { Button } from "./ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "./ui/table";

export function CreditSummary({
  account,
  historyPath,
}: {
  account: CreditAccount;
  historyPath: string;
}) {
  const translate = useTranslations("ui");
  const format = useFormatter();
  const zone = useTimeZone();
  const common = useTranslations("common");
  const date = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const eventNames: Record<string, string> = {
    grant: translate("me1945c17a649"),
    deduction: translate("m8b73157e6304"),
    reserve: translate("m3385ffe67470"),
    commit: translate("m679652fd13c5"),
    release: translate("mf33deea9b100"),
    "hold-expired": translate("m491a731e9918"),
    "hold-cancelled": translate("mc517b7e1ee8c"),
    expiry: translate("m9b379c6b6bfd"),
    "purchase-reversal": translate("m5d878844197b"),
    "purchase-restoration": translate("mec06576c1bd1"),
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [translate("me674447337e8"), account.available],
          [translate("m3385ffe67470"), account.reserved],
          [translate("m026e2f9afbc7"), account.debt],
          [translate("m412d5e16235c"), account.balance],
        ].map(([label, number], index) => (
          <Card
            key={label}
            className={
              index === 0 ? "border-primary/25 bg-secondary/40" : undefined
            }
          >
            <CardHeader>
              <CardTitle className="text-sm">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="break-all text-3xl tabular-nums">
                {typeof number === "number" ? format.number(number) : number}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      {account.debt > 0 && (
        <Notice tone="warning" title={translate("mc44f06cbf34f")}>
          {translate("m95686cd6e2bf")}{" "}
        </Notice>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{translate("m01c2b25754c4")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              {common("zone", { zone: zone ?? "UTC" })}{" "}
            </p>
            {account.upcoming.length ? (
              <ul className="space-y-2">
                {account.upcoming.map((item, i) => (
                  <li key={i}>
                    {format.number(item.credits)} {translate("mea96a424e259")}{" "}
                    {date(item.expiresAt)} {zone}{" "}
                  </li>
                ))}
              </ul>
            ) : (
              <p>{translate("m921ec6d27707")}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{translate("m855ffb203f93")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              {translate("m401a2600d293")}{" "}
            </p>
            {account.holds.length ? (
              <ul className="space-y-2">
                {account.holds.map((item) => (
                  <li key={item.id}>
                    {format.number(item.credits)} {translate("mea96a424e259")}{" "}
                    {item.managedJobId
                      ? translate("mcc1ed331632f")
                      : common("until", { date: date(item.expiresAt) })}
                  </li>
                ))}
              </ul>
            ) : (
              <p>{translate("m1a5ed58b9fc0")}</p>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{translate("ma38ff6ae4af3")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {account.history.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{translate("ma4528df6c39b")}</TableHead>
                  <TableHead>{translate("m4e1f49a9c8ae")}</TableHead>
                  <TableHead>{translate("m2a6b24ad2872")}</TableHead>
                  <TableHead>{translate("m7f1d4110839d")}</TableHead>
                  <TableHead>{translate("m148dac4dcdde")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {account.history.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="whitespace-nowrap">
                      {date(item.timestamp)}
                    </TableCell>
                    <TableCell>
                      <p>
                        {eventNames[item.kind] ?? translate("mffc42427f4ca")}
                      </p>
                      {item.reason && (
                        <p className="max-w-xs break-words text-xs text-muted-foreground">
                          {item.reason}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {item.delta > 0 ? "+" : ""}
                      {item.delta}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {item.reservedDelta > 0 ? "+" : ""}
                      {item.reservedDelta}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {item.balanceAfter}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              title={translate("m7a4a0ffc6d9d")}
              description={translate("m41f64e2322eb")}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href={historyPath}>{translate("m08ee9e0b3d0b")}</Link>
            </Button>
            {account.nextBefore && (
              <Button variant="outline" asChild>
                <Link href={`${historyPath}?before=${account.nextBefore}`}>
                  {translate("m0eed19abab86")}{" "}
                </Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
