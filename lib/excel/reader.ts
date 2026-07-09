import * as XLSX from "xlsx";

export async function readExcel(file: File) {
  const data = await file.arrayBuffer();

  const workbook = XLSX.read(data);

  const sheetName = workbook.SheetNames[0];

  const worksheet = workbook.Sheets[sheetName];

  const json = XLSX.utils.sheet_to_json(worksheet);

  return json;
}