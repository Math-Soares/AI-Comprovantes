# 🤖 WhatsApp PIX Receipt Bot

Bot automatizado para receber, processar e organizar comprovantes PIX via WhatsApp, com integração ao Google Drive e Google Sheets.

## 📋 Funcionalidades

- ✅ Recebe comprovantes PIX via WhatsApp (grupos ou conversas privadas)
- 🤖 Analisa imagem com AI (Groq) para extrair nome do pagador
- 📁 Faz upload automático para Google Drive
- 📊 Atualiza Google Sheets com hyperlink para o comprovante
- ✅ Marca automaticamente a aba `Main` no mês correspondente
- 🏷️ Salva no Drive com nome automático (formato: `Nome_Mês.jpg`)
- 🔒 Previne duplicatas (Drive e Planilha)
- 🧠 Processa comprovantes em memória (sem persistir arquivo local)
- 📈 Endpoint `/health` para monitoramento
- 🐛 Modo debug para descobrir JID de grupos

## 🚀 Setup Rápido

### 1. Clone o repositório

```bash
git clone https://github.com/Math-Soares/AI-Comprovantes.git
cd AI-Comprovantes
```

### 2. Instale dependências

```bash
npm install
```

### 3. Configure variáveis de ambiente

Copie o arquivo de exemplo e configure:

```bash
cp .env.example .env
```

Edite `.env` e preencha **TODAS** as variáveis obrigatórias:

#### **Google Sheets & Drive** (obrigatório)
- `GOOGLE_SHEET_ID` - ID da planilha
- `GOOGLE_DRIVE_FOLDER_ID` - ID da pasta do Drive
- `GOOGLE_CLIENT_ID` - Credenciais OAuth2
- `GOOGLE_CLIENT_SECRET` - Credenciais OAuth2
- `GOOGLE_REFRESH_TOKEN` - Obtido via `npm run authorize-google`

#### **Groq API** (obrigatório)
- `GROQ_API_KEY` - API Key do Groq (https://console.groq.com/keys)

#### **WhatsApp** (opcional)
- `GROUP_JID` - Deixe vazio para modo debug (recomendado no primeiro uso)
- `HEALTH_PORT` - Porta do health server (padrão: 3001)

#### **Planilha** (opcional)
- `GOOGLE_MAIN_SHEET_NAME` - Nome da aba principal para marcar o mês (padrão: `Main`)

### 4. Obtenha credenciais Google OAuth2

```bash
npm run authorize-google
```

Siga as instruções no terminal. O refresh token será gerado e deve ser adicionado no `.env`.

### 5. Descubra o JID do grupo (modo debug)

Inicie o bot com `GROUP_JID` vazio:

```bash
npm run dev
```

Escaneie o QR Code, envie uma mensagem no grupo desejado, copie o `remoteJid` dos logs e adicione em `GROUP_JID` no `.env`.

### 6. Inicie o bot

```bash
npm start
```

## 📂 Estrutura do Projeto

```text
.
├── config.ts                 # Configuração centralizada
├── google-auth.ts            # Autenticação Google OAuth2
├── processPixReceipt.ts      # Lógica de negócio principal
├── planilha.ts               # Integração Google Sheets & Drive
├── read_image.ts             # Análise de imagem com AI
├── whatsapp.ts               # Bot WhatsApp (servidor principal)
├── authorize-google.ts       # Script para obter OAuth2 token
├── .env.example              # Template de configuração
└── package.json
```

## 🔧 Configuração Avançada

### Estrutura da Planilha

A planilha deve ter a seguinte estrutura:

| Coluna | Conteúdo | Exemplo |
|--------|----------|---------|
| A | Nomes dos pagadores | João Silva |
| B-L | Meses (Comp - Mês) | Comp - Janeiro, Comp - Fevereiro, ... |

Configure as linhas em `.env`:
- `SHEET_NAME_START_ROW=2` (primeira linha com nomes)
- `SHEET_NAME_END_ROW=29` (última linha com nomes)

### Separador de Fórmulas

Planilhas em **pt-BR** usam `;` (padrão), planilhas em **en-US** usam `,`:

```env
SHEETS_FORMULA_SEPARATOR=;  # pt-BR
# SHEETS_FORMULA_SEPARATOR=,  # en-US
```

## 🛠️ Scripts Disponíveis

```bash
npm run dev              # Inicia em modo desenvolvimento
npm start                # Inicia em produção
npm run readimage        # Teste manual de leitura de imagem
npm run authorize-google # Obtém OAuth2 refresh token
```

## 📊 Monitoramento

Acesse o endpoint de health check para ver métricas:

```bash
curl http://localhost:3001/health
```

## 🔐 Segurança

**NUNCA commite arquivos sensíveis:**
- ❌ `.env` (credenciais)
- ❌ `credentials/` (arquivos locais privados)
- ❌ `auth_info/` (sessão WhatsApp)
- ❌ `comprovantes/` (dados dos usuários)

O `.gitignore` já está configurado para proteger esses arquivos.

## 🐛 Troubleshooting

### Erro: #ERROR! na planilha
- Verifique `SHEETS_FORMULA_SEPARATOR` no `.env`
- Planilhas pt-BR usam `;`, en-US usam `,`

### Erro: Comprovante já existe
- Normal quando enviar duplicata
- Previne sobrescrever comprovantes existentes

### Modo debug não mostra mensagens
- Verifique se `GROUP_JID` está vazio no `.env`
- Certifique-se de enviar mensagens APÓS o bot conectar

### Erro: GOOGLE_REFRESH_TOKEN não configurado
- Execute `npm run authorize-google`
- Copie o token gerado e adicione no `.env`
