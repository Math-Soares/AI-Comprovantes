/**
 * Gerenciamento centralizado de autenticação Google OAuth2
 * Usado por authorize-google.ts e planilha.ts
 */

import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { GOOGLE_CONFIG } from "./config.js";

// Cache de autenticação (evita recriar OAuth2 client a cada chamada)
let cachedAuth: OAuth2Client | null = null;

/**
 * Cria um cliente OAuth2 para Google API
 * 
 * @param authenticated Se true, requer refresh_token e valida credenciais
 * @returns Cliente OAuth2 configurado
 */
export function createOAuth2Client(authenticated = true): OAuth2Client {
  const client = new google.auth.OAuth2(
    GOOGLE_CONFIG.clientId,
    GOOGLE_CONFIG.clientSecret,
    GOOGLE_CONFIG.redirectUri
  );

  if (authenticated) {
    if (!GOOGLE_CONFIG.refreshToken) {
      throw new Error(
        "GOOGLE_REFRESH_TOKEN não configurado. Execute: npm run authorize-google"
      );
    }
    client.setCredentials({ refresh_token: GOOGLE_CONFIG.refreshToken });
  }

  return client;
}

/**
 * Retorna cliente OAuth2 autenticado com cache
 * Chamadas subsequentes reutilizam a mesma instância
 * 
 * @returns Cliente OAuth2 autenticado e cacheado
 */
export function getAuthClient(): OAuth2Client {
  if (!cachedAuth) {
    cachedAuth = createOAuth2Client(true);
  }
  return cachedAuth;
}
