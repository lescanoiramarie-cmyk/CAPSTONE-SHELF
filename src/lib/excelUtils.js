import * as XLSX from 'xlsx';
import Papa from 'papaparse';

const NAVY = '002046';
const MISSING = '—';
const DATE_FIELDS = new Set([
  'time',
  'timeIn',
  'checkedOutAt',
  'createdAt',
  'updatedAt',
  'requestDate',
  'returnDate',
  'borrowDate',
  'dueDate',
  'pickupDeadline',
]);
const LABELS = {
  type: 'Activity',
  time: 'Date and Time',
  timeIn: 'Date and Time',
  checkedOutAt: 'Date Checked Out',
  person: 'Visitor',
  visitorName: 'Visitor',
  visitorId: 'Visitor',
  detail: 'Details',
  bookTitle: 'Book Title',
  branch: 'Library',
  libraryId: 'Library',
  library_id: 'Library',
  libraryName: 'Library',
  library_name: 'Library',
  status: 'Status',
  dataClassification: 'Data Classification',
  title: 'Book Title',
  author: 'Author',
  isbn: 'ISBN',
  category: 'Category',
  publisher: 'Publisher',
  qtyAvail: 'Available Copies',
  qty_avail: 'Available Copies',
  availableCopies: 'Available Copies',
  available_copies: 'Available Copies',
  quantity: 'Copies',
  requestDate: 'Date Requested',
  returnDate: 'Date Returned',
  borrowDate: 'Date Borrowed',
  dueDate: 'Due Date',
  pickupDeadline: 'Pickup Deadline',
  fineAmount: 'Fine Amount',
  createdAt: 'Date Created',
  created_at: 'Date Created',
  updatedAt: 'Date Updated',
  checked_out_at: 'Date Checked Out',
  time_in: 'Date and Time',
  visitor_name: 'Visitor',
  book_title: 'Book Title',
  fine_amount: 'Fine Amount',
};

const toDate = (value) => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const dateParts = (date, timeZone = 'Asia/Manila') => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
};

const timeParts = (date, timeZone = 'Asia/Manila') => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
};

const excelDate = (date, dateOnly = false) => {
  const dateValues = dateParts(date);
  if (dateOnly) {
    return new Date(Date.UTC(
      Number(dateValues.year),
      Number(dateValues.month) - 1,
      Number(dateValues.day)
    ));
  }
  const timeValues = timeParts(date);
  return new Date(Date.UTC(
    Number(dateValues.year),
    Number(dateValues.month) - 1,
    Number(dateValues.day),
    Number(timeValues.hour),
    Number(timeValues.minute),
    Number(timeValues.second)
  ));
};

const formatDate = (value, includeTime = false) => {
  const date = toDate(value);
  if (!date) return MISSING;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(includeTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(date);
};

const formatDateRange = (options) => {
  if (options.dateRange) return options.dateRange;
  const start = toDate(options.startDate);
  const end = toDate(options.endDate);
  if (options.asOf) return `As of ${formatDate(end || start || new Date())}`;
  if (start && end) {
    return `${formatDate(start)} – ${formatDate(end)}`;
  }
  return start ? formatDate(start) : 'All dates';
};

const safePart = (value) =>
  String(value || 'All-Libraries')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'All-Libraries';

const ymd = (value) => {
  const date = toDate(value) || new Date();
  const parts = dateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const buildReportFilename = (options = {}, extension = 'xlsx') => {
  const end = options.endDate || options.startDate || new Date();
  const start = options.startDate || end;
  const reportType = safePart(options.reportType || options.title || 'Report');
  const library = safePart(options.libraryName || 'All-Libraries');
  return `SHELF_${reportType}_${library}_${ymd(start)}_to_${ymd(end)}.${extension}`;
};

const humanize = (key) =>
  LABELS[key] ||
  String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());

const isInternalField = (key) =>
  /(^id$|Id$|_id$|uuid|^is(?:[A-Z]|_)|^internal|^raw|confirmedBy$|createdBy$)/i.test(key) &&
  !['libraryId', 'library_id'].includes(key);

const resolveLibrary = (value, libraries = []) =>
  libraries.find((library) =>
    [library.id, library.libraryId, library.library_id].some(
      (id) => id != null && String(id) === String(value)
    )
  )?.name ||
  libraries.find((library) =>
    [library.id, library.libraryId, library.library_id].some(
      (id) => id != null && String(id) === String(value)
    )
  )?.libraryName ||
  libraries.find((library) =>
    [library.id, library.libraryId, library.library_id].some(
      (id) => id != null && String(id) === String(value)
    )
  )?.library_name ||
  (value ? MISSING : MISSING);

const getColumns = (data, options) => {
  if (options.columns?.length) {
    return options.columns.map((column) =>
      typeof column === 'string'
        ? { key: column, label: humanize(column) }
        : column
    );
  }
  const keys = [...new Set(data.flatMap((row) => Object.keys(row || {})))].filter(
    (key) => !isInternalField(key)
  );
  if (keys.length === 0) return [{ key: 'result', label: 'Result' }];
  const rank = (key) => {
    if (/title|person|visitor|book/i.test(key)) return 0;
    if (/branch|library/i.test(key)) return 1;
    if (/date|time/i.test(key)) return 2;
    if (/status|type|classification/i.test(key)) return 3;
    return 4;
  };
  keys.sort((left, right) => rank(left) - rank(right));
  const labels = new Set();
  return keys
    .map((key) => ({ key, label: humanize(key) }))
    .filter((column) => {
      if (labels.has(column.label)) return false;
      labels.add(column.label);
      return true;
    });
};

const fieldType = (column) => {
  if (column.type) return column.type;
  if (DATE_FIELDS.has(column.key) || /date|time/i.test(column.key)) return 'date';
  if (/amount|fine|price|cost|fee/i.test(column.key)) return 'currency';
  if (/count|qty|quantity|copies|visits|position/i.test(column.key)) return 'number';
  return 'auto';
};

const isMissing = (value) =>
  value == null ||
  (typeof value === 'number' && !Number.isFinite(value)) ||
  (typeof value === 'string' &&
    ['', 'null', 'undefined', 'n/a'].includes(value.trim().toLowerCase()));

const libraryKey = (key) => ['libraryId', 'library_id'].includes(key);

const valueFor = (row, column, options, target) => {
  let value = row?.[column.key];
  if (libraryKey(column.key)) value = resolveLibrary(value, options.libraries);
  if (isMissing(value)) return target === 'csv' ? '' : MISSING;

  const type = fieldType(column);
  if (type === 'date') {
    const date = toDate(value);
    if (!date) return target === 'excel' ? MISSING : MISSING;
    if (target === 'excel') {
      return excelDate(date, typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value));
    }
    if (target === 'csv') {
      const parts = dateParts(date);
      const time = timeParts(date);
      const dateText = `${parts.year}-${parts.month}-${parts.day}`;
      return /time|timeIn/i.test(column.key)
        ? `${dateText} ${time.hour}:${time.minute}`
        : dateText;
    }
    return formatDate(date, /time|timeIn/i.test(column.key));
  }

  if (typeof value === 'string' && /status/i.test(column.key)) {
    return value
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase());
  }
  if (type === 'currency' && typeof value === 'number') {
    if (target === 'pdf') {
      return `₱${value.toLocaleString('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
    if (target === 'csv') return value.toFixed(2);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return String(value);
};

const outputRows = (data, columns, options, target) =>
  data.map((row) =>
    Object.fromEntries(
      columns.map((column) => [
        column.label,
        valueFor(row, column, options, target),
      ])
    )
  );

const generatedAt = () => new Date();
const yieldToUI = () => new Promise((resolve) => window.requestAnimationFrame(resolve));

const makeSummaryRows = (options) => [
  ['System', 'SHELF ILMS'],
  ['Report', options.title || options.reportType || 'Report'],
  ['Library / Branch', options.libraryName || 'All Libraries'],
  ['Date Range', formatDateRange(options)],
  ['Generated On', formatDate(generatedAt(), true)],
  ['Generated By', options.generatedBy || MISSING],
  ...(options.summary || []),
];

const toArgb = (color) => `FF${color}`;

const setWorksheetTitle = (sheet, columnCount, title) => {
   sheet.getCell(1, 1).value = `SHELF ILMS — ${title}`;
   if (columnCount > 1) sheet.mergeCells(1, 1, 1, columnCount);
   sheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: toArgb('FFFFFF') } };
   sheet.getCell(1, 1).fill = {
     type: 'pattern',
     pattern: 'solid',
     fgColor: { argb: toArgb(NAVY) },
   };
   sheet.getRow(1).height = 28;
};

const setExcelCellFormat = (cell, column) => {
   const type = fieldType(column);
   if (type === 'date') {
     cell.numFmt = /time|timeIn/i.test(column.key) ? 'mmm d, yyyy, h:mm AM/PM' : 'mmm d, yyyy';
   } else if (type === 'currency') {
     cell.numFmt = '₱#,##0.00';
   } else if (type === 'number') {
     cell.numFmt = '#,##0';
   } else if (typeof cell.value === 'number') {
     cell.numFmt = '#,##0.##';
   }
   cell.alignment = {
     vertical: 'middle',
     horizontal:
       ['currency', 'number'].includes(type) || typeof cell.value === 'number'
         ? 'right'
         : 'left',
     wrapText: true,
   };
};

const downloadBlob = (blob, fileName) => {
   const link = document.createElement('a');
   link.href = URL.createObjectURL(blob);
   link.setAttribute('download', fileName);
   document.body.appendChild(link);
   link.click();
   document.body.removeChild(link);
   URL.revokeObjectURL(link.href);
};

const drawPdfCurrencyText = (pdf, cell) => {
   const text = cell.shelfCurrencyText;
   if (!text) return;
   const canvas = window.document.createElement('canvas');
   const scale = 3;
   const pixelsPerMillimeter = 96 / 25.4;
   canvas.width = Math.max(1, Math.ceil(cell.width * pixelsPerMillimeter * scale));
   canvas.height = Math.max(1, Math.ceil(cell.height * pixelsPerMillimeter * scale));
   const context = canvas.getContext('2d');
   if (!context) {
     pdf.setFontSize(cell.styles.fontSize || 8);
     pdf.text(text.replace(/₱/g, 'PHP '), cell.x + 2, cell.y + cell.height / 2, {
       baseline: 'middle',
     });
     return;
   }

   const fontSize = (cell.styles.fontSize || 8) * scale * (96 / 72);
   const padding = typeof cell.styles.cellPadding === 'number'
     ? cell.styles.cellPadding
     : 2;
   const paddingPixels = padding * pixelsPerMillimeter * scale;
   const maxWidth = canvas.width - paddingPixels * 2;
   context.font = `${fontSize}px Arial, sans-serif`;
   context.fillStyle = Array.isArray(cell.shelfTextColor)
     ? `rgb(${cell.shelfTextColor.join(',')})`
     : '#1E293B';
   context.textAlign = cell.styles.halign || 'left';
   context.textBaseline = 'middle';
   const lines = [];
   text.split('\n').forEach((paragraph) => {
     let line = '';
     paragraph.split(/\s+/).forEach((word) => {
       const candidate = line ? `${line} ${word}` : word;
       if (line && context.measureText(candidate).width > maxWidth) {
         lines.push(line);
         line = word;
       } else {
         line = candidate;
       }
     });
     lines.push(line);
   });
   const lineHeight = fontSize * 1.2;
   const firstLineY = (canvas.height - lines.length * lineHeight) / 2 + lineHeight / 2;
   lines.forEach((line, index) => {
     const x = context.textAlign === 'right'
       ? canvas.width - paddingPixels
       : context.textAlign === 'center'
         ? canvas.width / 2
         : paddingPixels;
     context.fillText(line, x, firstLineY + index * lineHeight);
   });
   pdf.addImage(canvas, 'PNG', cell.x, cell.y, cell.width, cell.height);
};

export const exportToExcel = async (data = [], fileName, options = {}) => {
   const { default: ExcelJS } = await import('exceljs');
   const rows = Array.isArray(data) ? data : [];
   const columns = getColumns(rows, options);
   const formattedRows = outputRows(rows, columns, options, 'excel');
   const workbook = new ExcelJS.Workbook();
   workbook.creator = options.generatedBy || 'SHELF ILMS';
   workbook.created = generatedAt();
   workbook.subject = options.title || options.reportType || 'Report';
   const title = options.title || options.reportType || 'Report';

   if (options.summary?.length) {
     const summarySheet = workbook.addWorksheet('Summary');
     setWorksheetTitle(summarySheet, 2, title);
     summarySheet.getColumn(1).width = 28;
     summarySheet.getColumn(2).width = 52;
     makeSummaryRows(options).forEach(([label, value], index) => {
       const row = summarySheet.addRow([label, value]);
       row.height = 22;
       row.getCell(1).font = { bold: true, color: { argb: toArgb('1E293B') } };
       row.getCell(2).alignment = { vertical: 'middle', wrapText: true };
       row.eachCell((cell) => {
         cell.border = { bottom: { style: 'thin', color: { argb: toArgb('E2E8F0') } } };
         if (index % 2 === 1) {
           cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb('F8FAFC') } };
         }
       });
     });
   }

   const worksheet = workbook.addWorksheet(safeSheetName(options.sheetName || title));
   setWorksheetTitle(worksheet, Math.max(2, columns.length), title);
   const metadataRows = [
     ['Library / Branch', options.libraryName || 'All Libraries'],
     ['Date Range', formatDateRange(options)],
     ['Generated By', options.generatedBy || MISSING],
     ['Generated On', formatDate(generatedAt(), true)],
   ];
   metadataRows.forEach((values, index) => {
     const row = worksheet.addRow(values);
     row.height = 20;
     row.getCell(1).font = { bold: true };
     row.getCell(2).alignment = { wrapText: true, vertical: 'middle' };
     if (index % 2 === 1) {
       row.eachCell((cell) => {
         cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb('F8FAFC') } };
       });
     }
   });
   worksheet.addRow([]);
   const headerRowNumber = worksheet.rowCount + 1;
   const header = worksheet.addRow(columns.map((column) => column.label));
   header.height = 26;
   header.eachCell((cell) => {
     cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb(NAVY) } };
     cell.font = { bold: true, color: { argb: toArgb('FFFFFF') } };
     cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
     cell.border = {
       bottom: { style: 'thin', color: { argb: toArgb('0F172A') } },
       right: { style: 'thin', color: { argb: toArgb('CBD5E1') } },
     };
   });
   const dataStartRow = headerRowNumber + 1;
   const tableRows = formattedRows.length
     ? formattedRows
     : [{ [columns[0]?.label || 'Result']: 'No records found for the selected filters' }];
   for (let offset = 0; offset < tableRows.length; offset += 500) {
     tableRows.slice(offset, offset + 500).forEach((item, batchIndex) => {
       const index = offset + batchIndex;
       const row = worksheet.addRow(columns.map((column) => item[column.label] ?? null));
       row.height = 22;
       row.eachCell((cell, columnIndex) => {
         setExcelCellFormat(cell, columns[columnIndex - 1]);
         cell.border = {
           bottom: { style: 'thin', color: { argb: toArgb('E2E8F0') } },
           right: { style: 'thin', color: { argb: toArgb('F1F5F9') } },
         };
         if (index % 2 === 0) {
           cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb('F1F5F9') } };
         }
       });
     });
     if (offset + 500 < tableRows.length) await yieldToUI();
   }

   columns.forEach((column, index) => {
     const values = [column.label, ...tableRows.map((row) => String(row[column.label] ?? ''))];
     const longest = Math.max(
       ...values.map((value) =>
         value.split(/\r?\n/).reduce((max, line) => Math.max(max, line.length), 0)
       )
     );
     worksheet.getColumn(index + 1).width = Math.min(42, Math.max(12, longest + 2));
   });
   const lastDataRow = headerRowNumber + tableRows.length;
   worksheet.autoFilter = {
     from: { row: headerRowNumber, column: 1 },
     to: { row: lastDataRow, column: Math.max(1, columns.length) },
   };
   worksheet.views = [{ state: 'frozen', ySplit: headerRowNumber }];
   worksheet.pageSetup = {
     paperSize: 9,
     orientation: columns.length > 6 ? 'landscape' : 'portrait',
     fitToPage: true,
     fitToWidth: 1,
     fitToHeight: 0,
     margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
     printTitlesRow: `${headerRowNumber}:${headerRowNumber}`,
   };
   worksheet.headerFooter.oddFooter = '&LSHELF ILMS&CPage &P of &N&RGenerated &D';

   if (options.totalRow && formattedRows.length) {
     const totalRow = worksheet.addRow(
       columns.map((column) => options.totalRow[column.key] ?? null)
     );
     totalRow.getCell(1).value = options.totalRow[columns[0]?.key] || 'Total';
     totalRow.height = 22;
     columns.forEach((column, index) => {
       if (!options.totalColumns?.includes(column.key)) return;
       const excelColumn = index + 1;
       const cell = totalRow.getCell(excelColumn);
       cell.value = {
         formula: `SUM(${worksheet.getColumn(excelColumn).letter}${dataStartRow}:${worksheet.getColumn(excelColumn).letter}${lastDataRow})`,
       };
       setExcelCellFormat(cell, column);
     });
     totalRow.eachCell((cell) => {
       cell.font = { bold: true, color: { argb: toArgb('0F172A') } };
       cell.border = { top: { style: 'thin', color: { argb: toArgb(NAVY) } } };
     });
   }
   const buffer = await workbook.xlsx.writeBuffer();
   const blob = new Blob([buffer], {
     type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
   });
   downloadBlob(blob, fileName || buildReportFilename(options, 'xlsx'));
};

const safeSheetName = (value) =>
  String(value || 'Report')
    .replace(/[\\/?*[\]:]/g, ' ')
    .trim()
    .slice(0, 31) || 'Report';

export const exportToCSV = async (data = [], fileName, options = {}) => {
  const rows = Array.isArray(data) ? data : [];
  const columns = getColumns(rows, options);
  const formattedRows = outputRows(rows, columns, options, 'csv');
  const csvRows = formattedRows.length
    ? formattedRows
    : [{ [columns[0]?.label || 'Result']: 'No records found for the selected filters' }];
  const columnNames = columns.length ? columns.map((column) => column.label) : ['Result'];
  const csvChunks = [];
  for (let offset = 0; offset < csvRows.length; offset += 500) {
    const protectedRows = csvRows.slice(offset, offset + 500).map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => {
          const column = columns.find((item) => item.label === key);
          const isText = typeof value === 'string' &&
            (!column || !['date', 'currency', 'number'].includes(fieldType(column)));
          const text = String(value ?? '');
          return [key, isText && /^[=+\-@]/.test(text) ? `'${text}` : text];
        })
      )
    );
    csvChunks.push(Papa.unparse(protectedRows, {
      columns: columnNames,
      header: offset === 0,
      newline: '\r\n',
    }));
    if (offset + 500 < csvRows.length) await yieldToUI();
  }
  const csv = `\uFEFF${csvChunks.join('\r\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', fileName || buildReportFilename(options, 'csv'));
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
};

export const exportToPDF = async (data = [], fileName, options = {}) => {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const rows = Array.isArray(data) ? data : [];
  const columns = getColumns(rows, options);
  const formattedRows = outputRows(rows, columns, options, 'pdf');
  const orientation = columns.length > 6 ? 'landscape' : 'portrait';
  const document = new jsPDF({ orientation, format: 'a4', unit: 'mm' });
  const pageWidth = document.internal.pageSize.getWidth();
  const metadata = makeSummaryRows(options);
  const heading = options.title || options.reportType || 'Report';
  const generatedOn = formatDate(generatedAt());

  document.setFont('helvetica', 'bold');
  document.setTextColor(0, 32, 70);
  document.setFontSize(17);
  document.text('SHELF ILMS', 15, 17);
  document.setFontSize(14);
  document.text(heading, 15, 25);
  document.setDrawColor(0, 32, 70);
  document.setLineWidth(0.7);
  document.line(15, 29, pageWidth - 15, 29);
  autoTable(document, {
    startY: 33,
    head: [],
    body: metadata.map(([label, value]) => [label, String(value)]),
    theme: 'plain',
    margin: { left: 15, right: 15 },
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.4, textColor: [51, 65, 85] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 38 }, 1: { cellWidth: 'auto' } },
  });

  let tableStartY = document.lastAutoTable.finalY + 5;
  if (options.summary?.length) {
    document.setFont('helvetica', 'bold');
    document.setFontSize(10);
    document.setTextColor(15, 23, 42);
    document.text('Summary', 15, tableStartY + 3);
    tableStartY += 6;
    autoTable(document, {
      startY: tableStartY,
      body: options.summary.map(([label, value]) => [label, String(value)]),
      theme: 'grid',
      margin: { left: 15, right: 15 },
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, lineColor: [203, 213, 225] },
      columnStyles: { 0: { fontStyle: 'bold' } },
    });
    tableStartY = document.lastAutoTable.finalY + 5;
  }

  const chartImages = options.chartImages || [];
  chartImages.forEach((image, index) => {
    const availableWidth = pageWidth - 30;
    const width = Math.min(availableWidth, 150);
    const height = Math.min(width * 0.48, 70);
    const titleY = tableStartY + 4;
    if (titleY + height + 7 > document.internal.pageSize.getHeight() - 17) {
      document.addPage();
      tableStartY = 15;
    }
    document.setFont('helvetica', 'bold');
    document.setFontSize(10);
    document.text(options.chartTitles?.[index] || `Chart ${index + 1}`, 15, tableStartY + 4);
    document.addImage(image, 'PNG', 15, tableStartY + 7, width, height);
    tableStartY += height + 12;
  });

  const body = formattedRows.length
    ? formattedRows.map((row) => columns.map((column) => String(row[column.label] ?? MISSING)))
    : [['No records found for the selected filters']];
  const headers = columns.length
    ? columns.map((column) => column.label)
    : ['Result'];
  const columnStyles = Object.fromEntries(
    columns.flatMap((column, index) => {
      const numeric =
        ['currency', 'number'].includes(fieldType(column)) ||
        formattedRows.some((row) => typeof row[column.label] === 'number');
      return numeric ? [[index, { halign: 'right' }]] : [];
    })
  );
  for (let offset = 0; offset < body.length; offset += 500) {
    autoTable(document, {
      startY: tableStartY,
      head: [headers],
      body: body.slice(offset, offset + 500),
      margin: { top: 15, right: 15, bottom: 17, left: 15 },
      styles: {
        font: 'helvetica',
        fontSize: columns.length > 7 ? 7 : 8,
        cellPadding: 2,
        overflow: 'linebreak',
        lineColor: [203, 213, 225],
        lineWidth: 0.15,
        valign: 'middle',
        textColor: [30, 41, 59],
      },
      headStyles: { fillColor: [0, 32, 70], textColor: [255, 255, 255], fontStyle: 'bold' },
      columnStyles,
      alternateRowStyles: { fillColor: [241, 245, 249] },
      rowPageBreak: 'avoid',
      showHead: 'everyPage',
      didParseCell: (cellData) => {
        if (cellData.section !== 'body') return;
        const text = cellData.cell.text.join('\n');
        if (!text.includes('₱')) return;
        cellData.cell.shelfCurrencyText = text;
        cellData.cell.shelfTextColor = cellData.cell.styles.textColor;
        cellData.cell.text = text.replace(/₱/g, 'P').split('\n');
        cellData.cell.styles.textColor = [255, 255, 255];
      },
      didDrawCell: (cellData) => drawPdfCurrencyText(document, cellData.cell),
    });
    tableStartY = document.lastAutoTable.finalY + 1;
    if (offset + 500 < body.length) await yieldToUI();
  }
  const pageCount = document.internal.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    document.setPage(page);
    const pageHeight = document.internal.pageSize.getHeight();
    document.setFillColor(255, 255, 255);
    document.rect(0, pageHeight - 13, pageWidth, 13, 'F');
    document.setFont('helvetica', 'normal');
    document.setFontSize(8);
    document.setTextColor(71, 85, 105);
    document.text('SHELF ILMS', 15, pageHeight - 5);
    document.text(`Generated ${generatedOn}`, pageWidth - 15, pageHeight - 5, { align: 'right' });
    document.text(`Page ${page} of ${pageCount}`, pageWidth / 2, pageHeight - 5, { align: 'center' });
  }
  document.save(fileName || buildReportFilename(options, 'pdf'));
};

export const exportReport = async (data, format, options = {}) => {
  const extension = format === 'xlsx' ? 'xlsx' : format;
  const filename = options.fileName || buildReportFilename(options, extension);
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  if (format === 'pdf') return exportToPDF(data, filename, options);
  if (format === 'xlsx') return exportToExcel(data, filename, options);
  if (format === 'csv') return exportToCSV(data, filename, options);
  throw new Error(`Unsupported export format: ${format}`);
};

// 3. Function para mag-Import / Parse ng Excel o CSV file papuntang JSON
export const parseImportFile = (file, onComplete) => {
  if (!file) return;
  const extension = file.name.split('.').pop().toLowerCase();

  if (extension === 'csv') {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => onComplete(results.data),
      error: (err) => alert('Error reading CSV: ' + err.message),
    });
  } else if (extension === 'xlsx' || extension === 'xls') {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const json = XLSX.utils.sheet_to_json(worksheet);
        onComplete(json);
      } catch (err) {
        alert('Error reading Excel file: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    alert('Pakipili lamang ang .csv, .xlsx, o .xls na file.');
  }
};
