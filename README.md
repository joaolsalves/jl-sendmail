# Email API

API REST segura para envio de e-mails transacionais via SMTP da Hostinger.

**Stack:** Next.js 14 · TypeScript · MySQL · Prisma ORM · Nodemailer · Zod

---

## Sumário

- [Instalação](#instalação)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Banco de dados](#banco-de-dados)
- [Executar localmente](#executar-localmente)
- [Endpoints](#endpoints)
- [Autenticação](#autenticação)
- [Erros](#erros)
- [Rate Limiting](#rate-limiting)
- [Restrições V1](#restrições-v1)
- [Deploy na Hostinger](#deploy-na-hostinger)
- [Testes](#testes)

---

## Instalação

```bash
git clone https://github.com/seu-usuario/email-api.git
cd email-api
npm install
```

---

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha todos os valores:

```bash
cp .env.example .env
```

| Variável          | Obrigatória | Tipo    | Descrição                                                        | Exemplo                                  |
|-------------------|-------------|---------|------------------------------------------------------------------|------------------------------------------|
| `DATABASE_URL`    | ✅           | string  | Connection string MySQL. Use `%23` para `#` na senha.           | `mysql://user:pass%23@localhost:3306/db` |
| `SMTP_HOST`       | ✅           | string  | Servidor SMTP                                                    | `smtp.hostinger.com`                     |
| `SMTP_PORT`       | ✅           | number  | Porta SMTP (465 = SSL, 587 = STARTTLS)                          | `465`                                    |
| `SMTP_USER`       | ✅           | string  | Usuário SMTP (e-mail completo)                                   | `no-reply@seudominio.com.br`             |
| `SMTP_PASS`       | ✅           | string  | Senha SMTP                                                       | `sua-senha`                              |
| `SMTP_FROM`       | ✅           | string  | Endereço remetente (deve coincidir com `SMTP_USER` na Hostinger) | `no-reply@seudominio.com.br`             |
| `ADMIN_API_KEY`   | ✅           | string  | Chave administrativa. Mínimo 32 chars. Gere com o comando abaixo | —                                        |
| `ALLOWED_ORIGINS` | ✅           | string  | Origens CORS permitidas, separadas por vírgula                   | `https://seudominio.com.br`              |
| `PORT`            | ❌           | number  | Porta HTTP (padrão: `3000`)                                      | `3000`                                   |

**Gerar ADMIN_API_KEY segura:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Banco de dados

### Criar banco MySQL

```sql
CREATE DATABASE db_sendmail CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'emailapi'@'localhost' IDENTIFIED BY 'senha-segura';
GRANT ALL PRIVILEGES ON db_sendmail.* TO 'emailapi'@'localhost';
FLUSH PRIVILEGES;
```

### Executar migration

```bash
# Desenvolvimento
npm run prisma:migrate

# Produção
npm run prisma:deploy
```

### Gerar Prisma Client após mudanças no schema

```bash
npm run prisma:generate
```

---

## Executar localmente

```bash
npm run dev
```

Acesse `http://localhost:3000`.

---

## Endpoints

### `GET /api/health`

Verifica disponibilidade da API. Sem autenticação.

**Response 200:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "1.0.0"
}
```

---

### `POST /api/v1/email/send`

Envia um e-mail transacional.

**Headers:**
```
Authorization: Bearer SUA_API_KEY
Content-Type: application/json
```

**Body:**
```json
{
  "to": "cliente@exemplo.com",
  "subject": "Mensagem de teste",
  "html": "<h1>Olá!</h1><p>Esta é uma mensagem.</p>",
  "text": "Olá! Esta é uma mensagem.",
  "replyTo": "responder@exemplo.com"
}
```

| Campo     | Obrigatório | Tipo   | Limite         |
|-----------|-------------|--------|----------------|
| `to`      | ✅           | email  | máx. 254 chars |
| `subject` | ✅           | string | 1–255 chars    |
| `html`    | ❌*          | string | máx. 50.000 chars |
| `text`    | ❌*          | string | máx. 10.000 chars |
| `replyTo` | ❌           | email  | —              |

*Pelo menos um de `html` ou `text` é obrigatório.

**Response 200 (sucesso):**
```json
{
  "success": true,
  "messageId": "<uuid@smtp.hostinger.com>",
  "logId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response 401 (sem autenticação):**
```json
{ "success": false, "error": { "code": "UNAUTHORIZED", "message": "Authorization header is required" } }
```

**Response 403 (chave desativada):**
```json
{ "success": false, "error": { "code": "KEY_DISABLED", "message": "API key is disabled" } }
```

**Response 403 (chave expirada):**
```json
{ "success": false, "error": { "code": "KEY_EXPIRED", "message": "API key has expired" } }
```

**Response 422 (validação):**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "fields": { "to": "Invalid email address" }
  }
}
```

**Response 429 (rate limit):**
```json
{
  "success": false,
  "error": { "code": "RATE_LIMIT_EXCEEDED", "message": "Rate limit exceeded. Please retry after the indicated time.", "retryAfter": 45 }
}
```

**Response 502 (falha SMTP):**
```json
{ "success": false, "error": { "code": "EMAIL_DELIVERY_FAILED", "message": "Failed to send email" } }
```

---

### `GET /api/v1/email/logs`

Lista os logs de e-mail da API Key autenticada.

**Headers:**
```
Authorization: Bearer SUA_API_KEY
```

**Query params:**

| Param   | Padrão | Tipo | Limite   |
|---------|--------|------|----------|
| `page`  | `1`    | int  | ≥ 1      |
| `limit` | `20`   | int  | 1–100    |

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "550e8400-...",
      "apiKeyId": "...",
      "recipient": "cliente@exemplo.com",
      "subject": "Mensagem de teste",
      "status": "SENT",
      "messageId": "<uuid@smtp.hostinger.com>",
      "ipAddress": "192.168.1.1",
      "errorMessage": null,
      "createdAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

---

### `GET /api/v1/email/logs/:id`

Retorna um log específico da API Key autenticada.

**Response 200:**
```json
{ "success": true, "data": { ... } }
```

**Response 404:**
```json
{ "success": false, "error": { "code": "NOT_FOUND", "message": "Log not found" } }
```

---

### `POST /api/v1/api-keys` *(Admin)*

Cria uma nova API Key.

**Headers:**
```
Authorization: Bearer ADMIN_API_KEY
Content-Type: application/json
```

**Body:**
```json
{
  "name": "Site Pontual Engenharia",
  "expiresAt": "2025-12-31T23:59:59.000Z"
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-...",
    "name": "Site Pontual Engenharia",
    "key": "a1b2c3d4e5f6...",
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

> ⚠️ A chave (`key`) é exibida **somente neste momento**. Guarde-a com segurança.

---

### `GET /api/v1/api-keys` *(Admin)*

Lista todas as API Keys (sem expor o hash).

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "name": "Site Pontual Engenharia",
      "active": true,
      "createdAt": "...",
      "updatedAt": "...",
      "lastUsedAt": "...",
      "expiresAt": null
    }
  ]
}
```

---

### `DELETE /api/v1/api-keys/:id` *(Admin)*

Revoga (desativa) uma API Key. Operação idempotente.

**Response 200:**
```json
{ "success": true, "data": { "id": "...", "active": false } }
```

**Response 404:**
```json
{ "success": false, "error": { "code": "NOT_FOUND", "message": "API key not found" } }
```

---

## Autenticação

Todas as requisições aos endpoints `/api/v1/email/*` requerem:

```
Authorization: Bearer SUA_API_KEY
```

Os endpoints `/api/v1/api-keys/*` requerem:

```
Authorization: Bearer ADMIN_API_KEY
```

---

## Erros

| HTTP | Código                   | Descrição                              |
|------|--------------------------|----------------------------------------|
| 400  | `INVALID_REQUEST`        | JSON inválido ou campo proibido        |
| 400  | `FORBIDDEN_FIELD`        | Campo não permitido na V1 (cc, bcc...) |
| 401  | `UNAUTHORIZED`           | Token ausente ou formato inválido      |
| 401  | `INVALID_CREDENTIALS`    | Token não corresponde a nenhuma chave  |
| 403  | `KEY_DISABLED`           | API Key desativada                     |
| 403  | `KEY_EXPIRED`            | API Key expirada                       |
| 403  | `ADMIN_FORBIDDEN`        | Admin token inválido                   |
| 403  | `CORS_FORBIDDEN`         | Origem não permitida                   |
| 404  | `NOT_FOUND`              | Recurso não encontrado                 |
| 413  | `PAYLOAD_TOO_LARGE`      | Body excede 100 KB                     |
| 415  | `UNSUPPORTED_MEDIA_TYPE` | Content-Type diferente de application/json |
| 422  | `VALIDATION_ERROR`       | Campos inválidos                       |
| 429  | `RATE_LIMIT_EXCEEDED`    | Limite de requisições excedido         |
| 500  | `INTERNAL_ERROR`         | Erro interno do servidor               |
| 502  | `EMAIL_DELIVERY_FAILED`  | Falha no envio SMTP                    |
| 503  | `SERVICE_UNAVAILABLE`    | Banco de dados temporariamente indisponível |

---

## Rate Limiting

- **Limite:** 30 requisições por minuto por API Key
- **Janela:** fixa de 60 segundos
- **Headers de resposta:**

```
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 25
X-RateLimit-Reset: 1705312260
```

Quando excedido:
```
HTTP 429
Retry-After: 45
```

---

## Restrições V1

Esta versão **não suporta**:
- Múltiplos destinatários
- CC ou BCC
- Anexos
- Campo `from` definido pelo cliente
- Templates de e-mail
- Agendamento de envios

---

## Exemplos de uso

### cURL

```bash
# Enviar e-mail
curl -X POST https://api.seudominio.com.br/api/v1/email/send \
  -H "Authorization: Bearer SUA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "cliente@exemplo.com",
    "subject": "Teste",
    "html": "<h1>Olá</h1><p>Teste de envio.</p>"
  }'

# Criar API Key
curl -X POST https://api.seudominio.com.br/api/v1/api-keys \
  -H "Authorization: Bearer ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Meu Sistema" }'

# Health check
curl https://api.seudominio.com.br/api/health
```

### JavaScript (fetch)

```javascript
const response = await fetch('https://api.seudominio.com.br/api/v1/email/send', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    to: 'cliente@exemplo.com',
    subject: 'Teste',
    html: '<h1>Olá</h1>',
  }),
})

const data = await response.json()
```

---

## Deploy na Hostinger

### 1. Preparar banco MySQL

No painel da Hostinger, crie um banco de dados MySQL e um usuário com permissões completas.

### 2. Criar conta de e-mail

No painel Hostinger, crie a conta `no-reply@seudominio.com.br` e anote as credenciais SMTP:
- Host: `smtp.hostinger.com`
- Porta: `465` (SSL)

### 3. Configurar variáveis de ambiente

Crie o arquivo `.env` no servidor (NÃO versionar):
```bash
DATABASE_URL="mysql://user:senha%40@localhost:3306/db_sendmail"
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=no-reply@seudominio.com.br
SMTP_PASS=sua-senha
SMTP_FROM=no-reply@seudominio.com.br
ADMIN_API_KEY=gere-com-node-crypto-randombytes
ALLOWED_ORIGINS=https://seudominio.com.br
```

### 4. Instalar dependências e fazer build

```bash
npm install
npm run prisma:deploy
npm run build
```

### 5. Iniciar com PM2

```bash
npm install -g pm2
pm2 start npm --name "email-api" -- start
pm2 save
pm2 startup
```

### 6. Configurar Nginx (reverse proxy)

```nginx
server {
    listen 80;
    server_name api.seudominio.com.br;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name api.seudominio.com.br;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
    }
}
```

### 7. Verificar

```bash
curl https://api.seudominio.com.br/api/health
```

### 8. Limpeza periódica de rate limits (cron)

```sql
-- Executar via cron diariamente
DELETE FROM rate_limits WHERE window_start < DATE_SUB(NOW(), INTERVAL 1 HOUR);
```

---

## Testes

```bash
# Todos os testes
npm test

# Somente unitários
npm run test:unit

# Somente property-based
npm run test:property

# Com cobertura
npx vitest run --coverage
```
