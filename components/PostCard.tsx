import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, type ScheduledPostStatus } from "@/components/StatusBadge";
import { formatScheduledTime, truncateCaption } from "@/lib/format";
import { platformLabel } from "@/lib/platforms";

export interface PostCardProps {
  id: string;
  status: ScheduledPostStatus;
  platform: string;
  scheduledAt: Date;
  caption: string;
  source: string;
  publisherBackend: string;
  publisherPostId: string | null;
}

export function PostCard(props: PostCardProps) {
  return (
    <li>
      <Link
        href={`/outbox/${props.id}`}
        className="flex items-stretch gap-3 p-4 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-violet-500 motion-reduce:transition-none dark:hover:bg-slate-800"
        aria-label={`Open post scheduled ${formatScheduledTime(props.scheduledAt)} for ${platformLabel(props.platform)}`}
      >
        <div className="flex flex-1 flex-col gap-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={props.status} />
            <Badge tone="slate">{platformLabel(props.platform)}</Badge>
            <time
              dateTime={props.scheduledAt.toISOString()}
              className="text-xs text-slate-500 dark:text-slate-400 ml-auto sm:ml-0"
            >
              {formatScheduledTime(props.scheduledAt)}
            </time>
          </div>
          <p className="text-sm text-slate-900 dark:text-slate-50 line-clamp-2 break-words">
            {truncateCaption(props.caption)}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span>
              <span className="sr-only">Source: </span>
              {props.source}
            </span>
            {props.publisherPostId ? (
              <span className="font-mono text-[11px] truncate max-w-[14rem]">
                {props.publisherBackend}:{props.publisherPostId}
              </span>
            ) : null}
          </div>
        </div>
        <ChevronRight
          className="size-5 shrink-0 self-center text-slate-400"
          aria-hidden="true"
        />
      </Link>
    </li>
  );
}
