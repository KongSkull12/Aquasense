/** Build a simple Excel-compatible .xls (SpreadsheetML) and trigger a browser download. */

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const cellXml = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined || value === '') {
    return '<Cell><Data ss:Type="String"></Data></Cell>';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${escapeXml(String(value))}</Data></Cell>`;
};

export interface ExcelSheet {
  name: string;
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
}

export const downloadExcelWorkbook = (filename: string, sheets: ExcelSheet[]): void => {
  const safeSheets = sheets.filter((sheet) => sheet.headers.length > 0);
  if (!safeSheets.length) return;

  const workbook = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
${safeSheets
  .map((sheet) => {
    const name = escapeXml(sheet.name.slice(0, 31) || 'Sheet1');
    const header = `<Row>${sheet.headers.map((h) => cellXml(h)).join('')}</Row>`;
    const body = sheet.rows.map((row) => `<Row>${sheet.headers.map((_, i) => cellXml(row[i])).join('')}</Row>`).join('\n');
    return `<Worksheet ss:Name="${name}"><Table>${header}\n${body}</Table></Worksheet>`;
  })
  .join('\n')}
</Workbook>`;

  const blob = new Blob([workbook], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const base = filename.replace(/\.xlsx?$/i, '');
  link.href = url;
  link.download = `${base}.xls`;
  link.click();
  URL.revokeObjectURL(url);
};
