import * as XLSX from 'xlsx';
import Papa from 'papaparse';

// 1. Function para mag-Export ng Data papuntang Excel (.xlsx)
export const exportToExcel = (data, fileName = 'exported_data.xlsx') => {
  if (!data || data.length === 0) {
    alert('Walang data na pwedeng i-export!');
    return;
  }
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');
  XLSX.writeFile(workbook, fileName);
};

// 2. Function para mag-Export ng Data papuntang CSV (.csv)
export const exportToCSV = (data, fileName = 'exported_data.csv') => {
  if (!data || data.length === 0) {
    alert('Walang data na pwedeng i-export!');
    return;
  }
  const csv = Papa.unparse(data);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
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