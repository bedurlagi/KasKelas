require('dotenv').config();

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const multer = require('multer');
const { randomBytes, randomUUID } = require('node:crypto');
const path = require('node:path');
const { readData, writeData, currentPeriod, initializeStorage } = require('./src/store');
const { paymentRows } = require('./src/payments');
const { getPool, createSessionStore } = require('./src/postgres');
const { findAdmin, listAdmins, createAdmin } = require('./src/admins');

const app = express();
const port = Number(process.env.PORT) || 3000;
const database = getPool();
const uploadWorkbook = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => callback(null, path.extname(file.originalname).toLowerCase() === '.xlsx')
});

if (process.env.NODE_ENV === 'production' && (!process.env.SESSION_SECRET || !process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD)) {
  throw new Error('SESSION_SECRET, ADMIN_USERNAME, dan ADMIN_PASSWORD wajib diatur di production.');
}
if (process.env.VERCEL && !database) {
  throw new Error('DATABASE_URL Neon PostgreSQL wajib diatur di Vercel.');
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use((req, res, next) => {
  const originalPath = req.query.__vercel_path;
  if (!process.env.VERCEL || typeof originalPath !== 'string') return next();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (key === '__vercel_path') continue;
    for (const entry of Array.isArray(value) ? value : [value]) query.append(key, entry);
  }
  const search = query.toString();
  req.url = `${originalPath}${search ? `?${search}` : ''}`;
  next();
});
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use((req, res, next) => initializeStorage().then(() => next(), next));
app.use(session({
  name: 'kas.sid',
  secret: process.env.SESSION_SECRET || 'local-only-change-this-session-secret',
  ...(database ? { store: createSessionStore() } : {}),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

function getCsrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(24).toString('hex');
  return req.session.csrfToken;
}

function csrfProtection(req, res, next) {
  const token = req.get('x-csrf-token') || req.body?._csrf;
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).json({ error: 'Sesi formulir tidak valid. Muat ulang halaman.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Silakan masuk sebagai bendahara.' });
  next();
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function cleanText(value, maxLength = 180) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function positiveAmount(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function requestedPeriod(value) {
  if (!validDate(value)) return currentPeriod();
  return currentPeriod(new Date(`${value}T00:00:00Z`));
}

async function publicData(period = currentPeriod()) {
  const data = await readData();
  const income = data.transactions.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amount, 0);
  const expense = data.transactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0);
  return {
    summary: { balance: income - expense, income, expense },
    settings: data.settings,
    period,
    members: paymentRows(data, period),
    transactions: data.transactions.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    wishlist: data.wishlist.slice().sort((a, b) => a.name.localeCompare(b.name))
  };
}

async function persistAndRespond(res, data, status = 200, response = { ok: true }) {
  await writeData(data);
  return res.status(status).json(response);
}

app.get('/', (req, res) => res.render('index', { csrfToken: getCsrfToken(req) }));
app.get('/admin/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin');
  res.render('login', { csrfToken: getCsrfToken(req), error: '' });
});
app.get('/admin', (req, res) => {
  if (!req.session.isAdmin) return res.redirect('/admin/login');
  res.render('admin', { csrfToken: getCsrfToken(req) });
});

app.post('/admin/login', csrfProtection, asyncHandler(async (req, res, next) => {
  const username = cleanText(req.body.username, 80);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const admin = await findAdmin(username);
  const valid = Boolean(admin && await bcrypt.compare(password, admin.passwordHash));
  if (!valid) return res.status(401).render('login', { csrfToken: getCsrfToken(req), error: 'Username atau password tidak sesuai.' });
  req.session.regenerate((error) => {
    if (error) return next(error);
    req.session.isAdmin = true;
    req.session.adminId = admin.id;
    req.session.adminName = admin.name;
    req.session.adminUsername = admin.username;
    getCsrfToken(req);
    res.redirect('/admin');
  });
}));

app.post('/admin/logout', csrfProtection, (req, res, next) => {
  req.session.destroy((error) => error ? next(error) : res.redirect('/'));
});

app.get('/api/public', asyncHandler(async (req, res) => res.json(await publicData(requestedPeriod(req.query.period)))));
app.get('/api/session', (req, res) => res.json({ isAdmin: Boolean(req.session.isAdmin), adminName: req.session.adminName || null }));
app.get('/api/admin/data', requireAdmin, asyncHandler(async (req, res) => res.json(await readData())));
app.get('/api/admin/bendaharas', requireAdmin, asyncHandler(async (req, res) => res.json({ admins: await listAdmins() })));
app.post('/api/admin/bendaharas', requireAdmin, csrfProtection, asyncHandler(async (req, res) => {
  const name = cleanText(req.body.name, 80);
  const username = cleanText(req.body.username, 40).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!name || !/^[a-zA-Z0-9._-]{3,40}$/.test(username) || password.length < 10 || password.length > 200) {
    return res.status(400).json({ error: 'Isi nama, username 3-40 karakter (huruf/angka/._-), dan password 10-200 karakter.' });
  }
  try {
    const admin = await createAdmin({ name, username, password, createdBy: req.session.adminId });
    res.status(201).json({ ok: true, admin });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Username sudah digunakan.' });
    throw error;
  }
}));
app.get('/api/admin/payments.xlsx', requireAdmin, async (req, res, next) => {
  try {
    const data = await readData();
    const period = requestedPeriod(req.query.period);
    const payments = paymentRows(data, period);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Kas Kelas';
    const sheet = workbook.addWorksheet('Pembayaran');
    sheet.columns = [
      { header: 'NIM', key: 'studentNo', width: 18 },
      { header: 'Nama', key: 'name', width: 32 },
      { header: 'Gender', key: 'gender', width: 10 },
      { header: 'Periode', key: 'period', width: 15 },
      { header: 'Iuran Wajib', key: 'due', width: 15 },
      { header: 'Nominal Bayar', key: 'paid', width: 17 },
      { header: 'Tanggal Bayar', key: 'date', width: 24 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Tunggakan', key: 'arrears', width: 15 }
    ];
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF245C45' } };
    for (const payment of payments) {
      const dates = payment.paymentDates.length ? payment.paymentDates.join(', ') : '';
      const paymentTransactions = data.transactions.filter((transaction) =>
        transaction.type === 'income' && transaction.studentId === payment.id && transaction.period === period
      );
      if (paymentTransactions.length) {
        for (const transaction of paymentTransactions) {
          sheet.addRow({
            studentNo: payment.studentNo || '', name: payment.name, gender: payment.gender || '', period,
            due: payment.due, paid: transaction.amount, date: transaction.date,
            status: payment.paidInFull ? 'Lunas' : 'Belum lunas', arrears: payment.arrears
          });
        }
      } else {
        sheet.addRow({ studentNo: payment.studentNo || '', name: payment.name, gender: payment.gender || '', period, due: payment.due, paid: 0, date: '', status: 'Belum bayar', arrears: payment.arrears });
      }
      if (dates && paymentTransactions.length === 0) sheet.getRow(sheet.rowCount).getCell(7).value = dates;
    }
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: 'I1' };
    const buffer = await workbook.xlsx.writeBuffer();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="kas-pembayaran-${period}.xlsx"`
    });
    res.send(Buffer.from(buffer));
  } catch (error) { next(error); }
});

app.post('/api/admin/payments/import', requireAdmin, (req, res, next) => {
  uploadWorkbook.single('file')(req, res, (error) => {
    if (error) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Ukuran file maksimal 2 MB.' : 'Unggah file .xlsx yang valid.' });
    csrfProtection(req, res, async () => {
      if (!req.file) return res.status(400).json({ error: 'Pilih file .xlsx terlebih dahulu.' });
      try {
        const workbook = new ExcelJS.Workbook();
        try {
          await workbook.xlsx.load(req.file.buffer);
        } catch {
          return res.status(400).json({ error: 'File Excel tidak dapat dibaca. Gunakan template .xlsx dari aplikasi.' });
        }
        const sheet = workbook.getWorksheet('Pembayaran');
        if (!sheet || sheet.rowCount < 2 || sheet.rowCount > 5001) {
          return res.status(400).json({ error: 'Sheet Pembayaran tidak ditemukan atau jumlah baris tidak valid.' });
        }
        const headers = new Map();
        sheet.getRow(1).eachCell((cell, column) => headers.set(String(cell.text).trim().toLocaleLowerCase('id'), column));
        const required = ['nim', 'nama', 'periode', 'nominal bayar', 'tanggal bayar'];
        if (required.some((header) => !headers.has(header))) {
          return res.status(400).json({ error: 'Kolom wajib: NIM, Nama, Periode, Nominal Bayar, dan Tanggal Bayar.' });
        }
        const readCell = (row, header) => row.getCell(headers.get(header)).value;
        const data = await readData();
        const memberByNumber = new Map(data.members.filter((member) => member.studentNo).map((member) => [String(member.studentNo), member]));
        const imported = new Map();
        let period = null;
        for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
          const row = sheet.getRow(rowNumber);
          const number = String(readCell(row, 'nim') ?? '').trim();
          if (!number) continue;
          const member = memberByNumber.get(number);
          if (!member) return res.status(400).json({ error: `NIM ${number} tidak terdaftar di kelas.` });
          const name = String(readCell(row, 'nama') ?? '').trim();
          if (name && name !== member.name) return res.status(400).json({ error: `Nama untuk NIM ${number} tidak cocok dengan daftar anggota.` });
          const rowPeriodValue = readCell(row, 'periode');
          const rowPeriod = rowPeriodValue instanceof Date ? rowPeriodValue.toISOString().slice(0, 10) : String(rowPeriodValue ?? '').trim();
          if (!validDate(rowPeriod)) return res.status(400).json({ error: `Periode pada baris ${rowNumber} tidak valid.` });
          if (currentPeriod(new Date(`${rowPeriod}T00:00:00Z`)) !== rowPeriod) return res.status(400).json({ error: `Periode pada baris ${rowNumber} harus dimulai hari Senin.` });
          if (period && period !== rowPeriod) return res.status(400).json({ error: 'Satu file hanya boleh memuat satu periode pembayaran.' });
          period = rowPeriod;
          const amountValue = readCell(row, 'nominal bayar');
          const amount = typeof amountValue === 'number' ? amountValue : Number(String(amountValue ?? '').replace(/[^\d.-]/g, ''));
          if (!Number.isSafeInteger(amount) || amount < 0) return res.status(400).json({ error: `Nominal pada baris ${rowNumber} harus angka nol atau lebih.` });
          const dateValue = readCell(row, 'tanggal bayar');
          let date = '';
          if (dateValue instanceof Date) date = dateValue.toISOString().slice(0, 10);
          else if (typeof dateValue === 'string') date = dateValue.trim();
          if (amount > 0 && !validDate(date)) return res.status(400).json({ error: `Tanggal bayar pada baris ${rowNumber} wajib berupa tanggal valid.` });
          if (amount === 0 && date) return res.status(400).json({ error: `Baris tanpa pembayaran (NIM ${number}) harus mengosongkan Tanggal Bayar.` });
          if (!imported.has(member.id)) imported.set(member.id, []);
          imported.get(member.id).push({ amount, date });
        }
        const missing = data.members.filter((member) => !imported.has(member.id));
        if (missing.length) return res.status(400).json({ error: `Impor harus mencakup semua anggota. Belum ada baris untuk ${missing.slice(0, 3).map((member) => member.name).join(', ')}${missing.length > 3 ? ', dan lainnya' : ''}.` });
        for (const [memberId, rows] of imported) {
          if (rows.length > 1 && rows.some((row) => row.amount === 0)) {
            return res.status(400).json({ error: 'Baris tanpa pembayaran tidak boleh digabung dengan baris pembayaran untuk NIM yang sama.' });
          }
        }
        const memberIds = new Set(data.members.map((member) => member.id));
        data.transactions = data.transactions.filter((transaction) =>
          !(transaction.type === 'income' && memberIds.has(transaction.studentId) && transaction.period === period)
        );
        for (const [memberId, rows] of imported) {
          const member = data.members.find((entry) => entry.id === memberId);
          for (const row of rows.filter((entry) => entry.amount > 0)) {
            data.transactions.push({
              id: randomUUID(), type: 'income', amount: row.amount, date: row.date,
              note: `Kas mingguan - ${member.name} (impor Excel)`, studentId: member.id,
              period, createdAt: new Date().toISOString()
            });
          }
        }
        await writeData(data);
        res.json({ ok: true, period, members: imported.size, payments: [...imported.values()].flat().filter((row) => row.amount > 0).length });
      } catch (importError) { next(importError); }
    });
  });
});

app.post('/api/admin/transactions', requireAdmin, csrfProtection, asyncHandler(async (req, res) => {
  const { type } = req.body;
  const amount = positiveAmount(req.body.amount);
  const date = cleanText(req.body.date, 10);
  const note = cleanText(req.body.note);
  const studentId = cleanText(req.body.studentId, 80) || null;
  const period = cleanText(req.body.period, 10) || null;
  if (!['income', 'expense'].includes(type) || !amount || !validDate(date) || !note) {
    return res.status(400).json({ error: 'Lengkapi tipe, nominal positif, tanggal, dan keterangan.' });
  }
  const data = await readData();
  if (studentId && (!data.members.some((member) => member.id === studentId) || type !== 'income')) {
    return res.status(400).json({ error: 'Anggota pembayaran tidak valid.' });
  }
  if (studentId && (!period || !validDate(period))) return res.status(400).json({ error: 'Pilih periode pembayaran yang valid.' });
  const transaction = { id: randomUUID(), type, amount, date, note, studentId, period: studentId ? period : null, createdAt: new Date().toISOString() };
  data.transactions.push(transaction);
  await persistAndRespond(res, data, 201, { ok: true, id: transaction.id });
}));

app.put('/api/admin/transactions/:id', requireAdmin, csrfProtection, asyncHandler(async (req, res) => {
  const data = await readData();
  const transaction = data.transactions.find((item) => item.id === req.params.id);
  if (!transaction) return res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
  const type = req.body.type;
  const amount = positiveAmount(req.body.amount);
  const date = cleanText(req.body.date, 10);
  const note = cleanText(req.body.note);
  const studentId = cleanText(req.body.studentId, 80) || null;
  const period = cleanText(req.body.period, 10) || null;
  if (!['income', 'expense'].includes(type) || !amount || !validDate(date) || !note) {
    return res.status(400).json({ error: 'Data transaksi tidak valid.' });
  }
  if (studentId && (!data.members.some((member) => member.id === studentId) || type !== 'income' || !validDate(period))) {
    return res.status(400).json({ error: 'Anggota atau periode pembayaran tidak valid.' });
  }
  Object.assign(transaction, { type, amount, date, note, studentId, period: studentId ? period : null });
  await persistAndRespond(res, data);
}));

app.delete('/api/admin/transactions/:id', requireAdmin, csrfProtection, asyncHandler(async (req, res) => {
  const data = await readData();
  const index = data.transactions.findIndex((item) => item.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
  data.transactions.splice(index, 1);
  await persistAndRespond(res, data);
}));

app.post('/api/admin/members', requireAdmin, csrfProtection, asyncHandler(async (req, res) => {
  const name = cleanText(req.body.name, 80);
  const studentNo = cleanText(req.body.studentNo, 40);
  const gender = cleanText(req.body.gender, 1);
  if (!name) return res.status(400).json({ error: 'Nama anggota wajib diisi.' });
  if (gender && !['P', 'L'].includes(gender)) return res.status(400).json({ error: 'Gender harus P atau L.' });
  const data = await readData();
  if (data.members.some((member) => member.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    return res.status(400).json({ error: 'Nama anggota sudah terdaftar.' });
  }
  if (studentNo && data.members.some((member) => member.studentNo === studentNo)) return res.status(400).json({ error: 'NIM sudah terdaftar.' });
  const member = { id: randomUUID(), name, studentNo, gender };
  data.members.push(member);
  await persistAndRespond(res, data, 201, { ok: true, id: member.id });
}));

app.put('/api/admin/members/:id', requireAdmin, csrfProtection, asyncHandler(async (req, res) => {
  const data = await readData();
  const member = data.members.find((item) => item.id === req.params.id);
  const name = cleanText(req.body.name, 80);
  const studentNo = cleanText(req.body.studentNo, 40);
  const gender = cleanText(req.body.gender, 1);
  if (!member) return res.status(404).json({ error: 'Anggota tidak ditemukan.' });
  if (!name) return res.status(400).json({ error: 'Nama anggota wajib diisi.' });
  if (gender && !['P', 'L'].includes(gender)) return res.status(400).json({ error: 'Gender harus P atau L.' });
  if (data.members.some((item) => item.id !== member.id && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    return res.status(400).json({ error: 'Nama anggota sudah terdaftar.' });
  }
  if (studentNo && data.members.some((item) => item.id !== member.id && item.studentNo === studentNo)) return res.status(400).json({ error: 'NIM sudah terdaftar.' });
  Object.assign(member, { name, studentNo, gender });
  await persistAndRespond(res, data);
}));

app.delete('/api/admin/members/:id', requireAdmin, csrfProtection, asyncHandler(async (req, res) => {
  const data = await readData();
  if (!data.members.some((item) => item.id === req.params.id)) return res.status(404).json({ error: 'Anggota tidak ditemukan.' });
  data.members = data.members.filter((item) => item.id !== req.params.id);
  data.transactions.forEach((item) => { if (item.studentId === req.params.id) item.studentId = null; });
  await persistAndRespond(res, data);
}));

app.patch('/api/admin/settings', requireAdmin, csrfProtection, asyncHandler(async (req, res) => {
  const weeklyDue = Number(req.body.weeklyDue);
  if (!Number.isSafeInteger(weeklyDue) || weeklyDue < 0) return res.status(400).json({ error: 'Nominal kas harus berupa angka nol atau lebih.' });
  const data = await readData();
  data.settings.weeklyDue = weeklyDue;
  await persistAndRespond(res, data);
}));

app.post('/api/admin/wishlist', requireAdmin, csrfProtection, asyncHandler(async (req, res) => {
  const name = cleanText(req.body.name, 100);
  const description = cleanText(req.body.description, 240);
  const date = cleanText(req.body.date, 40);
  const estimatedCost = positiveAmount(req.body.estimatedCost);
  const status = cleanText(req.body.status, 20);
  if (!name || !estimatedCost || !['Rencana', 'Terealisasi', 'Dibatalkan'].includes(status)) {
    return res.status(400).json({ error: 'Nama acara, estimasi positif, dan status wajib valid.' });
  }
  const data = await readData();
  const item = { id: randomUUID(), name, description, date, estimatedCost, status, createdAt: new Date().toISOString() };
  data.wishlist.push(item);
  await persistAndRespond(res, data, 201, { ok: true, id: item.id });
}));

app.put('/api/admin/wishlist/:id', requireAdmin, csrfProtection, asyncHandler(async (req, res) => {
  const data = await readData();
  const item = data.wishlist.find((entry) => entry.id === req.params.id);
  const name = cleanText(req.body.name, 100);
  const estimatedCost = positiveAmount(req.body.estimatedCost);
  const status = cleanText(req.body.status, 20);
  if (!item) return res.status(404).json({ error: 'Wishlist tidak ditemukan.' });
  if (!name || !estimatedCost || !['Rencana', 'Terealisasi', 'Dibatalkan'].includes(status)) {
    return res.status(400).json({ error: 'Data wishlist tidak valid.' });
  }
  Object.assign(item, { name, description: cleanText(req.body.description, 240), date: cleanText(req.body.date, 40), estimatedCost, status });
  await persistAndRespond(res, data);
}));

app.delete('/api/admin/wishlist/:id', requireAdmin, csrfProtection, asyncHandler(async (req, res) => {
  const data = await readData();
  const originalLength = data.wishlist.length;
  data.wishlist = data.wishlist.filter((item) => item.id !== req.params.id);
  if (data.wishlist.length === originalLength) return res.status(404).json({ error: 'Wishlist tidak ditemukan.' });
  await persistAndRespond(res, data);
}));

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
});

if (require.main === module) app.listen(port, () => console.log(`Kas Kelas berjalan di http://localhost:${port}`));

module.exports = app;