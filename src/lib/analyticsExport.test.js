import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { exportReport } from './excelUtils.js';

const rows = [
  { section: 'Expected visits', detail: '2026-02-01', value: 4 },
  { section: 'Recent pattern', detail: 'Visits are steady.', value: '' },
  { section: 'Suggested actions', detail: 'Prepare more fiction books.', value: '' },
];
const options = {
  title: 'Analytics Summary',
  columns: [{ key: 'section', label: 'Section' }, { key: 'detail', label: 'Detail' }, { key: 'value', label: 'Value' }],
  summary: [['Visitors', 99]],
  preservePdfText: true,
  download: false,
};

test('analytics exports preserve forecast and generated narrative in CSV and Excel', async () => {
  const csv = await exportReport(rows, 'csv', options);
  const csvText = await csv.blob.text();
  assert.match(csvText, /2026-02-01,4/);
  assert.match(csvText, /Prepare more fiction books/);

  const xlsx = await exportReport(rows, 'xlsx', options);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await xlsx.blob.arrayBuffer());
  const sheet = workbook.getWorksheet('Analytics Summary');
  const values = [];
  sheet.eachRow((row) => row.eachCell((cell) => values.push(String(cell.value))));
  assert.ok(values.includes('Visits are steady.'));
  assert.ok(values.includes('Prepare more fiction books.'));
});

test('analytics PDF fits its table to the page and contains generated insights', async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const pdf = await exportReport(rows, 'pdf', options);
    const text = Buffer.from(await pdf.blob.arrayBuffer()).toString('latin1');
    assert.ok(text.includes('Prepare more fiction books.'));
    assert.ok(text.includes('Visits are steady.'));
    assert.equal(warnings.some((warning) => warning.includes('could not fit page')), false);
  } finally {
    console.warn = originalWarn;
  }
});
