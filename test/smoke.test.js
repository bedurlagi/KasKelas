const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { currentPeriod } = require('../src/store');
const { paymentRows } = require('../src/payments');

test('Vercel entrypoint exports the Express app without starting a local listener', () => {
  const app = require('../api');
  assert.equal(typeof app, 'function');
  assert.equal(typeof app.listen, 'function');
});

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

test('weekly period starts on Monday without a timezone shift', () => {
  assert.equal(currentPeriod(new Date('2026-11-23T12:00:00.000Z')), '2026-11-23');
});

test('payment rows total installments and keep payment dates per period', () => {
  const rows = paymentRows({
    settings: { weeklyDue: 5000 },
    members: [{ id: 'student-1', studentNo: '26302120120', name: 'Aulia Salsabila' }],
    transactions: [
      { type: 'income', amount: 2000, studentId: 'student-1', period: '2026-11-23', date: '2026-11-23' },
      { type: 'income', amount: 3000, studentId: 'student-1', period: '2026-11-23', date: '2026-11-25' },
      { type: 'income', amount: 9000, studentId: 'student-1', period: '2026-11-16', date: '2026-11-18' }
    ]
  }, '2026-11-23');
  assert.equal(rows[0].paid, 5000);
  assert.equal(rows[0].arrears, 0);
  assert.equal(rows[0].paidInFull, true);
  assert.deepEqual(rows[0].paymentDates, ['2026-11-23', '2026-11-25']);
});

test('public access, admin session, and wishlist CRUD', async () => {
  const port = await availablePort();
  const dataFile = path.join(os.tmpdir(), `kas-kelas-smoke-${process.pid}-${Date.now()}.json`);
  const adminsFile = path.join(os.tmpdir(), `kas-admins-smoke-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(adminsFile, '[]\n', 'utf8');
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      KAS_DATA_FILE: dataFile,
      KAS_ADMINS_FILE: adminsFile,
      DATABASE_URL: '',
      VERCEL: '',
      NODE_ENV: 'test',
      ADMIN_USERNAME: 'bendahara',
      ADMIN_PASSWORD: 'kas12345',
      SESSION_SECRET: 'test-secret-that-is-long-enough'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverOutput = '';
  child.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  child.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Server tidak siap: ${serverOutput}`)), 30000);
      child.once('error', (error) => { clearTimeout(timeout); reject(error); });
      child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Server keluar (${code}): ${serverOutput}`)); });
      child.stdout.on('data', (chunk) => {
        if (serverOutput.includes('Kas Kelas berjalan')) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    const base = `http://127.0.0.1:${port}`;
    const home = await fetch(base);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Tabel pembayaran kas/);
    const publicResponse = await fetch(`${base}/api/public`);
    assert.equal(publicResponse.status, 200);
    const publicData = await publicResponse.json();
    assert.ok(publicData.summary);
    assert.ok(Array.isArray(publicData.wishlist));
    assert.equal(publicData.members.length, 40);
    assert.equal(publicData.members[0].studentNo, '26302120120');
    assert.equal(publicData.members[0].paidInFull, false);
    assert.equal((await fetch(`${base}/api/admin/data`)).status, 401);
    assert.equal((await fetch(`${base}/api/admin/bendaharas`)).status, 401);
    assert.equal((await fetch(`${base}/api/admin/payments.xlsx`)).status, 401);
    assert.equal((await fetch(`${base}/api/admin/payments/import`, { method: 'POST' })).status, 401);

    const loginPage = await fetch(`${base}/admin/login`);
    const loginCookie = loginPage.headers.get('set-cookie').split(';')[0];
    const loginHtml = await loginPage.text();
    const loginToken = loginHtml.match(/name="_csrf" value="([^"]+)"/)[1];
    const login = await fetch(`${base}/admin/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: loginCookie },
      body: new URLSearchParams({ _csrf: loginToken, username: 'bendahara', password: 'kas12345' })
    });
    assert.equal(login.status, 302);
    const adminCookie = login.headers.get('set-cookie').split(';')[0];
    const adminPage = await fetch(`${base}/admin`, { headers: { cookie: adminCookie } });
    assert.equal(adminPage.status, 200);
    const adminHtml = await adminPage.text();
    const csrfToken = adminHtml.match(/name="csrf-token" content="([^"]+)"/)[1];
    const headers = { 'content-type': 'application/json', 'x-csrf-token': csrfToken, cookie: adminCookie };
    const newAdminResponse = await fetch(`${base}/api/admin/bendaharas`, {
      method: 'POST', headers,
      body: JSON.stringify({ name: 'Bendahara Kedua', username: 'bendahara-dua', password: 'password-kedua-123' })
    });
    assert.equal(newAdminResponse.status, 201);
    const newAdmin = await newAdminResponse.json();
    assert.equal(newAdmin.admin.username, 'bendahara-dua');
    assert.equal(Object.hasOwn(newAdmin.admin, 'passwordHash'), false);
    assert.equal((await fetch(`${base}/api/admin/bendaharas`, { headers: { cookie: adminCookie } })).status, 200);
    const duplicateAdmin = await fetch(`${base}/api/admin/bendaharas`, {
      method: 'POST', headers,
      body: JSON.stringify({ name: 'Duplikat', username: 'BENDAHARA-DUA', password: 'password-kedua-123' })
    });
    assert.equal(duplicateAdmin.status, 409);

    const secondLoginPage = await fetch(`${base}/admin/login`);
    const secondLoginCookie = secondLoginPage.headers.get('set-cookie').split(';')[0];
    const secondLoginToken = (await secondLoginPage.text()).match(/name="_csrf" value="([^"]+)"/)[1];
    const secondLogin = await fetch(`${base}/admin/login`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: secondLoginCookie },
      body: new URLSearchParams({ _csrf: secondLoginToken, username: 'BENDAHARA-DUA', password: 'password-kedua-123' })
    });
    assert.equal(secondLogin.status, 302);

    const exportResponse = await fetch(`${base}/api/admin/payments.xlsx?period=${publicData.period}`, { headers: { cookie: adminCookie } });
    assert.equal(exportResponse.status, 200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await exportResponse.arrayBuffer()));
    const paymentSheet = workbook.getWorksheet('Pembayaran');
    assert.equal(paymentSheet.rowCount, 41);
    paymentSheet.getRow(2).getCell(6).value = 5000;
    paymentSheet.getRow(2).getCell(7).value = publicData.period;
    const editedWorkbook = Buffer.from(await workbook.xlsx.writeBuffer());
    const importWorkbook = async () => {
      const form = new FormData();
      form.append('file', new Blob([editedWorkbook], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'payments.xlsx');
      return fetch(`${base}/api/admin/payments/import`, { method: 'POST', headers: { 'x-csrf-token': csrfToken, cookie: adminCookie }, body: form });
    };
    const brokenForm = new FormData();
    brokenForm.append('file', new Blob(['bukan file excel'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'broken.xlsx');
    const brokenImport = await fetch(`${base}/api/admin/payments/import`, { method: 'POST', headers: { 'x-csrf-token': csrfToken, cookie: adminCookie }, body: brokenForm });
    assert.equal(brokenImport.status, 400);
    const imported = await importWorkbook();
    assert.equal(imported.status, 200);
    const importedData = await imported.json();
    assert.equal(importedData.members, 40);
    const afterImport = await (await fetch(`${base}/api/public?period=${publicData.period}`)).json();
    assert.equal(afterImport.members[0].paid, 5000);
    assert.deepEqual(afterImport.members[0].paymentDates, [publicData.period]);
    assert.equal((await importWorkbook()).status, 200);
    const adminData = await (await fetch(`${base}/api/admin/data`, { headers: { cookie: adminCookie } })).json();
    assert.equal(adminData.transactions.filter((item) => item.studentId === afterImport.members[0].id && item.period === publicData.period).length, 1);

    const forbiddenWithoutCsrf = await fetch(`${base}/api/admin/wishlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ name: 'Ditolak', estimatedCost: 1, status: 'Rencana' })
    });
    assert.equal(forbiddenWithoutCsrf.status, 403);

    const createdResponse = await fetch(`${base}/api/admin/wishlist`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Uji integrasi', description: 'Sementara', date: '', estimatedCost: 1000, status: 'Rencana' })
    });
    assert.equal(createdResponse.status, 201);
    const { id } = await createdResponse.json();
    const updatedResponse = await fetch(`${base}/api/admin/wishlist/${id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ name: 'Uji integrasi edit', description: 'Sementara', date: '', estimatedCost: 2000, status: 'Terealisasi' })
    });
    assert.equal(updatedResponse.status, 200);
    const deletedResponse = await fetch(`${base}/api/admin/wishlist/${id}`, { method: 'DELETE', headers });
    assert.equal(deletedResponse.status, 200);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
    fs.rmSync(dataFile, { force: true });
    fs.rmSync(`${dataFile}.tmp`, { force: true });
    fs.rmSync(adminsFile, { force: true });
    fs.rmSync(`${adminsFile}.tmp`, { force: true });
  }
});