const getTimeIn = (row) => row?.time_in ?? row?.timeIn ?? null;
const getId = (row) => row?.id == null ? '' : String(row.id);

export function buildAttendanceCursorFilter(cursor) {
  if (!cursor) return null;
  const timeIn = getTimeIn(cursor);
  const id = getId(cursor);
  if (!timeIn || !id) throw new Error('Attendance pagination cursor is incomplete.');
  return `time_in.lt.${timeIn},and(time_in.eq.${timeIn},id.gt.${id})`;
}

export async function fetchAllAttendancePages(fetchPage, pageSize = 1000) {
  const safePageSize = Math.max(1, Math.trunc(Number(pageSize) || 1000));
  const rowsById = new Map();
  let cursor = null;
  let previousCursorKey = null;

  while (true) {
    const result = await fetchPage(cursor, safePageSize);
    if (result?.error) throw result.error;
    const rows = Array.isArray(result) ? result : result?.data;
    if (!Array.isArray(rows)) throw new Error('Attendance page returned an invalid response.');
    if (rows.length > safePageSize) throw new Error('Attendance page exceeded its requested size.');
    if (rows.length === 0) break;

    for (const row of rows) {
      const id = getId(row);
      const timeIn = getTimeIn(row);
      if (!id || !timeIn || !Number.isFinite(new Date(timeIn).getTime())) {
        throw new Error('Attendance page contains a row without a valid cursor.');
      }
      rowsById.set(id, row);
    }

    const nextCursor = rows.at(-1);
    const nextCursorKey = `${getTimeIn(nextCursor)}\u0000${getId(nextCursor)}`;
    if (nextCursorKey === previousCursorKey) {
      throw new Error('Attendance pagination did not advance; refusing to return incomplete data.');
    }
    previousCursorKey = nextCursorKey;
    cursor = nextCursor;
    if (rows.length < safePageSize) break;
  }

  return [...rowsById.values()].sort((left, right) => {
    const timeDifference = new Date(getTimeIn(right)).getTime() - new Date(getTimeIn(left)).getTime();
    if (timeDifference !== 0) return timeDifference;
    return getId(left).localeCompare(getId(right));
  });
}