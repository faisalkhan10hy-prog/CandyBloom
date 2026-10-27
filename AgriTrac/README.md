# AgriTrac Support Portal

A standalone support portal and Node.js API. No npm packages are required; the server uses Node built-ins.

## Run locally

Requires Node.js 22.9 or newer.

```powershell
Copy-Item .env.example .env
npm start
```

Open `http://localhost:3000/agritrac`. The AgriTrac page, assets and `/api` endpoints are served from the same origin.

With Freshservice credentials left blank, tickets are saved to `data/requests.json` on this machine. This demo mode does not send tickets to an agent.

The support chat widget is a local preview: it demonstrates conversation messages and the immediate post-chat survey, but it does not connect to a live agent or Freshchat. A real chat provider must call the same survey flow when its trusted agent-ended event fires and supply the provider's conversation, user, and agent IDs.

Survey responses are stored in the SQLite database `data/surveys.sqlite`, created from `surveys.sql`. The schema stores one response per conversation, including its user and agent IDs, 1–5 rating, optional comment, and server-generated submission timestamp. Keep the data directory on persistent storage in production; Render's default filesystem can be ephemeral, so configure `AGRITRAC_DATA_DIR` to a mounted persistent disk before collecting responses you need to retain.

## Connect Freshservice

1. Copy `.env.example` to `.env` if you have not already.
2. Set `FRESHSERVICE_DOMAIN` to your account host, such as `company.freshservice.com`.
3. Set `FRESHSERVICE_API_KEY` to a Freshservice API key. Keep this value in the server environment; never put it in `app.js` or a public repository.
4. Optionally set `FRESHSERVICE_GROUP_ID` to the support group that should receive requests. If omitted, Freshservice's assignment rules apply.
5. Restart the server.

When both Freshservice values are set, `POST /api/tickets` creates a Freshservice ticket. `POST /api/tickets/lookup` checks the ticket and verifies the requester's email before returning its status.

## Conversation survey

- The floating chat preview on `/agritrac` demonstrates the survey lifecycle. Starting a preview creates conversation and user IDs in the browser; the demo agent's **End chat** action immediately replaces the conversation screen with the required rating and optional comment form.
- `POST /api/surveys` accepts `{ conversationId, userId, agentId, rating, comment }`. The rating is required (integer 1–5), comments are optional (up to 2,000 characters), and duplicate submissions for a conversation are rejected.
- `submitted_at` is set by the server. `conversation_id` is the primary key, so each conversation can have at most one saved response.
- Configure `SURVEY_ADMIN_TOKEN` as a private environment variable to protect analytics. Open `/admin/surveys` and enter this token to view average rating, total and positive/negative/neutral counts, and agent-wise CSAT. CSAT is the percentage of 4- and 5-star ratings. The analytics API returns aggregate data only, not feedback comments or user IDs.
- To integrate an actual chat service, connect its authenticated agent-ended event to the widget's `endConversation` transition and use the provider's real IDs. The included demo end-chat control is not an agent authentication mechanism and should not be exposed as the production chat workflow.

## API

- `GET /api/health` reports whether the server is in demo or Freshservice mode. It never returns secrets.
- `POST /api/tickets` accepts `{ name, email, topic, model, message }`.
- `POST /api/tickets/lookup` accepts `{ ticketNumber, email }`.
- `POST /api/surveys` stores one post-chat survey for a conversation.
- `GET /api/surveys/analytics` requires `Authorization: Bearer <SURVEY_ADMIN_TOKEN>` and returns aggregate satisfaction metrics.

Ticket endpoints validate input, and the lookup requires the same email used to create the request. Survey submissions validate identifiers, comment length, and the required rating.

## Deploy one public URL

The repository-root `render.yaml` deploys this Node server as one web service named `agritrac-support`; it serves the page and APIs. Connect the GitHub repository to Render as a Blueprint and set `FRESHSERVICE_DOMAIN`, `FRESHSERVICE_API_KEY`, and `SURVEY_ADMIN_TOKEN` as private environment values when prompted. Do not add secrets to source code or commit them. Configure persistent storage and point `AGRITRAC_DATA_DIR` at its mount before relying on survey data across deploys.

The branded page path is `/agritrac`; the expected address is `https://agritrac-support.onrender.com/agritrac` if that Render service name is available. Render assigns the actual hostname when the service is created. GitHub Pages by itself cannot run the Node backend.
