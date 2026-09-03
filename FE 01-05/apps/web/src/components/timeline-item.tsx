import type { TraceEvent } from "@/lib/types";
import { labelForEvent, labelForRole } from "@/lib/display-labels";
import { StateBadge } from "./state-badge";

export function TimelineItem({ event }: { event: TraceEvent }) {
  return (
    <article className="timeline-item">
      <span className="timeline-dot" aria-hidden="true" />
      <div className="timeline-body">
        <div className="panel-title">
          <h3>{labelForEvent(event.eventType)}</h3>
          <StateBadge state={event.proofStatus} />
        </div>
        <p className="muted">{event.eventTime} - {event.actor.organizationName} - {labelForRole(event.actor.role)}</p>
        <p>{event.summary}</p>
      </div>
    </article>
  );
}
