-- 0011: San AI requests per account per UTC day, for the daily limit of POST /v1/ai/complete
-- (routes/ai.ts). Only the count: the text of a request is never stored.
--
-- Old days are never read again; a row is 3 small values, so they are left to accumulate rather
-- than swept on the request path.
--
-- Idempotent, like every migration here. MUST BE APPLIED BEFORE THE WORKER THAT USES IT IS DEPLOYED
-- (the route lets requests through when the count fails, so a missing table would turn the limit
-- off rather than break San AI).

CREATE TABLE IF NOT EXISTS ai_usage (
  user_id  TEXT NOT NULL,
  day      TEXT NOT NULL,
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
