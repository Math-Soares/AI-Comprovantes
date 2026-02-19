import { readFile } from "fs/promises";
import { Groq } from "groq-sdk";
import { AI_CONFIG } from "./config.js";

const groq = new Groq({ apiKey: AI_CONFIG.apiKey });

const SYSTEM_PROMPT =
  "Você é um classificador rigoroso de comprovante PIX. " +
  "Nunca chute, nunca infira e nunca complete informações faltantes. " +
  "Se não houver evidência textual clara de comprovante PIX, responda exatamente: Não é PIX";

const USER_PROMPT =
  "Regras estritas:\n" +
  "1) Só é PIX se houver termos como 'PIX', 'Comprovante', 'Transferência', ID/Txid, valor, data\n" +
  "2) Se faltar evidência suficiente: responda 'Não é PIX'\n" +
  "3) Se for PIX válido: responda APENAS o nome do pagador/remetente\n" +
  "4) Nomes soltos sem contexto de comprovante = 'Não é PIX'\n" +
  "5) Nunca invente informações";

export async function read_image(
  imageInput: string | Buffer,
  mimeType: string = "image/jpeg"
): Promise<string> {
  try {
    const img =
      typeof imageInput === "string"
        ? await readFile(imageInput)
        : imageInput;
    const dataUrl = `data:${mimeType};base64,${img.toString("base64")}`;

    const response = await groq.chat.completions.create({
      model: AI_CONFIG.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: USER_PROMPT },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      temperature: 0,
    });

    return response.choices[0]?.message?.content?.trim() ?? "Não é PIX";
  } catch (error) {
    // Distingue entre "não é PIX" (resposta da AI) e erros reais (rede, API, arquivo)
    console.error("✗ Erro ao analisar imagem:", error);
    
    // Se for erro de rede, autenticação ou arquivo, propaga o erro
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('enoent') || msg.includes('not found')) {
        throw new Error(
          `Arquivo não encontrado: ${
            typeof imageInput === "string" ? imageInput : "[buffer-em-memoria]"
          }`
        );
      }
      if (msg.includes('api') || msg.includes('401') || msg.includes('403')) {
        throw new Error(`Erro na API Groq: ${error.message}`);
      }
      if (msg.includes('network') || msg.includes('econnrefused')) {
        throw new Error(`Erro de rede ao conectar Groq: ${error.message}`);
      }
    }
    
    // Para outros erros, assume que não é PIX
    return "Não é PIX";
  }
}