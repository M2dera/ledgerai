import * as XLSX from "xlsx";
import { detectColumns, hasFinancialColumn } from "@/lib/financial/columns";
import type { IngestionResult } from "@/lib/financial/types";

const supportedExtensions = new Set(["xlsx", "xls", "csv"]);

function isEmptyRow(row: unknown[]): boolean {
  return row.every((cell) => cell === null || cell === undefined || String(cell).trim() === "");
}

export async function readExcel(file: File): Promise<IngestionResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (!supportedExtensions.has(extension)) {
    return { columns: [], rows: [], warnings, errors: [`Unsupported file type .${extension || "(unknown)"}. Upload XLSX, XLS, or CSV.`] };
  }
  if (file.size === 0) {
    return { columns: [], rows: [], warnings, errors: ["The selected file is empty."] };
  }

  let workbook: XLSX.WorkBook;
  try {
    const data = extension === "csv" ? await file.text() : await file.arrayBuffer();
    workbook = XLSX.read(data, { type: extension === "csv" ? "string" : "array", raw: true, cellDates: true });
  } catch {
    return { columns: [], rows: [], warnings, errors: ["The file could not be read. It may be malformed or corrupted."] };
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName || !workbook.Sheets[sheetName]) {
    return { columns: [], rows: [], warnings, errors: ["The workbook does not contain a worksheet."] };
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: null,
    blankrows: false,
    raw: true,
  });
  const nonEmpty = matrix
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !isEmptyRow(row));
  if (!nonEmpty.length) {
    return { columns: [], rows: [], warnings, errors: ["The selected worksheet is empty."] };
  }

  const candidates = nonEmpty.slice(0, 15).map(({ row, index }) => ({
    row,
    index,
    detection: detectColumns(row.map((cell) => String(cell ?? "").trim())),
  })).filter(({ row, detection }) =>
    hasFinancialColumn(detection) && row.some((cell) => cell !== null && String(cell).trim()),
  ).sort((a, b) => b.detection.headerScore - a.detection.headerScore);

  const header = candidates[0];
  if (!header) {
    return {
      columns: [], rows: [], warnings,
      errors: ["No likely header row with recognizable financial columns was found. Add a clear header row and try again."],
    };
  }
  if (header.index > nonEmpty[0].index) {
    warnings.push(`Ignored ${header.index} pre-header row(s) while locating the column headings.`);
  }

  const dataRows = matrix.slice(header.index + 1).filter((row) => !isEmptyRow(row));
  if (!dataRows.length) {
    return { columns: [], rows: [], warnings, errors: ["The worksheet has headings but no usable data rows."] };
  }
  const columnCount = Math.max(header.row.length, ...dataRows.map((row) => row.length));
  const columns = Array.from({ length: columnCount }, (_, index) => {
    const name = String(header.row[index] ?? "").trim();
    return name || (index < header.row.length ? `Column ${index + 1}` : `Unlabeled column ${index + 1}`);
  });
  if (columnCount > header.row.length) warnings.push("Some data rows contain values beyond the header columns. Those values were retained under unlabeled columns and were not mapped to financial totals.");
  const duplicateNames = columns.filter((name, index) => columns.indexOf(name) !== index);
  if (duplicateNames.length) {
    warnings.push(`Duplicate column headings were found: ${[...new Set(duplicateNames)].join(", ")}.`);
  }

  const rows = dataRows.map((row) => Object.fromEntries(
    columns.map((column, index) => [column, row[index] instanceof Date ? (row[index] as Date).toISOString() : row[index] ?? null]),
  ));

  return { columns, rows, warnings, errors };
}
