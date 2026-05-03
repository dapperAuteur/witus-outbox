import { Badge } from "@/components/ui/badge";

export type ScheduledPostStatus =
  | "queued"
  | "submitted"
  | "scheduled"
  | "posted"
  | "error"
  | "cancelled";

const statusTone: Record<
  ScheduledPostStatus,
  "sky" | "violet" | "amber" | "emerald" | "red" | "muted"
> = {
  queued: "sky",
  submitted: "violet",
  scheduled: "amber",
  posted: "emerald",
  error: "red",
  cancelled: "muted",
};

const statusLabel: Record<ScheduledPostStatus, string> = {
  queued: "Queued",
  submitted: "Submitted",
  scheduled: "Scheduled",
  posted: "Posted",
  error: "Error",
  cancelled: "Cancelled",
};

export function StatusBadge({ status }: { status: ScheduledPostStatus }) {
  return (
    <Badge tone={statusTone[status]}>
      <span className="sr-only">Status: </span>
      {statusLabel[status]}
    </Badge>
  );
}
