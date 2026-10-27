CREATE TABLE IF NOT EXISTS conversation_surveys (
  conversation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '' CHECK (length(comment) <= 2000),
  submitted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS conversation_surveys_agent_id_idx
  ON conversation_surveys (agent_id);

CREATE INDEX IF NOT EXISTS conversation_surveys_submitted_at_idx
  ON conversation_surveys (submitted_at);
