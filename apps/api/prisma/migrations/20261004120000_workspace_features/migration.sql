CREATE TABLE notification_read (
  "userId" uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  "eventId" uuid NOT NULL REFERENCES trace_event(event_id) ON DELETE CASCADE,
  "readAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("userId", "eventId")
);
CREATE TABLE media_attachment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "targetType" varchar(20) NOT NULL CHECK ("targetType" IN ('LOT','PRODUCT','CERTIFICATE')),
  "targetId" uuid NOT NULL,
  name varchar(255) NOT NULL,
  mime varchar(100) NOT NULL,
  size integer NOT NULL CHECK (size > 0 AND size <= 5242880),
  content bytea NOT NULL,
  "isPublic" boolean NOT NULL DEFAULT false,
  "createdBy" uuid NOT NULL REFERENCES app_user(user_id),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "media_attachment_targetType_targetId_idx" ON media_attachment("targetType", "targetId");
