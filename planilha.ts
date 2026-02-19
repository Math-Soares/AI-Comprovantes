import { google } from "googleapis";
import { Readable } from "stream";
import { readFile } from "fs/promises";
import { basename } from "path";
import { getAuthClient } from "./google-auth.js";
import { GOOGLE_CONFIG, SPREADSHEET_CONFIG } from "./config.js";

interface ReceiptUpload {
  fileName: string;
  buffer: Buffer;
  mimeType?: string;
}

const normalizeText = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const getColumnFromOffset = (offset: number): string => {
  const startColCode = SPREADSHEET_CONFIG.monthStartColumn.charCodeAt(0);
  return String.fromCharCode(startColCode + offset);
};

async function marcarComprovanteNaAbaMain(
  sheets: ReturnType<typeof google.sheets>,
  nome: string,
  mes: string
): Promise<void> {
  const mainNameRange = `${GOOGLE_CONFIG.mainSheetName}!${SPREADSHEET_CONFIG.nameRange}`;
  const mainHeaderRange = `${GOOGLE_CONFIG.mainSheetName}!${SPREADSHEET_CONFIG.headerRange}`;

  const [mainNamesResponse, mainHeadersResponse] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_CONFIG.spreadsheetId,
      range: mainNameRange,
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_CONFIG.spreadsheetId,
      range: mainHeaderRange,
    }),
  ]);

  const mainNames = mainNamesResponse.data.values?.flat() ?? [];
  const mainHeaders = mainHeadersResponse.data.values?.[0] ?? [];

  const nomeNormalizado = normalizeText(nome);
  const mainNomeIndex = mainNames.findIndex(
    (n) => normalizeText(n ?? "") === nomeNormalizado
  );

  if (mainNomeIndex === -1) {
    throw new Error(
      `Nome "${nome}" não encontrado na aba ${GOOGLE_CONFIG.mainSheetName} ` +
      `(coluna ${SPREADSHEET_CONFIG.nameColumn}, linhas ${SPREADSHEET_CONFIG.nameStartRow}-${SPREADSHEET_CONFIG.nameEndRow})`
    );
  }

  const mainMonthIndex = mainHeaders.findIndex(
    (h) => normalizeText(h ?? "").includes(normalizeText(mes))
  );

  if (mainMonthIndex === -1) {
    throw new Error(
      `Mês "${mes}" não encontrado nos cabeçalhos da aba ${GOOGLE_CONFIG.mainSheetName} ` +
      `(${SPREADSHEET_CONFIG.headerRange})`
    );
  }

  const mainRow = mainNomeIndex + SPREADSHEET_CONFIG.nameStartRow;
  const mainCol = getColumnFromOffset(mainMonthIndex);
  const mainCell = `${GOOGLE_CONFIG.mainSheetName}!${mainCol}${mainRow}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_CONFIG.spreadsheetId,
    range: mainCell,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[true]],
    },
  });

  console.log(`✓ Aba Main atualizada: ${nome} → ${mainCell} (${mes})`);
}

export async function planilha(
  nome: string,
  arg2: string | ReceiptUpload,
  arg3?: string,
  customFileName?: string
): Promise<void> {
  // Validação já feita em config.ts, mas mantemos por segurança
  if (!GOOGLE_CONFIG.spreadsheetId || !GOOGLE_CONFIG.folderId) {
    throw new Error(
      "GOOGLE_SHEET_ID e GOOGLE_DRIVE_FOLDER_ID não configurados no .env"
    );
  }

  try {
    let mes: string;
    let receipt: ReceiptUpload;

    if (typeof arg2 === "string") {
      if (!arg3) {
        throw new Error("Mês não informado para upload de comprovante");
      }

      const imgPath = arg2;
      mes = arg3;
      const buffer = await readFile(imgPath);

      receipt = {
        fileName: customFileName ?? basename(imgPath),
        buffer,
        mimeType: "image/jpeg",
      };
    } else {
      if (!arg3) {
        throw new Error("Mês não informado para upload de comprovante");
      }

      mes = arg3;
      receipt = arg2;
    }

    const auth = getAuthClient();
    const sheets = google.sheets({ version: "v4", auth });
    const drive = google.drive({ version: "v3", auth });

    // Busca nomes e cabeçalhos usando ranges configuráveis
    const nameRange = `${GOOGLE_CONFIG.sheetName}!${SPREADSHEET_CONFIG.nameRange}`;
    const headerRange = `${GOOGLE_CONFIG.sheetName}!${SPREADSHEET_CONFIG.headerRange}`;
    
    const [namesResponse, headersResponse] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_CONFIG.spreadsheetId,
        range: nameRange,
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_CONFIG.spreadsheetId,
        range: headerRange,
      }),
    ]);

    const names = namesResponse.data.values?.flat() ?? [];
    const headers = headersResponse.data.values?.[0] ?? [];

    // Encontra linha do nome
    const nomeNormalizado = normalizeText(nome);
    const nomeIndex = names.findIndex(
      (n) => normalizeText(n ?? "") === nomeNormalizado
    );

    if (nomeIndex === -1) {
      throw new Error(
        `Nome "${nome}" não encontrado na coluna ${SPREADSHEET_CONFIG.nameColumn} ` +
        `(linhas ${SPREADSHEET_CONFIG.nameStartRow}-${SPREADSHEET_CONFIG.nameEndRow})`
      );
    }

    const nomeRow = nomeIndex + SPREADSHEET_CONFIG.nameStartRow;

    // Encontra coluna do mês
    const colIndex = headers.findIndex(
      (h) => (h ?? "").includes(mes) && (h ?? "").includes("Comp")
    );

    if (colIndex === -1) {
      throw new Error(
        `Coluna "Comp - ${mes}" não encontrada nos cabeçalhos ` +
        `(${SPREADSHEET_CONFIG.headerRange})`
      );
    }

    // Calcula coluna com base no offset do monthStartColumn
    const targetCol = getColumnFromOffset(colIndex);
    const targetCell = `${GOOGLE_CONFIG.sheetName}!${targetCol}${nomeRow}`;

    // Verifica se a célula já tem um comprovante
    const cellCheckResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_CONFIG.spreadsheetId,
      range: targetCell,
    });

    const existingValue = cellCheckResponse.data.values?.[0]?.[0];
    if (existingValue && existingValue !== "") {
      throw new Error(
        `Comprovante já existe para ${nome} em ${mes}. ` +
        `Célula ${targetCell} já contém: ${existingValue}`
      );
    }

    const fileName = receipt.fileName;

    // Verifica se já existe arquivo com o mesmo nome no Drive (evita duplicatas)
    const searchResponse = await drive.files.list({
      q: `name='${fileName.replace(/'/g, "\\'")}' and '${GOOGLE_CONFIG.folderId}' in parents and trashed=false`,
      fields: "files(id, name, webViewLink)",
      pageSize: 1,
    });

    let fileId: string;
    let fileLink: string;

    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      // Arquivo já existe, reutiliza
      const existingFile = searchResponse.data.files[0];
      if (!existingFile?.id || !existingFile.webViewLink) {
        throw new Error(
          `Arquivo existente no Drive sem dados suficientes (id/link): ${fileName}`
        );
      }
      fileId = existingFile.id;
      fileLink = existingFile.webViewLink;
      console.log(
        `⚠ Arquivo ${fileName} já existe no Drive (ID: ${fileId}), reutilizando...`
      );
    } else {
      // Upload novo arquivo para Drive
      const uploadResponse = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [GOOGLE_CONFIG.folderId],
        },
        media: {
          mimeType: receipt.mimeType ?? "image/jpeg",
          body: Readable.from(receipt.buffer),
        },
        fields: "id, webViewLink",
      });

      fileId = uploadResponse.data.id!;
      fileLink = uploadResponse.data.webViewLink!;

      if (!fileLink) {
        throw new Error("Falha ao obter link do arquivo no Drive");
      }
    }

    // Escapa aspas duplas no link (se houver) e no nome do arquivo
    const escapedLink = fileLink.replace(/"/g, '""');
    const escapedFileName = fileName.replace(/"/g, '""');
    
    // Insere hyperlink na célula usando o separador configurado (';' para pt-BR, ',' para en-US)
    const separator = SPREADSHEET_CONFIG.formulaSeparator;
    const hyperlink = `=HYPERLINK("${escapedLink}"${separator}"${escapedFileName}")`;

    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_CONFIG.spreadsheetId,
      range: targetCell,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[hyperlink]],
      },
    });

    // Após anexar comprovante na aba de comprovantes, marca mês correspondente na aba Main
    await marcarComprovanteNaAbaMain(sheets, nome, mes);

    console.log(
      `✓ Comprovante: ${nome} → ${targetCell} (${mes}) | Drive: ${fileId}`
    );
  } catch (error) {
    console.error("✗ Erro ao registrar na planilha:", error);
    throw error;
  }
}