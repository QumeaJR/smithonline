-- Feedback sent from the app (docs/10 section 2.3). Emails are cleared after 90 days and rows
-- deleted after 365 days by the Worker's daily cron; nothing else about the sender is stored.
CREATE TABLE feedback (
  id          TEXT PRIMARY KEY,            -- reference shown to the user, FB- plus 6 base32 chars
  created_at  TEXT NOT NULL,               -- ISO 8601 UTC
  category    TEXT NOT NULL CHECK (category IN ('bug','idea','question','other')),
  message     TEXT NOT NULL,
  email       TEXT,                        -- optional, cleared after 90 days
  design      TEXT,                        -- optional share-link payload, no part data
  app_version TEXT NOT NULL,
  layout      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','done'))
);
CREATE INDEX feedback_created ON feedback (created_at);
