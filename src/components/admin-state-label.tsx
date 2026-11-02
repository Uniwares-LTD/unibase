import { adminStateLabel } from "@/lib/admin-labels";

export function AdminStateLabel({
  value,
}: {
  value: string | number | null | undefined;
}) {
  return <bdi>{adminStateLabel(value)}</bdi>;
}
