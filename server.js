'use strict';

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const { MongoClient } = require('mongodb');

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── MongoDB Connection ────────────────────────────────────────────────────────
let mongoClient;
let db;
let usersCollection;
let configCollection;
let dbConnected = false;

async function connectMongo() {
  if (dbConnected) return;
  try {
    mongoClient = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 8000,
    });
    await mongoClient.connect();
    db               = mongoClient.db();
    usersCollection  = db.collection('photobooth_users');
    configCollection = db.collection('event_config');

    // Ensure index on imageId
    await usersCollection.createIndex({ imageId: 1 }, { unique: true }).catch(() => {});

    dbConnected = true;
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    dbConnected = false;
    // Retry after 5 seconds
    setTimeout(connectMongo, 5000);
  }
}

// Middleware to guard routes that need DB
function requireDb(req, res, next) {
  if (!dbConnected || !usersCollection) {
    return res.status(503).json({ error: 'MongoDB not connected' });
  }
  next();
}

// ── Health / Status ───────────────────────────────────────────────────────────

/**
 * GET /health
 * Returns server + DB connection status.
 */
app.get('/health', (req, res) => {
  res.json({ ok: true, dbConnected });
});

// ── Users / Photos collection ─────────────────────────────────────────────────

/**
 * GET /users/failed
 * Returns all documents with status 'failed'.
 */
app.get('/users/failed', requireDb, async (req, res) => {
  try {
    const docs = await usersCollection.find({ status: 'failed' }).toArray();
    res.json({ ok: true, docs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /users/batch-find
 * Body: { ids: string[] }
 * Fetch multiple documents by imageId.
 */
app.post('/users/batch-find', requireDb, async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    const docs = ids.length
      ? await usersCollection.find({ imageId: { $in: ids } }).toArray()
      : [];
    res.json({ ok: true, docs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /users/upsert
 * Body: { imageId, ...fields }
 * Upsert a document. Fields are applied via $set; createdAt set via $setOnInsert.
 * Returns the updated document.
 */
app.post('/users/upsert', requireDb, async (req, res) => {
  try {
    const { imageId, ...fields } = req.body;
    if (!imageId) return res.status(400).json({ ok: false, error: 'imageId required' });

    const doc = await usersCollection.findOneAndUpdate(
      { imageId },
      {
        $set: fields,
        $setOnInsert: { createdAt: new Date() },
      },
      { returnDocument: 'after', upsert: true }
    );
    res.json({ ok: true, doc });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /users/waiting
 * Body: { ids: string[] }
 * Find docs by imageId list that have a phone number (for retry-waiting logic).
 */
app.post('/users/waiting', requireDb, async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!ids.length) return res.json({ ok: true, docs: [] });

    const docs = await usersCollection.find({
      imageId: { $in: ids },
      phone:   { $exists: true, $ne: null },
    }).toArray();
    res.json({ ok: true, docs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /users/retry-failed
 * Reset all 'failed' documents back to 'pending'.
 */
app.post('/users/retry-failed', requireDb, async (req, res) => {
  try {
    const failed = await usersCollection.find({ status: 'failed' }).toArray();
    await usersCollection.updateMany(
      { status: 'failed' },
      { $set: { status: 'pending', errorMsg: null } }
    );
    res.json({ ok: true, count: failed.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /users/:imageId
 * Find a single document by imageId.
 */
app.get('/users/:imageId', requireDb, async (req, res) => {
  try {
    const doc = await usersCollection.findOne({ imageId: req.params.imageId });
    res.json({ ok: true, doc });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /users/code/:code
 * Find a document by the short guest code (e.g. CMB1024).
 */
app.get('/users/code/:code', requireDb, async (req, res) => {
  try {
    const doc = await usersCollection.findOne({ imageId: req.params.code });
    res.json({ ok: true, doc });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * PATCH /users/:imageId/qr-active
 * Body: { qrActive: boolean }
 * Sets the qrActive flag — preview slideshow shows QR overlay when true.
 */
app.patch('/users/:imageId/qr-active', requireDb, async (req, res) => {
  try {
    const { imageId } = req.params;
    const { qrActive } = req.body;
    if (typeof qrActive !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'qrActive (boolean) is required' });
    }
    const updateDoc = { qrActive };
    if (qrActive) {
      updateDoc.status = 'generated';
    }
    await usersCollection.updateOne({ imageId }, { $set: updateDoc });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * PATCH /users/:imageId
 * Body: { ...fields }
 * Update specific fields on an existing document.
 */
app.patch('/users/:imageId', requireDb, async (req, res) => {
  try {
    const { imageId } = req.params;
    const fields = req.body;
    await usersCollection.updateOne({ imageId }, { $set: fields });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * PATCH /users/:imageId/link
 * Links a short-code document to a full imageId (pre-registration flow).
 * Body: { newImageId: string }
 */
app.patch('/users/:imageId/link', requireDb, async (req, res) => {
  try {
    const { imageId }    = req.params;
    const { newImageId } = req.body;
    if (!newImageId) return res.status(400).json({ ok: false, error: 'newImageId required' });

    await usersCollection.updateOne({ imageId }, { $set: { imageId: newImageId } });
    const doc = await usersCollection.findOne({ imageId: newImageId });
    res.json({ ok: true, doc });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * DELETE /users/:imageId
 * Delete a single document by imageId.
 */
app.delete('/users/:imageId', requireDb, async (req, res) => {
  try {
    await usersCollection.deleteOne({ imageId: req.params.imageId });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /users/sync-event
 * Body: { eventPrefixes: string[] }
 * Returns all completed or generated, non-hidden images whose imageId starts with one of the given prefixes.
 * Used by the photobooth preview app to fetch images for a live slideshow.
 */
app.post('/users/sync-event', requireDb, async (req, res) => {
  try {
    const eventPrefixes = Array.isArray(req.body.eventPrefixes) ? req.body.eventPrefixes : [];
    if (!eventPrefixes.length) return res.json({ ok: true, users: [] });

    const prefixConditions = eventPrefixes.map(prefix => ({
      imageId: { $regex: new RegExp(`^${prefix}`, 'i') },
    }));

    const users = await usersCollection
      .find({
        $and: [
          { $or: prefixConditions },
          {
            $or: [
              { status: { $in: ['completed', 'generated'] } },
              { qrActive: true },
            ],
          },
          { imageUrl: { $exists: true, $ne: null } },
          { hide: { $ne: true } },
        ],
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ ok: true, users });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /stats
 * Returns counts of pending, processing, completed and failed documents.
 */
app.get('/stats', requireDb, async (req, res) => {
  try {
    const [pending, processing, completed, failed] = await Promise.all([
      usersCollection.countDocuments({ status: { $in: ['pending', 'uploaded'] } }),
      usersCollection.countDocuments({ status: 'processing' }),
      usersCollection.countDocuments({ status: { $in: ['completed', 'generated'] } }),
      usersCollection.countDocuments({ status: 'failed' }),
    ]);
    res.json({ ok: true, pending, processing, completed, failed });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Event Config collection ───────────────────────────────────────────────────

/**
 * GET /events
 * Returns all unique event configurations (excluding the active_event doc).
 */
app.get('/events', requireDb, async (req, res) => {
  try {
    const events = await configCollection
      .find({ _id: { $ne: 'active_event' } })
      .sort({ updatedAt: -1 })
      .toArray();

    const seen = new Set();
    const uniqueEvents = [];
    for (const e of events) {
      if (e.eventName && e.eventPrefix) {
        const key = e.eventPrefix.toUpperCase().trim();
        if (!seen.has(key)) {
          seen.add(key);
          uniqueEvents.push({
            eventName:   e.eventName.trim(),
            eventPrefix: key,
          });
        }
      }
    }
    res.json({ ok: true, events: uniqueEvents });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /events
 * Body: { eventName, eventPrefix }
 * Upsert an event config document.
 */
app.post('/events', requireDb, async (req, res) => {
  try {
    const eventPrefix = (req.body.eventPrefix || '').toUpperCase().trim();
    const eventName   = (req.body.eventName   || '').trim();

    if (!eventPrefix || !eventName) {
      return res.status(400).json({ ok: false, error: 'eventPrefix and eventName are required' });
    }

    await configCollection.updateOne(
      { _id: eventPrefix },
      {
        $set: {
          eventName,
          eventPrefix,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Start server ──────────────────────────────────────────────────────────────

connectMongo().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Mongo API server running at http://localhost:${PORT}`);
    console.log(`   DB connected: ${dbConnected}`);
  });
});

// Graceful shutdown
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

async function shutdown() {
  console.log('\n🛑 Shutting down...');
  if (mongoClient) await mongoClient.close();
  process.exit(0);
}
