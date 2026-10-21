# HubSpot Webhooks Journal Example

A full-stack example integration demonstrating the [HubSpot Webhooks Journal API](https://developers.hubspot.com/docs). This app subscribes to CRM contact events, processes them through a durable message queue, and displays real-time contact data in a React UI.

## What It Demonstrates

- **Client Credentials OAuth** for authenticating with the Webhooks Journal API
- **Journal polling** with offset-based cursor management
- **BullMQ message queue** for durable, parallel event processing
- **Last-write-wins reconciliation** using `occurredAt` timestamps
- **Bulk snapshot backfill** for initial data population
- **Advanced subscription filters** with AND/OR condition logic
- **Live React UI** reflecting CRM contact state in real time

## Architecture

```
┌──────────────────────┐     ┌─────────────────┐     ┌──────────────┐
│   React Frontend     │────▶│  Express API    │────▶│  PostgreSQL  │
│   (port 3000)        │     │  (port 3002)    │     │              │
└──────────────────────┘     └────────┬────────┘     └──────────────┘
                                      │
                           ┌──────────┴──────────┐
                           │                     │
                    ┌──────▼──────┐      ┌───────▼───────┐
                    │   Journal   │      │    Event      │
                    │   Poller    │─────▶│   Processor   │
                    │ (1 req/sec) │ Redis│ (5 workers)   │
                    └─────────────┘ MQ   └───────────────┘
```

1. **Journal Poller** — polls the HubSpot Webhooks Journal batch endpoint once per second, enqueues entries into BullMQ
2. **Event Processor** — 5 concurrent workers download journal files from S3, reconcile events with the local database
3. **Express API** — serves the React frontend and exposes REST endpoints for contacts, subscriptions, snapshots
4. **React Frontend** — dark-themed UI showing live contact data, bulk export controls, and test data population

## Prerequisites

- **Node.js** >= 18
- **PostgreSQL** (running locally)
- **Redis** (running locally, for BullMQ)
- A **HubSpot Public App** with OAuth configured (see setup below)

## Setup

### 1. Create a HubSpot Public App

1. Go to your [HubSpot Developer Account](https://developers.hubspot.com/)
2. Create a new Public App
3. Under **Auth**, add the redirect URL: `http://localhost:3002/oauth-callback`
4. Under **Auth > Scopes**, add:
   - `crm.objects.contacts.read`
   - `crm.objects.contacts.write`
5. Copy the **Client ID** and **Client Secret**

### 2. Configure Environment

```bash
git clone https://github.com/hubspotdev/webhooks-journal-example.git
cd webhooks-journal-example
cp .env.example .env
```

Edit `.env` with your values:

```
DATABASE_URL=postgresql://user:password@localhost:5432/webhooks_journal_example
CLIENT_ID=your-client-id
CLIENT_SECRET=your-client-secret
REDIS_URL=redis://localhost:6379
```

### 3. Install Dependencies

```bash
npm install
cd client && npm install && cd ..
```

### 4. Initialize Database

```bash
createdb webhooks_journal_example  # or use your preferred method
npm run db-init
```

### 5. Start the App

In two terminal windows:

```bash
# Terminal 1: Backend
npm run dev

# Terminal 2: Frontend
npm run client:dev
```

Open `http://localhost:3000` in your browser.

## Usage

1. **Enter Portal ID** — type the HubSpot portal ID you want to sync
2. **Install App** — click to authorize the app via OAuth (opens HubSpot in a new tab)
3. **View Live Data** — see contacts appear as the journal poller picks up events
4. **Create Test Data** (optional) — creates 10 random contacts in HubSpot via the CRM API
5. **Bulk Export** — triggers a bulk snapshot to backfill all contacts from the portal
6. **Manage Filters** — open the filter dialog from the subscriptions banner to add property-based filters (up to 5 filters with up to 10 conditions each)
7. **Clear Data** — purges the local database to start fresh

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Express + TypeScript |
| Database | PostgreSQL via Prisma |
| Message Queue | BullMQ (Redis-backed) |
| Frontend | React 18 + Material UI + Vite |
| Auth | OAuth 2.0 (authorization code + client credentials) |
| HubSpot SDK | `@hubspot/api-client` |

## Project Structure

```
├── src/
│   ├── app.ts              # Express server entry point
│   ├── auth.ts             # OAuth + client credentials token management
│   ├── clients.ts          # Prisma + HubSpot client singletons
│   ├── swagger.ts          # API documentation config
│   ├── journal/
│   │   ├── poller.ts       # Journal polling worker (1 req/sec)
│   │   ├── processor.ts    # Event processing (download + reconcile)
│   │   └── queue.ts        # BullMQ queue + worker setup
│   ├── hubspot/
│   │   ├── contacts.ts     # Test data creation via CRM API
│   │   ├── filters.ts      # Subscription filter CRUD
│   │   ├── subscriptions.ts # Subscription management
│   │   └── snapshots.ts    # Bulk snapshot API
│   ├── routes/
│   │   ├── authRoutes.ts   # OAuth install + callback
│   │   ├── contactRoutes.ts # Contact CRUD
│   │   └── journalRoutes.ts # Journal + snapshot controls
│   └── utils/
│       ├── error.ts        # Centralized error handler
│       ├── logger.ts       # Structured logger
│       ├── shutdown.ts     # Graceful shutdown
│       └── utils.ts        # Constants and helpers
├── client/
│   ├── src/
│   │   ├── App.tsx         # Root component with screen routing
│   │   ├── main.tsx        # React entry point
│   │   ├── theme.ts        # Dark theme configuration
│   │   ├── components/
│   │   │   ├── StartScreen.tsx  # Portal ID input + install
│   │   │   ├── DataView.tsx     # Live contact list + bulk export
│   │   │   └── FilterDialog.tsx # Subscription filter management UI
│   │   └── utils/
│   │       └── api.ts      # API client functions
│   ├── package.json
│   └── vite.config.ts      # Dev proxy to backend
├── prisma/
│   └── schema.prisma       # Database schema
├── .env.example
└── package.json
```

## How It Works

### Authentication

The app uses **two OAuth flows**:

1. **Authorization Code** — installs the app on a portal and obtains a token for CRM API access (creating test contacts). This token is stored and auto-refreshed.
2. **Client Credentials** — obtains an app-level token for Webhooks Journal API access (polling, subscriptions, snapshots). This is the token used for all journal operations.

> **Note:** For simplicity, OAuth tokens are stored in plaintext in the database; a production application should encrypt tokens at rest.

### Event Processing Pipeline

1. The **Journal Poller** calls `GET /webhooks-journal/journal/2027-03-beta/batch/{offset}/next/100` once per second
2. Each journal entry URL is enqueued as a BullMQ job with 3 retry attempts and exponential backoff
3. **Event Processor** workers (5 concurrent) dequeue jobs, download the S3 file, and process each event:
   - `CREATE` / `UPDATE` / `RESTORE` / `SNAPSHOT` → upsert contact in database
   - `DELETE` → remove contact from database
   - `MERGE` → delete merged contacts, upsert surviving contact
4. **Last-write-wins**: if an incoming event's `occurredAt` is older than the contact's `lastModifiedDate`, it's skipped

### Empty and Not-Found Responses

The journal API signals "nothing here" differently depending on the endpoint. Handle each case explicitly; if you port this example to `fetch` or another HTTP client, don't rely on how that client happens to treat an empty body.

| Endpoint | No entries | Offset unknown or expired |
|---|---|---|
| `GET .../earliest`, `GET .../latest`, `GET .../offset/{offset}/next` | `204 No Content`, empty body | — |
| `GET .../batch/{offset}/next/{count}` | `200` with `results: []` | `404` with `subCategory: "WebhooksJournalErrorType.JOURNAL_NOT_FOUND"` |

- When a batch has no errors, `numErrors` and `errors` are omitted from the response, so check `results` rather than `numErrors === 0`.
- Treat only a `JOURNAL_NOT_FOUND` 404 as an expired cursor. Any other 404 (for example, an HTML 404 after a beta API version is retired) is a real error and should be surfaced, not treated as an empty journal or used as a reason to reset the cursor.

### Subscription Filters

Filters narrow which events a subscription delivers to the journal. They are evaluated server-side before events are written — filtered-out events never appear in the journal.

- A subscription can have **up to 5 filters** — an event passes if **any** filter matches (**OR** across filters)
- Each filter can have **up to 10 conditions** — all conditions must match for the filter to pass (**AND** within a filter)
- Filters evaluate against `propertyChanges` in the event. If a property referenced in a condition is not present in the event (e.g., a CREATE event where only `email` was set but the filter checks `firstname`), that condition is skipped and the event passes through
- Supported operators: `EQ`, `N_EQ`, `LT`, `GT`, `LTE`, `GTE`, `IS_EMPTY`, `IS_NOT_EMPTY`
- Filters are **not retroactive** — they only apply to future events

### Recommended Sync Pattern: Bulk Snapshot + Incremental Journal

When a new portal installs your app, combine a bulk snapshot with incremental journal polling to get a complete, up-to-date view of the portal's data without gaps:

1. **Create a subscription** for the object types and actions you care about (`CREATE`, `UPDATE`, `DELETE`, `MERGE`). In this example, the app creates these subscriptions automatically after install.
2. **Trigger a bulk snapshot** by clicking "Bulk Export" in the UI (or calling `POST /webhooks-journal/snapshots/2027-03-beta/crm-bulk`). This exports every contact in the portal as `SNAPSHOT` events that flow into the journal.
3. **Poll the snapshot status** until it reaches `SUCCESS`. The UI handles this automatically, polling every second. A `404` response immediately after creation is expected — the status record is created asynchronously.
4. **Continue polling incrementally.** The journal poller is already running, so it picks up the snapshot events as they appear and then seamlessly transitions to processing live `CREATE`/`UPDATE`/`DELETE` events as they arrive — no further bulk operations needed.

This pattern ensures no events are missed: the subscription captures live changes from the moment it's created, and the bulk snapshot backfills everything that existed before. The `occurredAt`-based last-write-wins reconciliation handles any overlap between snapshot data and incremental events that occurred during the export.
