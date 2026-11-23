const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const token = document.querySelector('meta[name="csrf-token"]').content;
const state = { data: null, filter: 'all' };

const escapeText = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const money = (amount) => rupiah.format(amount || 0).replace(/\u00a0/g, ' ');
const formatDate = (date) => date ? new Date(`${date}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Tanggal belum ditentukan';

function memberMarkup(member, compact = false) {
  const paid = member.paid >= member.due;
  const statusText = paid ? 'Lunas' : member.paid ? `Kurang ${money(member.arrears)}` : `Belum bayar · ${money(member.arrears)}`;
  return `<article class="member-row ${compact ? 'compact-row' : ''}"><div class="avatar">${escapeText(member.name.trim().charAt(0).toUpperCase())}</div><div class="member-info"><strong>${escapeText(member.name)}</strong><span>${member.paid ? `Terkumpul ${money(member.paid)}` : `Iuran ${money(member.due)}`}</span></div><span class="status-pill ${paid ? 'status-paid' : 'status-unpaid'}">${statusText}</span></article>`;
}

function paymentRowMarkup(member) {
  const isPaid = member.paidInFull;
  const status = isPaid ? '<span class="payment-state state-paid"><b aria-hidden="true">✓</b> Lunas</span>' : '<span class="payment-state state-unpaid"><b aria-hidden="true">×</b> Belum lunas</span>';
  const dates = member.paymentDates.length ? member.paymentDates.map(formatDate).join('<br>') : '—';
  const identity = `${member.studentNo ? `<span>NIM ${escapeText(member.studentNo)}</span>` : ''}${member.gender ? `<span> · ${escapeText(member.gender)}</span>` : ''}`;
  return `<tr><td data-label="Anggota"><div class="payment-member"><strong>${escapeText(member.name)}</strong><span>${identity}</span></div></td><td data-label="Status">${status}</td><td data-label="Dibayar"><span>${money(member.paid)}<small> / ${money(member.due)}</small></span></td><td data-label="Tanggal bayar"><span class="payment-dates">${dates}</span></td><td data-label="Tunggakan"><strong class="${member.arrears ? 'arrears-value' : 'no-arrears'}">${money(member.arrears)}</strong></td></tr>`;
}

function transactionMarkup(item) {
  const incoming = item.type === 'income';
  return `<article class="transaction-row"><span class="transaction-icon ${incoming ? 'transaction-in' : 'transaction-out'}">${incoming ? '+' : '−'}</span><div class="transaction-info"><strong>${escapeText(item.note)}</strong><span>${formatDate(item.date)} <i>·</i> ${incoming ? 'Pemasukan' : 'Pengeluaran'}</span></div><strong class="transaction-amount ${incoming ? 'amount-in' : 'amount-out'}">${incoming ? '+' : '−'}${money(item.amount)}</strong></article>`;
}

function wishlistMarkup(item, balance) {
  const sufficient = balance >= item.estimatedCost;
  const statusClass = item.status === 'Terealisasi' ? 'wishlist-done' : item.status === 'Dibatalkan' ? 'wishlist-cancelled' : '';
  const fundsMessage = item.status === 'Rencana'
    ? (sufficient ? 'Saldo saat ini mencukupi' : `Kurang ${money(item.estimatedCost - balance)} dari saldo`)
    : item.status;
  return `<article class="wish-card"><div class="wish-topline"><span class="wish-mark">✳</span><span class="wishlist-status ${statusClass}">${escapeText(item.status)}</span></div><h3>${escapeText(item.name)}</h3><p class="wish-description">${escapeText(item.description || 'Belum ada catatan acara.')}</p><div class="wish-details"><span>${escapeText(item.date || 'Waktu belum ditentukan')}</span><strong>${money(item.estimatedCost)}</strong></div><div class="fund-check ${sufficient && item.status === 'Rencana' ? 'fund-ok' : ''}"><span class="fund-check-dot"></span>${escapeText(fundsMessage)}</div></article>`;
}

function render() {
  const { summary, members, transactions, wishlist, settings, period } = state.data;
  document.querySelector('#balance-value').textContent = money(summary.balance);
  document.querySelector('#income-value').textContent = money(summary.income);
  document.querySelector('#expense-value').textContent = money(summary.expense);
  document.querySelector('#period-label').textContent = new Date(`${period}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  document.querySelector('#member-count').textContent = members.length;
  document.querySelector('#dues-description').textContent = `Periode mulai ${formatDate(period)} · Iuran wajib ${money(settings.weeklyDue)}`;
  document.querySelector('#overview-members').innerHTML = members.slice(0, 4).map((member) => memberMarkup(member, true)).join('') || '<p class="empty-state">Belum ada anggota terdaftar.</p>';
  document.querySelector('#public-period').value = period;
  document.querySelector('#public-payment-count').textContent = `${members.length} anggota`;
  renderPaymentTable();
  document.querySelector('#overview-transactions').innerHTML = transactions.slice(0, 4).map(transactionMarkup).join('') || '<p class="empty-state">Belum ada transaksi.</p>';
  document.querySelector('#transactions-list').innerHTML = filteredTransactions().map(transactionMarkup).join('') || '<p class="empty-state">Belum ada transaksi.</p>';
  const wishes = wishlist.map((item) => wishlistMarkup(item, summary.balance)).join('') || '<p class="empty-state">Belum ada rencana acara.</p>';
  document.querySelector('#wishlist-list').innerHTML = wishes;
  document.querySelector('#overview-wishlist').innerHTML = wishlist.slice(0, 2).map((item) => wishlistMarkup(item, summary.balance)).join('') || '<p class="empty-state">Belum ada rencana acara.</p>';
}

function filteredMembers() {
  const query = document.querySelector('#member-search').value.trim().toLocaleLowerCase('id');
  return state.data.members.filter((member) => member.name.toLocaleLowerCase('id').includes(query));
}

function renderPaymentTable() {
  const members = filteredMembers();
  document.querySelector('#public-payments').innerHTML = members.map(paymentRowMarkup).join('') || '<tr><td colspan="5" class="empty-state">Nama tidak ditemukan.</td></tr>';
}

function mondayOf(date) {
  const monday = new Date(`${date}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

function filteredTransactions() {
  return state.data.transactions.filter((item) => state.filter === 'all' || item.type === state.filter).map(transactionMarkup).join('') || '<p class="empty-state">Belum ada transaksi pada kategori ini.</p>';
}

function showSection(section) {
  document.querySelectorAll('.section-tab').forEach((button) => button.classList.toggle('active', button.dataset.section === section));
  document.querySelectorAll('.content-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === section));
  window.scrollTo({ top: document.querySelector('.section-tabs').offsetTop - 12, behavior: 'smooth' });
}

document.querySelectorAll('.section-tab').forEach((button) => button.addEventListener('click', () => showSection(button.dataset.section)));
document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => showSection(button.dataset.go)));
document.querySelector('#member-search').addEventListener('input', () => {
  renderPaymentTable();
});
document.querySelector('#public-period').addEventListener('change', async (event) => {
  if (!event.target.value) return;
  const period = mondayOf(event.target.value);
  event.target.value = period;
  try {
    const response = await fetch(`/api/public?period=${encodeURIComponent(period)}`);
    if (!response.ok) throw new Error('Data periode tidak dapat dimuat.');
    state.data = await response.json();
    render();
  } catch (error) {
    event.target.value = state.data.period;
    document.querySelector('#public-payment-count').textContent = error.message;
  }
});
document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
  state.filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach((filter) => filter.classList.toggle('active', filter === button));
  document.querySelector('#transactions-list').innerHTML = filteredTransactions();
}));
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    event.preventDefault();
    showSection('members');
    document.querySelector('#member-search').focus();
  }
});
document.querySelector('#footer-year').textContent = new Date().getFullYear();

fetch('/api/public').then((response) => {
  if (!response.ok) throw new Error('Data kas tidak dapat dimuat.');
  return response.json();
}).then((data) => {
  state.data = data;
  render();
}).catch(() => {
  document.querySelectorAll('.loading').forEach((element) => { element.textContent = 'Data belum tersedia. Muat ulang halaman untuk mencoba kembali.'; });
});