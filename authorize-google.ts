import { createServer } from 'http';
import open from 'open';
import { createOAuth2Client } from './google-auth.js';
import { GOOGLE_CONFIG } from './config.js';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

async function authorize() {
  if (!GOOGLE_CONFIG.clientId || !GOOGLE_CONFIG.clientSecret) {
    console.error('❌ GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET não configurados no .env');
    console.error('Siga as instruções em OAUTH2_SETUP.md');
    process.exit(1);
  }

  const oauth2Client = createOAuth2Client(false);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Força mostrar tela de consentimento para gerar refresh token
  });

  console.log('\n🔐 Autorização OAuth2 - Google Drive & Sheets\n');
  console.log('1. Uma página do navegador será aberta');
  console.log('2. Faça login com sua conta institucional');
  console.log('3. Clique em "Permitir"');
  console.log('4. Aguarde a confirmação...\n');

  // Cria servidor temporário para receber callback
  const server = createServer(async (req, res) => {
    if (req.url?.startsWith('/oauth2callback')) {
      const url = new URL(req.url, `http://localhost:3000`);
      const code = url.searchParams.get('code');

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>❌ Erro: código não recebido</h1>');
        server.close();
        process.exit(1);
      }

      try {
        const { tokens } = await oauth2Client.getToken(code);
        
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <h1>✅ Autorização concluída!</h1>
          <p>Você pode fechar esta janela e voltar ao terminal.</p>
        `);

        console.log('\n✅ Autorização bem-sucedida!\n');
        console.log('Adicione as seguintes linhas ao seu arquivo .env:\n');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        
        if (!tokens.refresh_token) {
          console.warn('⚠️  AVISO: refresh_token não foi gerado.');
          console.warn('Isso pode acontecer se você já autorizou antes.');
          console.warn('Solução: Revogue o acesso em https://myaccount.google.com/permissions');
          console.warn('e execute este script novamente.\n');
        }

        server.close();
        process.exit(0);
      } catch (error) {
        console.error('❌ Erro ao obter tokens:', error);
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>❌ Erro ao processar autorização</h1>');
        server.close();
        process.exit(1);
      }
    }
  });

  server.listen(3000, () => {
    console.log('Abrindo navegador...\n');
    open(authUrl).catch(() => {
      console.log('Não foi possível abrir o navegador automaticamente.');
      console.log('Acesse manualmente esta URL:\n');
      console.log(authUrl);
      console.log();
    });
  });
}

authorize();
