const csrfToken = document.querySelector('meta[name="csrf-token"]').content;
const currency = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const adminState = { data: null, admins: [] };
const safe = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const formatMoney = (value) => currency.format(value || 0).replace(/\u00a0/g, ' ');
const formatDate = (date) => date ? new Date(`${date}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const today = new Date().toISOString().slice(0, 10);

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken, ...(options.headers || {}) }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Perubahan tidak berhasil.');
  return result;
}

function message(text, isError = false) {
  const element = document.querySelector('#admin-message');
  element.textContent = text;
  element.classList.toggle('error-message', isError);
  element.classList.add('visible');
  window.clearTimeout(message.timeout);
  message.timeout = window.setTimeout(() => element.classList.remove('visible'), 4000);
}

function calculateTotals() {
  return adminState.data.transactions.reduce((totals, transaction) => {
    totals[transaction.type] += transaction.amount;
    return totals;
  }, { income: 0, expense: 0 });
}

function render() {
  const { transactions, members, wishlist, settings } = adminState.data;
  const totals = calculateTotals();
  const balance = totals.income - totals.expense;
  document.querySelector('#admin-summary').innerHTML = `<article><span>Saldo saat ini</span><strong>${formatMoney(balance)}</strong></article><article><span>Total pemasukan</span><strong>${formatMoney(totals.income)}</strong></article><article><span>Total pengeluaran</span><strong>${formatMoney(totals.expense)}</strong></article>`;
  document.querySelector('#today-label').textContent = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  document.querySelector('#transaction-total').textContent = `${transactions.length} catatan`;
  document.querySelector('#member-total').textContent = `${members.length} orang`;
  document.querySelector('#wishlist-total').textContent = `${wishlist.length} rencana`;
  renderAdminPayments();
  const studentSelect = document.querySelector('#transaction-student');
  const selectedStudent = studentSelect.value;
  studentSelect.innerHTML = '<option value="">Bukan pembayaran anggota</option>' + members.map((member) => `<option value="${safe(member.id)}">${safe(member.name)}</option>`).join('');
  if (members.some((member) => member.id === selectedStudent)) studentSelect.value = selectedStudent;
  document.querySelector('#admin-transactions').innerHTML = transactions.slice().sort((a, b) => b.date.localeCompare(a.date)).map((item) => `<article class="admin-record"><div class="record-symbol ${item.type === 'income' ? 'record-positive' : 'record-negative'}">${item.type === 'income' ? '+' : '−'}</div><div class="record-copy"><strong>${safe(item.note)}</strong><span>${safe(item.date)} · ${item.type === 'income' ? 'Pemasukan' : 'Pengeluaran'}</span></div><strong class="record-amount">${formatMoney(item.amount)}</strong><div class="record-actions"><button type="button" class="icon-button" title="Edit transaksi" aria-label="Edit transaksi" data-edit-transaction="${safe(item.id)}">✎</button><button type="button" class="icon-button danger-action" title="Hapus transaksi" aria-label="Hapus transaksi" data-delete-transaction="${safe(item.id)}">×</button></div></article>`).join('') || '<p class="empty-state">Belum ada transaksi tercatat.</p>';
  document.querySelector('#admin-members').innerHTML = members.map((member) => `<article class="admin-record"><div class="avatar">${safe(member.name.charAt(0).toUpperCase())}</div><div class="record-copy"><strong>${safe(member.name)}</strong><span>${member.studentNo ? `NIM ${safe(member.studentNo)}` : 'NIM belum diisi'}${member.gender ? ` · ${safe(member.gender)}` : ''}</span></div><div class="record-actions"><button type="button" class="icon-button" title="Edit anggota" aria-label="Edit anggota" data-edit-member="${safe(member.id)}">✎</button><button type="button" class="icon-button danger-action" title="Hapus anggota" aria-label="Hapus anggota" data-delete-member="${safe(member.id)}">×</button></div></article>`).join('') || '<p class="empty-state">Belum ada anggota. Tambahkan anggota pertama.</p>';
  document.querySelector('#admin-wishlist').innerHTML = wishlist.map((item) => `<article class="admin-record wishlist-record"><div class="wish-mark">✳</div><div class="record-copy"><strong>${safe(item.name)}</strong><span>${safe(item.status)} · ${formatMoney(item.estimatedCost)}</span></div><div class="record-actions"><button type="button" class="icon-button" title="Edit wishlist" aria-label="Edit wishlist" data-edit-wishlist="${safe(item.id)}">✎</button><button type="button" class="icon-button danger-action" title="Hapus wishlist" aria-label="Hapus wishlist" data-delete-wishlist="${safe(item.id)}">×</button></div></article>`).join('') || '<p class="empty-state">Belum ada rencana acara.</p>';
  document.querySelector('#settings-form [name="weeklyDue"]').value = settings.weeklyDue;
}

function renderAdminAccounts() {
  document.querySelector('#admin-account-total').textContent = `${adminState.admins.length} akun`;
  document.querySelector('#admin-accounts').innerHTML = adminState.admins.map((admin) => `<article class="admin-record"><div class="avatar">${safe(admin.name.charAt(0).toUpperCase())}</div><div class="record-copy"><strong>${safe(admin.name)}</strong><span>@${safe(admin.username)} · Dibuat ${formatDate(new Date(admin.createdAt).toISOString().slice(0, 10))}</span></div></article>`).join('') || '<p class="empty-state">Belum ada akun bendahara.</p>';
}

function renderAdminPayments() {
  const { members, transactions, settings } = adminState.data;
  const period = document.querySelector('#admin-period').value || mondayOf(today);
  document.querySelector('#payment-export').href = `/api/admin/payments.xlsx?period=${encodeURIComponent(period)}`;
  const rows = members.map((member) => {
    const payments = transactions.filter((item) => item.type === 'income' && item.studentId === member.id && item.period === period);
    const paid = payments.reduce((total, item) => total + item.amount, 0);
    const arrears = Math.max(settings.weeklyDue - paid, 0);
    const paidInFull = paid >= settings.weeklyDue;
    const dates = [...new Set(payments.map((item) => item.date))].sort().map(formatDate).join('<br>') || '—';
    const status = paidInFull ? '<span class="payment-state state-paid"><b aria-hidden="true">✓</b> Lunas</span>' : '<span class="payment-state state-unpaid"><b aria-hidden="true">×</b> Belum lunas</span>';
    return `<tr><td data-label="Anggota"><div class="payment-member"><strong>${safe(member.name)}</strong><span>${member.studentNo ? `NIM ${safe(member.studentNo)}` : 'NIM belum diisi'}${member.gender ? ` · ${safe(member.gender)}` : ''}</span></div></td><td data-label="Status">${status}</td><td data-label="Dibayar"><span>${formatMoney(paid)}<small> / ${formatMoney(settings.weeklyDue)}</small></span></td><td data-label="Tanggal bayar"><span class="payment-dates">${dates}</span></td><td data-label="Tunggakan"><strong class="${arrears ? 'arrears-value' : 'no-arrears'}">${formatMoney(arrears)}</strong></td><td data-label="Aksi"><button class="button table-action" type="button" data-record-payment="${safe(member.id)}">${paidInFull ? 'Catat tambahan' : 'Catat bayar'}</button></td></tr>`;
  });
  document.querySelector('#admin-payments').innerHTML = rows.join('') || '<tr><td colspan="6" class="empty-state">Belum ada anggota.</td></tr>';
  document.querySelector('#admin-payment-description').textContent = `${formatDate(period)} · Iuran wajib ${formatMoney(settings.weeklyDue)} per anggota.`;
}

async function refresh() {
  const [data, accountData] = await Promise.all([api('/api/admin/data'), api('/api/admin/bendaharas')]);
  adminState.data = data;
  adminState.admins = accountData.admins;
  render();
  renderAdminAccounts();
}

function resetForm(form, title, buttonText) {
  form.reset();
  form.elements.id.value = '';
  const cancel = form.querySelector('[data-cancel]');
  if (cancel) cancel.classList.add('hidden-field');
  document.querySelector(title).textContent = title.includes('transaction') ? 'Transaksi baru' : title.includes('member') ? 'Tambah anggota' : 'Tambah wishlist';
  document.querySelector(buttonText).innerHTML = title.includes('transaction') ? 'Simpan transaksi <span>→</span>' : title.includes('member') ? 'Tambah anggota <span>→</span>' : 'Simpan wishlist <span>→</span>';
  if (form === document.querySelector('#transaction-form')) {
    form.elements.date.value = today;
    form.elements.period.value = mondayOf(today);
    syncTransactionFields();
  }
}

function mondayOf(date) {
  const monday = new Date(`${date}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

function syncTransactionFields() {
  const form = document.querySelector('#transaction-form');
  const isIncome = form.elements.type.value === 'income';
  const studentSelect = document.querySelector('#transaction-student');
  studentSelect.disabled = !isIncome;
  document.querySelector('#student-field').classList.toggle('hidden-field', !isIncome);
  if (!isIncome) studentSelect.value = '';
  document.querySelector('#period-field').classList.toggle('hidden-field', !isIncome || !studentSelect.value);
}

document.querySelectorAll('.admin-tab').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.admin-tab').forEach((tab) => tab.classList.toggle('active', tab === button));
  document.querySelectorAll('.admin-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.adminPanel === button.dataset.tab));
}));

document.querySelector('#transaction-form').elements.type.addEventListener('change', syncTransactionFields);
document.querySelector('#transaction-student').addEventListener('change', syncTransactionFields);
document.querySelector('#admin-period').addEventListener('change', renderAdminPayments);

document.querySelector('#payment-import-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = document.querySelector('#payment-file').files[0];
  if (!file) return message('Pilih file .xlsx terlebih dahulu.', true);
  if (!window.confirm('Impor akan mengganti catatan pembayaran anggota untuk periode di file Excel. Lanjutkan?')) return;
  const formData = new FormData();
  formData.append('file', file);
  try {
    const response = await fetch('/api/admin/payments/import', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: formData });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Impor Excel gagal.');
    document.querySelector('#admin-period').value = result.period;
    document.querySelector('#payment-import-form').reset();
    await refresh();
    message(`Impor selesai: ${result.members} anggota, ${result.payments} pembayaran.`);
  } catch (error) { message(error.message, true); }
});

document.querySelector('#transaction-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const id = values.id;
  delete values.id;
  try {
    await api(id ? `/api/admin/transactions/${id}` : '/api/admin/transactions', { method: id ? 'PUT' : 'POST', body: JSON.stringify(values) });
    resetForm(form, '#transaction-form-title', '#transaction-submit');
    await refresh();
    message(id ? 'Transaksi diperbarui.' : 'Transaksi ditambahkan.');
  } catch (error) { message(error.message, true); }
});

document.querySelector('#member-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const id = values.id;
  delete values.id;
  try {
    await api(id ? `/api/admin/members/${id}` : '/api/admin/members', { method: id ? 'PUT' : 'POST', body: JSON.stringify(values) });
    resetForm(form, '#member-form-title', '#member-submit');
    await refresh();
    message(id ? 'Nama anggota diperbarui.' : 'Anggota ditambahkan.');
  } catch (error) { message(error.message, true); }
});

document.querySelector('#wishlist-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const id = values.id;
  delete values.id;
  try {
    await api(id ? `/api/admin/wishlist/${id}` : '/api/admin/wishlist', { method: id ? 'PUT' : 'POST', body: JSON.stringify(values) });
    resetForm(form, '#wishlist-form-title', '#wishlist-submit');
    await refresh();
    message(id ? 'Wishlist diperbarui.' : 'Wishlist ditambahkan.');
  } catch (error) { message(error.message, true); }
});

document.querySelector('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const weeklyDue = event.currentTarget.elements.weeklyDue.value;
  try {
    await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ weeklyDue }) });
    await refresh();
    message('Pengaturan iuran disimpan.');
  } catch (error) { message(error.message, true); }
});

document.querySelector('#admin-account-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  try {
    await api('/api/admin/bendaharas', { method: 'POST', body: JSON.stringify(values) });
    form.reset();
    await refresh();
    message('Akun bendahara dibuat. Sampaikan username dan password langsung kepada pemilik akun.');
  } catch (error) { message(error.message, true); }
});

document.addEventListener('click', async (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.cancel) {
    const formName = target.dataset.cancel;
    const selectors = { transaction: ['#transaction-form', '#transaction-form-title', '#transaction-submit'], member: ['#member-form', '#member-form-title', '#member-submit'], wishlist: ['#wishlist-form', '#wishlist-form-title', '#wishlist-submit'] };
    resetForm(...selectors[formName].map((selector, index) => index ? selector : document.querySelector(selector)));
    return;
  }
  if (target.dataset.recordPayment) {
    const member = adminState.data.members.find((item) => item.id === target.dataset.recordPayment);
    if (!member) return;
    const period = document.querySelector('#admin-period').value || mondayOf(today);
    const paid = adminState.data.transactions
      .filter((item) => item.type === 'income' && item.studentId === member.id && item.period === period)
      .reduce((total, item) => total + item.amount, 0);
    const form = document.querySelector('#transaction-form');
    form.elements.id.value = '';
    form.elements.type.value = 'income';
    form.elements.amount.value = Math.max(adminState.data.settings.weeklyDue - paid, 0) || adminState.data.settings.weeklyDue;
    form.elements.date.value = today;
    form.elements.studentId.value = member.id;
    form.elements.period.value = period;
    form.elements.note.value = `Kas mingguan - ${member.name}`;
    document.querySelector('#transaction-form-title').textContent = 'Catat pembayaran anggota';
    document.querySelector('#transaction-submit').innerHTML = 'Simpan pembayaran <span>→</span>';
    document.querySelector('[data-cancel="transaction"]').classList.remove('hidden-field');
    syncTransactionFields();
    document.querySelector('[data-tab="transactions"]').click();
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const transaction = adminState.data.transactions.find((item) => item.id === target.dataset.editTransaction);
  const member = adminState.data.members.find((item) => item.id === target.dataset.editMember);
  const wishlist = adminState.data.wishlist.find((item) => item.id === target.dataset.editWishlist);
  if (transaction) {
    const form = document.querySelector('#transaction-form');
    Object.entries(transaction).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value || ''; });
    document.querySelector('#transaction-form-title').textContent = 'Edit transaksi';
    document.querySelector('#transaction-submit').innerHTML = 'Simpan perubahan <span>→</span>';
    document.querySelector('[data-cancel="transaction"]').classList.remove('hidden-field');
    syncTransactionFields();
    document.querySelector('[data-tab="transactions"]').click();
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (member) {
    const form = document.querySelector('#member-form');
    form.elements.id.value = member.id;
    form.elements.name.value = member.name;
    form.elements.studentNo.value = member.studentNo || '';
    form.elements.gender.value = member.gender || '';
    document.querySelector('#member-form-title').textContent = 'Edit anggota';
    document.querySelector('#member-submit').innerHTML = 'Simpan perubahan <span>→</span>';
    document.querySelector('[data-cancel="member"]').classList.remove('hidden-field');
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (wishlist) {
    const form = document.querySelector('#wishlist-form');
    Object.entries(wishlist).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value || ''; });
    document.querySelector('#wishlist-form-title').textContent = 'Edit wishlist';
    document.querySelector('#wishlist-submit').innerHTML = 'Simpan perubahan <span>→</span>';
    document.querySelector('[data-cancel="wishlist"]').classList.remove('hidden-field');
    document.querySelector('[data-tab="wishlist"]').click();
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    const entityId = target.dataset.deleteTransaction || target.dataset.deleteMember || target.dataset.deleteWishlist;
    const route = target.dataset.deleteTransaction ? 'transactions' : target.dataset.deleteMember ? 'members' : target.dataset.deleteWishlist ? 'wishlist' : null;
    if (route && window.confirm('Hapus data ini? Tindakan ini tidak dapat dibatalkan.')) {
      try {
        await api(`/api/admin/${route}/${entityId}`, { method: 'DELETE' });
        await refresh();
        message('Data dihapus.');
      } catch (error) { message(error.message, true); }
    }
  }
});

document.querySelector('#transaction-form').elements.date.value = today;
document.querySelector('#transaction-form').elements.period.value = mondayOf(today);
document.querySelector('#admin-period').value = mondayOf(today);
syncTransactionFields();
refresh().catch((error) => message(error.message, true));