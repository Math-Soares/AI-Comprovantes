/**
 * Configuração centralizada da aplicação
 * Todas as variáveis de ambiente e constantes em um único lugar
 */

import 'dotenv/config';

// ============================================================
// VALIDAÇÃO DE AMBIENTE
// ============================================================

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória não configurada: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

function resolveHealthPort(): number {
  const rawPort =
    process.env.HEALTH_PORT ?? process.env.PORT ?? process.env.SERVER_PORT ?? "3001";
  return parseInt(rawPort, 10);
}

// ============================================================
// CONFIGURAÇÃO WHATSAPP
// ============================================================

export const WHATSAPP_CONFIG = {
  /** Pasta para autenticação do WhatsApp */
  authFolder: optionalEnv('AUTH_FOLDER', 'auth_info'),
  
  /** JID do grupo específico que será monitorado (ex: 120363123456789012@g.us) */
  groupJid: optionalEnv('GROUP_JID', ''),
  
  /** Nível de log da aplicação (debug, info, warn, error, fatal) */
  logLevel: optionalEnv('LOG_LEVEL', 'info'),
  
  /** Porta do servidor HTTP para health check (0 = desabilitado) */
  healthPort: resolveHealthPort(),
  
  /** Host do servidor HTTP */
  healthHost: optionalEnv('HEALTH_HOST', '0.0.0.0'),
  
  /** Delay entre tentativas de reconexão (ms) */
  reconnectDelayMs: 5_000,
  
  /** Máximo de tentativas de reconexão antes de desistir */
  maxReconnectAttempts: 10,
} as const;

// ============================================================
// CONFIGURAÇÃO GOOGLE
// ============================================================

export const GOOGLE_CONFIG = {
  /** ID da planilha do Google Sheets */
  spreadsheetId: requireEnv('GOOGLE_SHEET_ID'),
  
  /** ID da pasta do Google Drive para upload */
  folderId: requireEnv('GOOGLE_DRIVE_FOLDER_ID'),
  
  /** Client ID do OAuth2 */
  clientId: requireEnv('GOOGLE_CLIENT_ID'),
  
  /** Client Secret do OAuth2 */
  clientSecret: requireEnv('GOOGLE_CLIENT_SECRET'),
  
  /** Refresh Token do OAuth2 */
  refreshToken: requireEnv('GOOGLE_REFRESH_TOKEN'),
  
  /** Nome da aba na planilha */
  sheetName: optionalEnv('GOOGLE_SHEET_NAME', 'Comprovantes'),

  /** Nome da aba principal (controle mensal com checkboxes) */
  mainSheetName: optionalEnv('GOOGLE_MAIN_SHEET_NAME', 'Main'),
  
  /** URL de callback do OAuth */
  redirectUri: 'http://localhost:3000/oauth2callback',
} as const;

// ============================================================
// CONFIGURAÇÃO PLANILHA
// ============================================================

export const SPREADSHEET_CONFIG = {
  /** Coluna onde estão os nomes */
  nameColumn: 'A',
  
  /** Linha inicial dos nomes (A2) */
  nameStartRow: parseInt(optionalEnv('SHEET_NAME_START_ROW', '2'), 10),
  
  /** Linha final dos nomes (A29) */
  nameEndRow: parseInt(optionalEnv('SHEET_NAME_END_ROW', '29'), 10),
  
  /** Linha dos cabeçalhos de mês */
  headerRow: 1,
  
  /** Coluna inicial dos meses (B) */
  monthStartColumn: 'B',
  
  /** Coluna final dos meses (L) */
  monthEndColumn: 'L',
  
  /** Separador de argumentos em fórmulas (';' para pt-BR, ',' para en-US) */
  formulaSeparator: optionalEnv('SHEETS_FORMULA_SEPARATOR', ';'),
  
  /** Range de nomes (ex: A2:A29) */
  get nameRange(): string {
    return `${this.nameColumn}${this.nameStartRow}:${this.nameColumn}${this.nameEndRow}`;
  },
  
  /** Range de cabeçalhos de mês (ex: B1:L1) */
  get headerRange(): string {
    return `${this.monthStartColumn}${this.headerRow}:${this.monthEndColumn}${this.headerRow}`;
  },
} as const;

// ============================================================
// CONFIGURAÇÃO AI
// ============================================================

export const AI_CONFIG = {
  /** API Key do Groq */
  apiKey: requireEnv('GROQ_API_KEY'),
  
  /** Modelo de visão a usar */
  model: optionalEnv('GROQ_VISION_MODEL', 'llama-3.2-90b-vision-preview'),
} as const;

// ============================================================
// VALIDAÇÃO
// ============================================================

/**
 * Valida todas as configurações obrigatórias
 * Deve ser chamado no início da aplicação (fail-fast)
 */
export function validateConfig(): void {
  // As validações já acontecem nos requireEnv() acima
  // Esta função existe para ser chamada explicitamente no startup
  
  // Validações adicionais
  if (!Number.isInteger(WHATSAPP_CONFIG.healthPort)) {
    throw new Error('HEALTH_PORT/PORT/SERVER_PORT deve ser um número inteiro válido');
  }

  if (WHATSAPP_CONFIG.healthPort < 0 || WHATSAPP_CONFIG.healthPort > 65535) {
    throw new Error('HEALTH_PORT deve estar entre 0 e 65535');
  }
  
  if (SPREADSHEET_CONFIG.nameStartRow < 1) {
    throw new Error('SHEET_NAME_START_ROW deve ser >= 1');
  }
  
  if (SPREADSHEET_CONFIG.nameEndRow < SPREADSHEET_CONFIG.nameStartRow) {
    throw new Error('SHEET_NAME_END_ROW deve ser >= SHEET_NAME_START_ROW');
  }
  
  console.log('✓ Configuração validada com sucesso');
}
