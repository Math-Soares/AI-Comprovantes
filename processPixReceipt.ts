/**
 * Lógica de negócio centralizada para processamento de comprovantes PIX
 * Orquestra: análise de imagem → upload → renomeação → atualização planilha
 */

import { read_image } from "./read_image.js";
import { planilha } from "./planilha.js";

// ============================================================
// TIPOS
// ============================================================

interface ProcessResult {
  success: boolean;
  reason?: 'not-pix' | 'error';
  error?: string;
  nome?: string;
  mes?: string;
  fileName?: string;
}

interface PixReceiptInput {
  imageBuffer: Buffer;
  extension: string;
  mimeType?: string;
}

// ============================================================
// UTILITÁRIOS
// ============================================================

/**
 * Retorna o nome do mês atual em português capitalizado
 * Ex: "Janeiro", "Fevereiro", "Março"
 */
function getCurrentMonthName(): string {
  const mes = new Date()
    .toLocaleString('pt-BR', { month: 'long' })
    .replace(/^\w/, (c) => c.toUpperCase());
  return mes;
}

/**
 * Capitaliza um nome (primeira letra de cada palavra em maiúscula)
 * Ex: "JOÃO SILVA" → "João Silva"
 *     "maria santos" → "Maria Santos"
 *     "JOSÉ DE SOUZA" → "José De Souza"
 */
function capitalizeName(name: string): string {
  return name
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ============================================================
// PROCESSAMENTO
// ============================================================

/**
 * Processa um comprovante PIX recebido via WhatsApp
 * 
 * Fluxo:
 * 1. Analisa imagem com AI para extrair nome do pagador
 * 2. Se não for PIX, retorna early
 * 3. Capitaliza o nome (primeira letra de cada palavra em maiúscula)
 * 4. Calcula nome formatado (ex: João_Fev.jpg)
 * 5. Faz upload para Drive direto da memória com nome formatado
 * 6. Atualiza planilha com hyperlink para arquivo formatado
 * 
 * @param input Imagem em memória e metadados
 * @returns Resultado do processamento com status e detalhes
 */
export async function processPixReceipt(
  input: PixReceiptInput
): Promise<ProcessResult> {
  try {
    // Passo 1: Analisa imagem com AI
    const nome = await read_image(input.imageBuffer, input.mimeType ?? "image/jpeg");
    
    if (nome === "Não é PIX") {
      return { 
        success: false, 
        reason: 'not-pix' 
      };
    }

    // Passo 2: Capitaliza o nome (primeira letra de cada palavra em maiúscula)
    const nomeCapitalizado = capitalizeName(nome);

    // Passo 3: Obtém mês atual
    const mes = getCurrentMonthName();

    // Passo 4: Calcula nome formatado do arquivo
    const primeiroNome = nomeCapitalizado.split(" ")[0];
    const mesAbrev = mes.slice(0, 3);
    const ext = input.extension.startsWith(".") ? input.extension : `.${input.extension}`;
    const nomeFormatado = `${primeiroNome}_${mesAbrev}${ext}`;

    // Passo 5: Upload para Drive e atualiza planilha com nome formatado
    await planilha(nomeCapitalizado, {
      fileName: nomeFormatado,
      buffer: input.imageBuffer,
      mimeType: input.mimeType ?? "image/jpeg",
    }, mes);

    return {
      success: true,
      nome: nomeCapitalizado,
      mes,
      fileName: nomeFormatado,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    return {
      success: false,
      reason: 'error',
      error: errorMessage,
    };
  }
}
