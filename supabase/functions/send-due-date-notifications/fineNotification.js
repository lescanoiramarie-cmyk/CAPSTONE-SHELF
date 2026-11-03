const SECONDS_PER_DAY = 24 * 60 * 60;

export function getFineOverdueDays(dueDate, returnedAt = new Date()) {
  const dueTime = new Date(dueDate).getTime();
  const returnedTime = returnedAt.getTime();

  if (!Number.isFinite(dueTime) || !Number.isFinite(returnedTime)) {
    return null;
  }
  if (returnedTime <= dueTime) return 0;

  return Math.ceil((returnedTime - dueTime) / (SECONDS_PER_DAY * 1000));
}

export function getCurrentFine(request, asOf = new Date()) {
  const savedFine = Number(request.fine_amount);
  if (Number.isFinite(savedFine) && savedFine > 0) return savedFine;

  const fineRate = Number(request.fine_rate_snapshot);
  if (!Number.isInteger(fineRate) || fineRate < 1 || fineRate > 100) {
    return null;
  }

  const overdueDays = getFineOverdueDays(request.due_date, asOf);
  return overdueDays == null ? null : overdueDays * fineRate;
}

export function getFineNotificationCopy(request, currentFine) {
  const fineRate = Number(request.fine_rate_snapshot);
  const hasValidRate =
    Number.isInteger(fineRate) && fineRate >= 1 && fineRate <= 100;
  const hasAssessedFine = Number(request.fine_amount) > 0;

  return {
    dailyRate: hasValidRate
      ? `Daily fine rate: ₱${fineRate} per overdue day.`
      : "Daily fine rate unavailable; please contact the library for review.",
    fineAmount: currentFine == null ? "" : `${hasAssessedFine ? "Previously assessed fine" : "Estimated fine"}: ₱${currentFine.toFixed(2)}`,
    unavailable: currentFine == null ? "Fine estimate unavailable; please contact the library for review." : "",
  };
}
