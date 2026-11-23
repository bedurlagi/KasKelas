const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('node:crypto');
const { getPool } = require('./postgres');

const localAdminsFile = process.env.KAS_ADMINS_FILE || path.join(__dirname, '..', 'data', 'admins.json');

function readLocalAdmins() {
  fs.mkdirSync(path.dirname(localAdminsFile), { recursive: true });
  let admins = fs.existsSync(localAdminsFile) ? JSON.parse(fs.readFileSync(localAdminsFile, 'utf8')) : [];
  if (!admins.length) {
    const username = process.env.ADMIN_USERNAME || 'bendahara';
    const password = process.env.ADMIN_PASSWORD || 'kas12345';
    admins = [{
      id: 'local-admin',
      name: process.env.ADMIN_NAME || 'Bendahara Utama',
      username,
      passwordHash: bcrypt.hashSync(password, 12),
      createdBy: null,
      createdAt: new Date().toISOString()
    }];
    writeLocalAdmins(admins);
  }
  return admins;
}

function writeLocalAdmins(admins) {
  const temporary = `${localAdminsFile}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(admins, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, localAdminsFile);
}

function publicAdmin(admin) {
  return { id: admin.id, name: admin.name, username: admin.username, createdAt: admin.createdAt };
}

async function findAdmin(username) {
  const normalizedUsername = username.toLowerCase();
  const database = getPool();
  if (database) {
    const result = await database.query('SELECT id, name, username, password_hash AS "passwordHash" FROM admins WHERE lower(username) = $1', [normalizedUsername]);
    return result.rows[0] || null;
  }
  return readLocalAdmins().find((admin) => admin.username.toLowerCase() === normalizedUsername) || null;
}

async function listAdmins() {
  const database = getPool();
  if (database) {
    const result = await database.query('SELECT id, name, username, created_at AS "createdAt" FROM admins ORDER BY created_at, username');
    return result.rows;
  }
  return readLocalAdmins().map(publicAdmin).sort((left, right) => left.username.localeCompare(right.username));
}

async function createAdmin({ name, username, password, createdBy }) {
  const database = getPool();
  username = username.toLowerCase();
  const id = randomUUID();
  const passwordHash = await bcrypt.hash(password, 12);
  if (database) {
    const result = await database.query(
      'INSERT INTO admins (id, name, username, password_hash, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, username, created_at AS "createdAt"',
      [id, name, username, passwordHash, createdBy]
    );
    return result.rows[0];
  }
  const admins = readLocalAdmins();
  if (admins.some((admin) => admin.username.toLowerCase() === username.toLowerCase())) {
    const error = new Error('Username sudah digunakan.');
    error.code = '23505';
    throw error;
  }
  const admin = { id, name, username, passwordHash, createdBy, createdAt: new Date().toISOString() };
  admins.push(admin);
  writeLocalAdmins(admins);
  return publicAdmin(admin);
}

module.exports = { findAdmin, listAdmins, createAdmin };