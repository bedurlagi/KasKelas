const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { getPool, ensureDatabase } = require('./postgres');

const dataFile = process.env.KAS_DATA_FILE || path.join(__dirname, '..', 'data', 'kas.json');
const dataDirectory = path.dirname(dataFile);

function currentPeriod(date = new Date()) {
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - day);
  return monday.toISOString().slice(0, 10);
}

function initialData() {
  const members = [
    { id: '26302120120', studentNo: '26302120120', name: 'AULIA SALSABILA', gender: 'P' },
    { id: '26302120121', studentNo: '26302120121', name: 'GALIH ANUGRAH PUTRA FIRDAUS', gender: 'L' },
    { id: '26302120122', studentNo: '26302120122', name: 'M. AZHAR FAUZI ISNAEN', gender: 'L' },
    { id: '26302120123', studentNo: '26302120123', name: 'MUTIARA AZEIM', gender: 'P' },
    { id: '26302120124', studentNo: '26302120124', name: 'SALWA TURAHMAH AULA', gender: 'P' },
    { id: '26302120125', studentNo: '26302120125', name: 'ARIFAH AURA PUTRI', gender: 'P' },
    { id: '26302120126', studentNo: '26302120126', name: 'ASTARI OKTARIANI', gender: 'P' },
    { id: '26302120127', studentNo: '26302120127', name: 'SILVI NUR CAHYATI', gender: 'P' },
    { id: '26302120128', studentNo: '26302120128', name: 'AFEL', gender: 'P' },
    { id: '26302120129', studentNo: '26302120129', name: 'SHEREN FEBY SHAVIRA', gender: 'P' },
    { id: '26302120130', studentNo: '26302120130', name: 'BUNGA AULYA FATIMATUL SIDQOH', gender: 'P' },
    { id: '26302120131', studentNo: '26302120131', name: 'SITI YAMROH', gender: 'P' },
    { id: '26302120132', studentNo: '26302120132', name: 'DANDA DZAKIA ALIFA', gender: 'P' },
    { id: '26302120133', studentNo: '26302120133', name: 'SUHARYADI', gender: 'L' },
    { id: '26302120134', studentNo: '26302120134', name: 'ZAKY ABDURROHMAN', gender: 'L' },
    { id: '26302120135', studentNo: '26302120135', name: 'ARA FAHEEMA SAFWA', gender: 'P' },
    { id: '26302120136', studentNo: '26302120136', name: 'DEWI LESTARI', gender: 'P' },
    { id: '26302120137', studentNo: '26302120137', name: 'WIDI INDRIYANI', gender: 'P' },
    { id: '26302120138', studentNo: '26302120138', name: 'NUGROHO ARKANANTA', gender: 'L' },
    { id: '26302120139', studentNo: '26302120139', name: 'MUSYADAD', gender: 'L' },
    { id: '26302120140', studentNo: '26302120140', name: 'MUHAMAD RAIHAN PRATAMA', gender: 'L' },
    { id: '26302120141', studentNo: '26302120141', name: 'MUHAMMAD RANDY ALBAR', gender: 'L' },
    { id: '26302120142', studentNo: '26302120142', name: 'ABDURACHMAN', gender: 'L' },
    { id: '26302120143', studentNo: '26302120143', name: 'AMELIA PUSPITA SARI', gender: 'P' },
    { id: '26302120144', studentNo: '26302120144', name: 'AHMAD MUALIM FAQIH', gender: 'L' },
    { id: '26302120145', studentNo: '26302120145', name: 'WIDIA SYIFA RAHMADHANI', gender: 'P' },
    { id: '26302120146', studentNo: '26302120146', name: 'AULIA SABILA', gender: 'P' },
    { id: '26302120147', studentNo: '26302120147', name: 'HARIS SHIDDIQ AL QODARI', gender: 'L' },
    { id: '26302120148', studentNo: '26302120148', name: 'RINALDI OKTAVIAN', gender: 'L' },
    { id: '26302120149', studentNo: '26302120149', name: 'M. FATHAN FATIH SAHILA', gender: 'L' },
    { id: '26302120150', studentNo: '26302120150', name: 'FARID FAWWAZUL FAIQ', gender: 'L' },
    { id: '26302120151', studentNo: '26302120151', name: 'MAWADDAH', gender: 'P' },
    { id: '26302120152', studentNo: '26302120152', name: 'NAZHWA DEVIA PUTRI', gender: 'P' },
    { id: '26302120153', studentNo: '26302120153', name: 'ZIAN ANASYA RAMADHANY', gender: 'P' },
    { id: '26302120154', studentNo: '26302120154', name: 'RISMA YUNITA SILPIANA', gender: 'P' },
    { id: '26302120155', studentNo: '26302120155', name: 'AIDAH GHINACAHYANI', gender: 'P' },
    { id: '26302120156', studentNo: '26302120156', name: 'MUHAMMAD NURSYAMSI MAJID', gender: 'L' },
    { id: '26302120157', studentNo: '26302120157', name: 'MUHAMMAD YAZID SYAHRUL ANAM', gender: 'L' },
    { id: '26302120158', studentNo: '26302120158', name: 'INTAN PERMATASARI', gender: 'P' },
    { id: '26302120159', studentNo: '26302120159', name: 'FITRA FIRMANSYAH', gender: 'L' }
  ];
  return {
    settings: { weeklyDue: 5000, currency: 'IDR' },
    members,
    transactions: [],
    wishlist: [
      {
        id: randomUUID(),
        name: 'Piknik akhir semester',
        description: 'Makan bersama dan permainan di taman kota.',
        date: '',
        estimatedCost: 150000,
        status: 'Rencana',
        createdAt: new Date().toISOString()
      }
    ]
  };
}

function ensureStore() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  if (!fs.existsSync(dataFile)) writeData(initialData());
}

async function initializeStorage() {
  if (!getPool()) return null;
  return ensureDatabase(initialData());
}

async function readData() {
  const database = getPool();
  if (database) {
    await initializeStorage();
    const result = await database.query('SELECT data FROM kas_state WHERE id = 1');
    return result.rows[0].data;
  }
  ensureStore();
  return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
}

async function writeData(data) {
  const database = getPool();
  if (database) {
    await initializeStorage();
    await database.query('UPDATE kas_state SET data = $1::jsonb, updated_at = now() WHERE id = 1', [JSON.stringify(data)]);
    return;
  }
  fs.mkdirSync(dataDirectory, { recursive: true });
  const temporaryFile = `${dataFile}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryFile, dataFile);
}

module.exports = { readData, writeData, currentPeriod, initializeStorage };