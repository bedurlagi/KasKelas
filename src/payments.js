function paymentRows(data, period) {
  return data.members.map((member) => {
    const payments = data.transactions.filter((transaction) =>
      transaction.type === 'income' && transaction.studentId === member.id && transaction.period === period
    );
    const paid = payments.reduce((total, transaction) => total + transaction.amount, 0);
    const paymentDates = [...new Set(payments.map((transaction) => transaction.date))].sort();
    const due = data.settings.weeklyDue;
    return {
      ...member,
      paid,
      due,
      arrears: Math.max(due - paid, 0),
      paidInFull: paid >= due,
      paymentDates
    };
  });
}

module.exports = { paymentRows };