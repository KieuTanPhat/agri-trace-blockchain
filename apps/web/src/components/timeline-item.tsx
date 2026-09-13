import type { TraceEvent } from "@/lib/types";
import { labelForEvent, labelForRole } from "@/lib/display-labels";
import { StateBadge } from "./state-badge";
import { formatTraceDate } from "@/lib/format-date";

export function TimelineItem({ event }: { event: TraceEvent }) {
  return (
    <article className="timeline-item">
      <span className="timeline-dot" aria-hidden="true" />
      <div className="timeline-body">
        <div className="panel-title">
          <h3>{labelForEvent(event.eventType)}</h3>
          <StateBadge state={event.proofStatus} />
        </div>
        <div className="timeline-meta"><time dateTime={event.eventTime}>{formatTraceDate(event.eventTime)}</time><span>{event.actor.organizationName}</span><span>{labelForRole(event.actor.role)}</span></div>
        <p>{event.summary}</p>
      </div>
    </article>
  );
}
