const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('node:crypto');

let pool;
let schemaPromise;
const PgSessionStore = connectPgSimple(session);

function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
      max: 1,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000
    });
  }
  return pool;
}

async function ensureDatabase(seedData) {
  const database = getPool();
  if (!database) return null;
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await database.query(`
        CREATE TABLE IF NOT EXISTS kas_state (
          id smallint PRIMARY KEY CHECK (id = 1),
          data jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await database.query(`
        CREATE TABLE IF NOT EXISTS admins (
          id text PRIMARY KEY,
          name text NOT NULL,
          username text NOT NULL UNIQUE,
          password_hash text NOT NULL,
          created_by text,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await database.query('CREATE UNIQUE INDEX IF NOT EXISTS admins_username_lower_idx ON admins (lower(username))');
      await database.query(`
        CREATE TABLE IF NOT EXISTS user_sessions (
          sid varchar NOT NULL PRIMARY KEY,
          sess json NOT NULL,
          expire timestamp(6) NOT NULL
        )
      `);
      await database.query('CREATE INDEX IF NOT EXISTS user_sessions_expire_idx ON user_sessions (expire)');
      await database.query('INSERT INTO kas_state (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING', [JSON.stringify(seedData)]);
      const admins = await database.query('SELECT 1 FROM admins LIMIT 1');
      if (!admins.rowCount && process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
        const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
        await database.query(
          'INSERT INTO admins (id, name, username, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (username) DO NOTHING',
          [randomUUID(), process.env.ADMIN_NAME || 'Bendahara Utama', process.env.ADMIN_USERNAME.toLowerCase(), passwordHash]
        );
      }
      const count = await database.query('SELECT 1 FROM admins LIMIT 1');
      if (!count.rowCount && process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
        const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
        await database.query(
          'INSERT INTO admins (id, name, username, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (username) DO NOTHING',
          [randomUUID(), process.env.ADMIN_NAME || 'Bendahara Utama', process.env.ADMIN_USERNAME, passwordHash]
        );
      }
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
  return database;
}

function createSessionStore() {
  const database = getPool();
  return database ? new PgSessionStore({ pool: database, tableName: 'user_sessions', createTableIfMissing: false }) : undefined;
}

module.exports = { getPool, ensureDatabase, createSessionStore };