# Mongo API Server

A lightweight **Node.js / Express** REST API that sits between the Electron photobooth app and MongoDB Atlas.  
It exists because Electron has problems connecting to MongoDB directly (DNS / TLS issues inside the renderer sandbox).

---

## Architecture

```
[Electron App]  ──HTTP──►  [mongo-api-server :4000]  ──►  [MongoDB Atlas]
```

The Electron `index.js` no longer uses the `mongodb` driver directly. All database operations go through this server via `axios` HTTP calls.

---

## Quick Start

```bash
cd mongo-api-server
npm install          # first time only
npm start            # production
npm run dev          # development (auto-reload via nodemon)
```

The server starts on **http://localhost:4000** by default.

---

## Environment Variables (`.env`)

| Variable      | Description                     | Default       |
|---------------|---------------------------------|---------------|
| `MONGODB_URI` | MongoDB Atlas connection string | **required**  |
| `PORT`        | HTTP port to listen on          | `4000`        |

The Electron app reads `MONGO_API_URL` from its `.env` to know where the API server is:

```env
# whatsapp-image-uploader-electron/.env
MONGO_API_URL=http://localhost:4000   # default if not set
```

---

## API Reference

### Health

| Method | Path      | Description               |
|--------|-----------|---------------------------|
| GET    | `/health` | Returns `{ ok, dbConnected }` |

### Stats

| Method | Path     | Description                                    |
|--------|----------|------------------------------------------------|
| GET    | `/stats` | Counts of `pending/processing/completed/failed` docs |

### Users / Photos (`photobooth_users` collection)

| Method | Path                      | Body / Query              | Description                              |
|--------|---------------------------|---------------------------|------------------------------------------|
| GET    | `/users/failed`           | —                         | All docs with `status: "failed"`         |
| POST   | `/users/batch-find`       | `{ ids: string[] }`       | Fetch many docs by imageId               |
| POST   | `/users/upsert`           | `{ imageId, ...fields }`  | Upsert a doc, return updated document    |
| POST   | `/users/waiting`          | `{ ids: string[] }`       | Docs from `ids` that have a phone number |
| POST   | `/users/retry-failed`     | —                         | Reset all failed → pending               |
| POST   | `/users/sync-event`       | `{ eventPrefixes: string[] }` | Completed images for an event (used by preview app) |
| GET    | `/users/:imageId`         | —                         | Find one doc by imageId                  |
| GET    | `/users/code/:code`       | —                         | Find one doc by short guest code         |
| PATCH  | `/users/:imageId`         | `{ ...fields }`           | Update fields on an existing doc         |
| PATCH  | `/users/:imageId/link`    | `{ newImageId }`          | Re-link a short-code doc to full imageId |
| DELETE | `/users/:imageId`         | —                         | Delete a doc by imageId                  |

### Events (`event_config` collection)

| Method | Path      | Body                           | Description                  |
|--------|-----------|--------------------------------|------------------------------|
| GET    | `/events` | —                              | All unique event configs      |
| POST   | `/events` | `{ eventName, eventPrefix }`   | Upsert an event config doc    |

---

## Running as a background service (macOS)

For production/event use, keep the server running in the background:

```bash
# Using pm2 (install globally once: npm i -g pm2)
pm2 start server.js --name mongo-api
pm2 save
pm2 startup   # auto-start on boot
```

Or simply run `npm start` in a separate terminal before launching the Electron app.
