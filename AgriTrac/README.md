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

## Connect Freshservice

1. Copy `.env.example` to `.env` if you have not already.
2. Set `FRESHSERVICE_DOMAIN` to your account host, such as `company.freshservice.com`.
3. Set `FRESHSERVICE_API_KEY` to a Freshservice API key. Keep this value in the server environment; never put it in `app.js` or a public repository.
4. Optionally set `FRESHSERVICE_GROUP_ID` to the support group that should receive requests. If omitted, Freshservice's assignment rules apply.
5. Restart the server.

When both Freshservice values are set, `POST /api/tickets` creates a Freshservice ticket. `POST /api/tickets/lookup` checks the ticket and verifies the requester's email before returning its status.

## API

- `GET /api/health` reports whether the server is in demo or Freshservice mode. It never returns secrets.
- `POST /api/tickets` accepts `{ name, email, topic, model, message }`.
- `POST /api/tickets/lookup` accepts `{ ticketNumber, email }`.

Both endpoints validate input. The lookup requires the same email used to create the request.

## Deploy one public URL

The repository-root `render.yaml` deploys this Node server as one web service named `agritrac-support`; it serves both the page and ticket API. Connect the GitHub repository to Render as a Blueprint and set `FRESHSERVICE_DOMAIN` and `FRESHSERVICE_API_KEY` as private environment values when prompted. Do not add the API key to source code or commit it.

The branded page path is `/agritrac`; the expected address is `https://agritrac-support.onrender.com/agritrac` if that Render service name is available. Render assigns the actual hostname when the service is created. GitHub Pages by itself cannot run the Node backend.
