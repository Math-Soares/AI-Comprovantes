/**
 * WhatsApp Bot para recebimento automático de comprovantes PIX
 * Versão simplificada focada em uso pessoal/pequenas equipes
 */

import {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
  isJidStatusBroadcast,
  isJidBroadcast,
  type ConnectionState,
  type WAMessage,
  type MessageUpsertType,
  type proto,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { createServer, type Server } from "http";
import { mkdirSync } from "fs";
import { processPixReceipt } from "./processPixReceipt.js";
import { validateConfig, WHATSAPP_CONFIG } from "./config.js";

// ============================================================
// VALIDAÇÃO INICIAL
// ============================================================

validateConfig();

// ============================================================
// CONSTANTES
// ============================================================

/** Código de status 515 = restart de stream do WhatsApp */
const STREAM_RESTART_CODE = 515;

/** Tipos de mensagem que devem ser ignorados no processamento */
const IGNORED_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  "protocolMessage",
  "reactionMessage",
  "pollUpdateMessage",
  "senderKeyDistributionMessage",
]);

/** Chaves do objeto de mensagem que não representam o tipo real */
const IGNORED_MESSAGE_KEYS: ReadonlySet<string> = new Set([
  "contextInfo",
  "senderKeyDistributionMessage",
  "messageContextInfo",
]);

// ============================================================
// TIPOS
// ============================================================

type WASocketInstance = ReturnType<typeof makeWASocket>;

interface AppMetrics {
  messagesReceived: number;
  messagesProcessed: number;
  errors: number;
  reconnections: number;
  startedAt: number;
  connected: boolean;
}

// ============================================================
// LOGGER
// ============================================================

const logger = pino({
  level: WHATSAPP_CONFIG.logLevel,
  ...(process.env.NODE_ENV !== "production"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});

const baileysLogger = pino({ level: "silent" });

// ============================================================
// MÉTRICAS
// ============================================================

const metrics: AppMetrics = {
  messagesReceived: 0,
  messagesProcessed: 0,
  errors: 0,
  reconnections: 0,
  startedAt: Date.now(),
  connected: false,
};

// ============================================================
// QR CODE STATE
// ============================================================

let currentQRCodeUrl: string | null = null;

function getUptimeSeconds(): number {
  return Math.floor((Date.now() - metrics.startedAt) / 1000);
}

function formatMetrics(): object {
  const uptime = getUptimeSeconds();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = uptime % 60;

  return {
    status: metrics.connected ? "connected" : "disconnected",
    uptime: `${hours}h ${minutes}m ${seconds}s`,
    uptimeSeconds: uptime,
    messagesReceived: metrics.messagesReceived,
    messagesProcessed: metrics.messagesProcessed,
    errors: metrics.errors,
    reconnections: metrics.reconnections,
  };
}

// ============================================================
// UTILITÁRIOS
// ============================================================

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function toUnixTimestamp(ts: WAMessage["messageTimestamp"]): number {
  if (ts == null) return 0;
  if (typeof ts === "number") return ts;

  if (typeof ts === "object" && "toNumber" in ts) {
    try {
      return (ts as { toNumber(): number }).toNumber();
    } catch {
      return 0;
    }
  }

  const num = Number(ts);
  return Number.isFinite(num) ? num : 0;
}

function shouldIgnoreJid(jid: string | null | undefined): boolean {
  if (!jid || typeof jid !== "string" || jid.length < 5) return true;

  if (jid === "status@broadcast") return true;
  if (jid.endsWith("@newsletter")) return true;

  try {
    if (typeof isJidBroadcast === "function" && isJidBroadcast(jid)) {
      return true;
    }
    if (
      typeof isJidStatusBroadcast === "function" &&
      isJidStatusBroadcast(jid)
    ) {
      return true;
    }
  } catch {
    if (jid.endsWith("@broadcast")) return true;
  }

  return false;
}

function extractImageMessage(
  message: proto.IMessage | null | undefined
): proto.Message.IImageMessage | undefined {
  if (!message) return undefined;

  const image =
    message.imageMessage ??
    message.ephemeralMessage?.message?.imageMessage ??
    message.viewOnceMessage?.message?.imageMessage ??
    message.viewOnceMessageV2?.message?.imageMessage ??
    message.viewOnceMessageV2Extension?.message?.imageMessage;

  return image ?? undefined;
}

function extensionFromMime(mimeType: string | null | undefined): string {
  if (!mimeType) return "jpg";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  return "jpg";
}

function getMessageType(message: proto.IMessage | null | undefined): string {
  if (!message) return "unknown";
  const type = Object.keys(message).find(
    (k) => !IGNORED_MESSAGE_KEYS.has(k)
  );
  return type ?? "unknown";
}

// ============================================================
// DOWNLOAD DE IMAGEM
// ============================================================

async function saveIncomingImage(
  sock: WASocketInstance,
  msg: WAMessage
): Promise<
  | {
      buffer: Buffer;
      mimeType: string;
      extension: string;
    }
  | null
> {
  const imageMessage = extractImageMessage(msg.message);
  if (!imageMessage) return null;

  const mediaBuffer = await downloadMediaMessage(
    msg,
    "buffer",
    {},
    {
      logger: baileysLogger,
      reuploadRequest: sock.updateMediaMessage,
    }
  );

  if (!mediaBuffer || mediaBuffer.length === 0) {
    throw new Error("Download da imagem retornou vazio");
  }

  const remoteJid = msg.key.remoteJid ?? "desconhecido";
  const safeJid = remoteJid.replace(/[^a-zA-Z0-9@._-]/g, "_");
  const extension = extensionFromMime(imageMessage.mimetype);
  const mimeType = imageMessage.mimetype ?? "image/jpeg";

  logger.info(
    {
      source: "memory",
      sender: safeJid,
      bytes: mediaBuffer.length,
      mimeType,
    },
    "Imagem recebida (buffer em memória)"
  );

  return {
    buffer: mediaBuffer,
    mimeType,
    extension,
  };
}

// ============================================================
// HANDLER DE MENSAGENS
// ============================================================

async function handleMessage(
  sock: WASocketInstance,
  msg: WAMessage,
  startTime: number
): Promise<void> {
  metrics.messagesReceived++;

  // Filtros rápidos
  if (msg.key.fromMe) return;
  if (!msg.message) return;

  const msgTime = toUnixTimestamp(msg.messageTimestamp);
  if (msgTime > 0 && msgTime < startTime) return;

  const msgType = getMessageType(msg.message);
  if (IGNORED_MESSAGE_TYPES.has(msgType)) return;
  if (shouldIgnoreJid(msg.key.remoteJid)) return;

  const remoteJid = msg.key.remoteJid ?? "";
  const isGroup = remoteJid.endsWith("@g.us");

  // MODO DEBUG: Se GROUP_JID não está configurado, mostra todos os JIDs
  if (!WHATSAPP_CONFIG.groupJid) {
    logger.info(
      {
        remoteJid,
        type: isGroup ? "GRUPO" : "PRIVADO",
        pushName: msg.pushName ?? "Desconhecido",
      },
      "🔍 [DEBUG] Mensagem recebida - copie o remoteJid acima e coloque em GROUP_JID no .env"
    );
    // No modo debug, não processa nada, apenas mostra os JIDs
    return;
  }

  // Filtro por grupo específico (se configurado)
  if (remoteJid !== WHATSAPP_CONFIG.groupJid) {
    logger.debug(
      { remoteJid, expected: WHATSAPP_CONFIG.groupJid },
      "Mensagem de outro grupo/conversa ignorada"
    );
    return;
  }

  const pushName = msg.pushName ?? "Desconhecido";
  const sender = isGroup ? (msg.key.participant ?? "Desconhecido") : remoteJid;

  logger.info(
    {
      from: pushName,
      sender,
      type: msgType,
      group: isGroup,
    },
    "Processando mensagem"
  );

  try {
    const imageData = await saveIncomingImage(sock, msg);
    if (!imageData) {
      logger.debug("Mensagem não contém imagem");
      return;
    }

    const result = await processPixReceipt({
      imageBuffer: imageData.buffer,
      extension: imageData.extension,
      mimeType: imageData.mimeType,
    });

    if (!result.success) {
      if (result.reason === "not-pix") {
        logger.info({ sender, pushName }, "Imagem não é comprovante PIX");
      } else {
        metrics.errors++;
        logger.error(
          { sender, error: result.error },
          "Erro ao processar comprovante"
        );
      }
      return;
    }

    metrics.messagesProcessed++;
    logger.info(
      {
        sender,
        pushName,
        nome: result.nome,
        mes: result.mes,
        fileName: result.fileName,
      },
      "✓ Comprovante processado com sucesso"
    );
  } catch (err: unknown) {
    metrics.errors++;
    logger.error(
      {
        sender,
        error: getErrorMessage(err),
      },
      "Falha ao processar mensagem"
    );
  }
}

// ============================================================
// RECONEXÃO
// ============================================================

function handleConnectionUpdate(
  update: Partial<ConnectionState>,
  scheduleReconnect: () => void,
  reconnectState: { attempts: number }
): void {
  const { connection, lastDisconnect, qr } = update;

  if (qr) {
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=${encodeURIComponent(
      qr
    )}`;

    currentQRCodeUrl = qrImageUrl;
    logger.info("Escaneie o QR Code para conectar");
    logger.info({ qrImageUrl }, "Abra esta URL para visualizar o QR em imagem");
    qrcode.generate(qr, { small: true });
  }

  if (connection === "open") {
    reconnectState.attempts = 0;
    metrics.connected = true;
    currentQRCodeUrl = null;
    logger.info("Conectado com sucesso ao WhatsApp");
  }

  if (connection === "close") {
    metrics.connected = false;

    const statusCode = extractDisconnectStatusCode(lastDisconnect);

    if (statusCode === DisconnectReason.loggedOut) {
      logger.fatal(
        { authFolder: WHATSAPP_CONFIG.authFolder },
        "Sessão encerrada (logout). Delete a pasta de auth e escaneie novamente."
      );
      process.exit(1);
    }

    reconnectState.attempts++;
    metrics.reconnections++;

    if (reconnectState.attempts > WHATSAPP_CONFIG.maxReconnectAttempts) {
      logger.fatal(
        { maxAttempts: WHATSAPP_CONFIG.maxReconnectAttempts },
        "Limite de tentativas de reconexão atingido. Encerrando."
      );
      process.exit(1);
    }

    const reason =
      statusCode === STREAM_RESTART_CODE
        ? "restart de stream (normal)"
        : `código ${statusCode}`;

    logger.warn(
      {
        delayMs: WHATSAPP_CONFIG.reconnectDelayMs,
        attempt: reconnectState.attempts,
        maxAttempts: WHATSAPP_CONFIG.maxReconnectAttempts,
        reason,
      },
      "Reconectando..."
    );

    scheduleReconnect();
  }
}

function extractDisconnectStatusCode(
  lastDisconnect: ConnectionState["lastDisconnect"]
): number {
  const lastError = lastDisconnect?.error;
  if (!lastError || typeof lastError !== "object") return 0;

  const boomError = lastError as {
    output?: { statusCode?: number };
    statusCode?: number;
  };

  return boomError.output?.statusCode ?? boomError.statusCode ?? 0;
}

// ============================================================
// HEALTH CHECK SERVER
// ============================================================

function createHealthServer(): Server {
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      const body = JSON.stringify(formatMetrics(), null, 2);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      });
      res.end(body);
    } else if (req.url === "/qr") {
      if (currentQRCodeUrl) {
        res.writeHead(200, {
          "Content-Type": "text/html",
          "Cache-Control": "no-cache",
        });
        res.end(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>WhatsApp QR Code</title></head>
<body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#111;font-family:sans-serif;">
<div style="text-align:center;">
<h1 style="color:#fff;margin-bottom:20px;">Escaneie o QR Code com WhatsApp</h1>
<img src="${currentQRCodeUrl}" alt="QR Code" style="max-width:360px;border:8px solid #fff;border-radius:12px;"/>
<p style="color:#aaa;margin-top:20px;">Abra o WhatsApp → Configurações → Aparelhos Conectados → Conectar aparelho</p>
</div></body></html>`);
      } else if (metrics.connected) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>WhatsApp Conectado</title></head>
<body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#0d4d3d;font-family:sans-serif;">
<div style="text-align:center;color:#fff;">
<h1 style="font-size:48px;margin-bottom:10px;">✅</h1>
<h2>WhatsApp Conectado!</h2>
<p style="color:#ccc;">O bot está funcionando normalmente.</p>
</div></body></html>`);
      } else {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>Aguardando QR Code</title></head>
<body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#1a1a1a;font-family:sans-serif;">
<div style="text-align:center;color:#fff;">
<h2>Aguardando QR Code...</h2>
<p style="color:#aaa;">A página será atualizada automaticamente.</p>
</div></body></html>`);
      }
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found\nAvailable: /health, /qr\n");
    }
  });

  server.on("error", (err: Error) => {
    logger.error({ error: err.message }, "Erro no servidor HTTP");
  });

  return server;
}

// ============================================================
// LOOP PRINCIPAL
// ============================================================

async function startWhatsApp(): Promise<void> {
  const reconnectState = { attempts: 0 };
  const startTime = Math.floor(Date.now() / 1000);

  let currentSock: WASocketInstance | null = null;
  let isShuttingDown = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let healthServer: Server | null = null;

  function scheduleReconnect(): void {
    if (isShuttingDown || reconnectTimer !== null) return;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect().catch((err: unknown) => {
        metrics.errors++;
        logger.error({ error: getErrorMessage(err) }, "Falha ao reconectar");
      });
    }, WHATSAPP_CONFIG.reconnectDelayMs);

    reconnectTimer.unref();
  }

  // Inicia health server se porta configurada
  if (WHATSAPP_CONFIG.healthPort > 0) {
    healthServer = createHealthServer();
    healthServer.listen(
      WHATSAPP_CONFIG.healthPort,
      WHATSAPP_CONFIG.healthHost,
      () => {
        logger.info(
          {
            healthUrl: `http://${WHATSAPP_CONFIG.healthHost}:${WHATSAPP_CONFIG.healthPort}/health`,
          },
          "Health check server iniciado"
        );
      }
    );
  }

  async function connect(): Promise<void> {
    if (isShuttingDown) return;

    // Fecha socket anterior se existir
    if (currentSock) {
      try {
        currentSock.end(new Error("Reconnecting"));
      } catch {
        // Ignora
      }
      currentSock = null;
    }

    logger.info("Iniciando conexão WhatsApp...");

    // Aviso sobre modo debug
    if (!WHATSAPP_CONFIG.groupJid) {
      logger.warn(
        "⚠️  GROUP_JID não configurado - MODO DEBUG ATIVADO"
      );
      logger.warn(
        "📋 Envie qualquer mensagem em um grupo/conversa e o JID será mostrado nos logs"
      );
      logger.warn(
        "📝 Copie o 'remoteJid' do grupo desejado e cole em GROUP_JID no arquivo .env"
      );
    } else {
      logger.info(
        { groupJid: WHATSAPP_CONFIG.groupJid },
        "✓ Monitorando grupo específico"
      );
    }

    mkdirSync(WHATSAPP_CONFIG.authFolder, { recursive: true });
    const { state: authState, saveCreds } = await useMultiFileAuthState(
      WHATSAPP_CONFIG.authFolder
    );

    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.info({ version: version.join("."), isLatest }, "Versão do Baileys");

    const sock = makeWASocket({
      version,
      logger: baileysLogger,
      printQRInTerminal: false,
      auth: {
        creds: authState.creds,
        keys: makeCacheableSignalKeyStore(authState.keys, baileysLogger),
      },
      generateHighQualityLinkPreview: true,
      shouldIgnoreJid,
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    currentSock = sock;

    sock.ev.on("connection.update", (update: Partial<ConnectionState>) => {
      handleConnectionUpdate(update, scheduleReconnect, reconnectState);
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on(
      "messages.upsert",
      async ({
        messages,
        type,
      }: {
        messages: WAMessage[];
        type: MessageUpsertType;
      }) => {
        if (type !== "notify" && type !== "append") return;

        for (const msg of messages) {
          try {
            await handleMessage(sock, msg, startTime);
          } catch (err: unknown) {
            metrics.errors++;
            logger.error(
              { error: getErrorMessage(err) },
              "Erro ao processar mensagem"
            );
          }
        }
      }
    );
  }

  // Graceful Shutdown
  function shutdown(): void {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info("Encerrando aplicação...");
    logger.info(formatMetrics(), "Métricas finais");

    if (currentSock) {
      try {
        currentSock.end(new Error("Shutting down"));
      } catch {
        // Ignora
      }
    }

    if (reconnectTimer) clearTimeout(reconnectTimer);

    if (healthServer) {
      healthServer.close((err) => {
        if (err) {
          logger.error({ error: err.message }, "Erro ao fechar health server");
        }
        process.exit(0);
      });

      setTimeout(() => process.exit(0), 5_000).unref();
    } else {
      process.exit(0);
    }
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await connect();
}

// ============================================================
// ENTRY POINT
// ============================================================

startWhatsApp().catch((err: unknown) => {
  logger.fatal({ error: getErrorMessage(err) }, "Erro fatal na inicialização");
  process.exit(1);
});

process.on("uncaughtException", (err: Error) => {
  logger.fatal(
    { error: err.message, stack: err.stack },
    "Exceção não tratada — encerrando processo"
  );
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown) => {
  logger.error(
    { error: getErrorMessage(reason) },
    "Promise rejeitada sem tratamento"
  );
});
