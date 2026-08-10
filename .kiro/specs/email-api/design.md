# Design Document: email-api

## Overview

A **email-api** é uma API REST transacional construída com Next.js 14 (App Router) e TypeScript, responsável por enviar e-mails via SMTP da Hostinger, gerenciar API Keys e registrar logs de envio em banco MySQL através do Prisma ORM.

O sistema é projetado para ser simples, seguro e operável na infraestrutura compartilhada da Hostinger (sem Redis, sem serviços externos de cache), com rate limiting persistido no próprio MySQL. O escopo da V1 cobre um único destinatário por envio, sem anexos, CC ou BCC.

### Objetivos de Design

- **Segurança em camadas**: autenticação → rate limit → validação → envio → log
- **Sem estado local**: contadores de rate limit no MySQL para suportar múltiplas instâncias
- **Erros seguros**: nunca expor stack traces, caminhos de arquivo ou mensagens internas do SMTP
- **Configuração por ambiente**: todas as credenciais via variáveis de ambiente com validação na inicialização

---

## Architecture

### Diagrama de Componentes

```mermaid
graph TD
    Client["Cliente HTTP"]

    subgraph "Next.js App Router"
        MW["middleware.ts\n(Security Headers, CORS, Content-Type, Body Size)"]
        
        subgraph "Route Handlers /api/v1"
            R_SEND["POST /email/send"]
            R_LOGS["GET /email/logs"]
            R_LOG_ID["GET /email/logs/:id"]
            R_KEYS["GET/POST /api-keys"]
            R_KEY_ID["DELETE /api-keys/:id"]
        end
        
        R_HEALTH["GET /api/health"]
    end

    subgraph "src/lib (Infraestrutura)"
        AUTH["auth.ts\nAuth_Middleware\nAdmin_Auth_Middleware"]
        RL["rate-limit.ts\nRate_Limiter"]
        MAILER["mailer.ts\nNodmailer Transport"]
        PRISMA["prisma.ts\nPrisma Client Singleton"]
        ENV["env.ts\nValidação de Env Vars"]
    end

    subgraph "src/services"
        ES["email.service.ts\nEmail_Service + Log_Service"]
        AKS["api-key.service.ts\nAPI_Key_Service"]
    end

    subgraph "src/validators"
        EV["email.validator.ts\nZod schemas"]
        AKV["api-key.validator.ts\nZod schemas"]
    end

    subgraph "MySQL (Prisma)"
        DB_AK[("ApiKey")]
        DB_RL[("RateLimit")]
        DB_LOG[("EmailLog")]
    end

    Client --> MW
    MW --> R_SEND & R_LOGS & R_LOG_ID & R_KEYS & R_KEY_ID & R_HEALTH
    R_SEND --> AUTH --> RL --> EV --> ES
    R_LOGS & R_LOG_ID --> AUTH --> ES
    R_KEYS & R_KEY_ID --> AUTH --> AKV --> AKS
    ES --> MAILER
    ES --> PRISMA
    AKS --> PRISMA
    RL --> PRISMA
    AUTH --> PRISMA
    PRISMA --> DB_AK & DB_RL & DB_LOG
    ENV --> MAILER & PRISMA
```

### Fluxo de Requisição: POST /api/v1/email/send

```mermaid
sequenceDiagram
    participant C as Cliente
    participant MW as Security MW
    participant A as Auth MW
    participant RL as Rate Limiter
    participant V as Validator
    participant ES as Email Service
    participant SMTP as SMTP Hostinger
    participant DB as MySQL

    C->>MW: POST /api/v1/email/send
    MW-->>C: 403 se origem não permitida (CORS — verificado primeiro)
    MW-->>C: 415 se Content-Type != application/json
    MW-->>C: 413 se body > 100KB (verificado por último)
    MW->>A: encaminha requisição
    A->>DB: SELECT ApiKey WHERE keyHash = sha256(token)
    DB-->>A: ApiKey ou null
    A-->>C: 401 se token ausente/inválido
    A-->>C: 403 se inactive ou expirada
    A-->>C: 503 se DB indisponível
    A->>DB: UPDATE ApiKey SET lastUsedAt = now()
    A->>RL: passa apiKeyId
    RL->>DB: SELECT/UPSERT RateLimit WHERE apiKeyId
    RL-->>C: 429 + Retry-After se excedeu limite
    RL->>V: passa body validado
    V-->>C: 422 se campos inválidos/ausentes
    V-->>C: 400 se campos proibidos (cc, bcc, from)
    V->>ES: EmailPayload validado
    ES->>SMTP: sendMail (30s timeout)
    SMTP-->>ES: messageId ou erro
    ES->>DB: INSERT EmailLog (SENT ou FAILED)
    ES-->>C: 200 {success, messageId, logId} ou 502
```

---

## Components and Interfaces

### `src/lib/env.ts` — Validação de Variáveis de Ambiente

Executado uma única vez na inicialização. Usa Zod para validar todas as env vars obrigatórias. Se qualquer variável estiver ausente, encerra o processo com `process.exit(1)` e registra no stderr.

```typescript
// Contrato público
export interface AppConfig {
  database: { url: string }
  smtp: { host: string; port: number; user: string; pass: string; from: string }
  auth: { adminApiKey: string }
  cors: { allowedOrigins: string[] }
  server: { port: number }
}

export function loadConfig(): AppConfig  // lança se env vars ausentes
export const config: AppConfig           // singleton validado
```

### `src/lib/auth.ts` — Autenticação

Exporta duas funções helper usadas dentro dos route handlers. Não é um middleware Next.js (o App Router não tem middleware de rota convencional), portanto é chamado explicitamente no início de cada handler.

```typescript
export interface AuthResult {
  success: boolean
  apiKey?: { id: string; name: string }
  error?: { status: number; message: string }
}

// Verifica Bearer token contra tabela ApiKey (SHA-256)
export async function authenticateRequest(req: NextRequest): Promise<AuthResult>

// Verifica Bearer token contra ADMIN_API_KEY (constant-time compare)
export async function authenticateAdmin(req: NextRequest): Promise<AuthResult>
```

**Detalhes de implementação:**
- `crypto.createHash('sha256').update(token).digest('hex')` para hash do token
- `crypto.timingSafeEqual()` para comparação do admin token
- Atualiza `lastUsedAt` somente após validação completa bem-sucedida
- Captura erros de DB e retorna `{ status: 503 }`

### `src/lib/rate-limit.ts` — Rate Limiting com MySQL

Implementa uma janela fixa (fixed window) de 60 segundos persistida na tabela `RateLimit`. Compatível com múltiplas instâncias por usar transações atômicas no MySQL.

```typescript
export interface RateLimitResult {
  allowed: boolean
  limit: number        // 30
  remaining: number
  resetAt: number      // Unix timestamp
}

export async function checkRateLimit(apiKeyId: string): Promise<RateLimitResult>
```

**Algoritmo:**
1. `windowStart = floor(now / 60_000) * 60_000` (início da janela atual em ms)
2. `UPSERT RateLimit (apiKeyId, windowStart)` com `count += 1` usando transação
3. Se `count > 30` → `allowed: false`
4. `resetAt = windowStart + 60_000` (em segundos Unix)

**Headers de resposta adicionados pelo caller:**
- `X-RateLimit-Limit: 30`
- `X-RateLimit-Remaining: <n>`
- `X-RateLimit-Reset: <unix_ts>`

### `src/lib/mailer.ts` — Transporte SMTP

Singleton do Nodemailer configurado via `config.smtp`. Timeout de 30s configurado no transporte.

```typescript
export interface SendMailOptions {
  to: string
  subject: string
  html?: string
  text?: string
  replyTo?: string
}

export interface SendMailResult {
  messageId: string
}

export async function sendMail(options: SendMailOptions): Promise<SendMailResult>
```

**Configuração do transporte:**
```typescript
nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.port === 465,
  auth: { user: config.smtp.user, pass: config.smtp.pass },
  connectionTimeout: 30_000,
  greetingTimeout: 30_000,
  socketTimeout: 30_000,
})
```

### `src/lib/prisma.ts` — Prisma Client Singleton

Padrão singleton para evitar múltiplas conexões em hot-reload do Next.js.

```typescript
// Exporta instância única do PrismaClient
export const prisma: PrismaClient
```

### `src/services/email.service.ts` — Email Service + Log Service

Orquestra validação de negócio, envio SMTP e persistência de log.

```typescript
export interface SendEmailInput {
  to: string
  subject: string
  html?: string
  text?: string
  replyTo?: string
  apiKeyId: string
  ipAddress: string
}

export interface SendEmailOutput {
  success: true
  messageId: string
  logId: string
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailOutput>

// Log Service
export async function getEmailLogs(
  apiKeyId: string,
  page: number,
  limit: number
): Promise<{ data: EmailLog[]; pagination: PaginationMeta }>

export async function getEmailLogById(
  id: string,
  apiKeyId: string
): Promise<EmailLog | null>
```

**Tratamento de erros no `sendEmail`:**
- Timeout SMTP → captura, persiste log `FAILED` com mensagem sanitizada, lança erro marcado como "smtp_error"
- Erro de DB no log → não propaga para o cliente (log silencioso no servidor)
- Retorna HTTP 502 para qualquer falha de envio

### `src/services/api-key.service.ts` — API Key Service

```typescript
export interface CreateApiKeyInput {
  name: string
  expiresAt?: Date
}

export interface CreateApiKeyOutput {
  id: string
  name: string
  key: string          // texto puro — exposto APENAS aqui
  createdAt: Date
}

export async function createApiKey(input: CreateApiKeyInput): Promise<CreateApiKeyOutput>
export async function listApiKeys(): Promise<ApiKeyPublic[]>
export async function revokeApiKey(id: string): Promise<ApiKeyPublic | null>

// Tipos públicos (sem keyHash)
export interface ApiKeyPublic {
  id: string; name: string; active: boolean
  createdAt: Date; updatedAt: Date
  lastUsedAt: Date | null; expiresAt: Date | null
}
```

**Geração de key:**
```typescript
const rawKey = crypto.randomBytes(32).toString('hex')  // 64 chars hex
const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex')
```

### `src/validators/email.validator.ts`

```typescript
import { z } from 'zod'

export const sendEmailSchema = z.object({
  to: z.string().email().max(254),
  subject: z.string().min(1).max(255),
  html: z.string().max(50_000).optional(),
  text: z.string().max(10_000).optional(),
  replyTo: z.string().email().optional(),
}).strict()  // rejeita campos extras (cc, bcc, attachments, from) com HTTP 400
 .refine(d => d.html || d.text, { message: 'html or text is required' })

export const emailLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
```

### `src/validators/api-key.validator.ts`

```typescript
export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  expiresAt: z.string().datetime().optional()
    .refine(v => !v || new Date(v) > new Date(), { message: 'expiresAt must be in the future' }),
})
```

### `app/api/v1/email/send/route.ts` — Route Handler

```typescript
export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Autenticação
  const auth = await authenticateRequest(req)
  if (!auth.success) return errorResponse(auth.error)

  // 2. Rate Limit
  const rl = await checkRateLimit(auth.apiKey!.id)
  if (!rl.allowed) return rateLimitResponse(rl)

  // 3. Validação do body
  const body = await req.json().catch(() => null)
  const parsed = sendEmailSchema.safeParse(body)
  if (!parsed.success) return validationErrorResponse(parsed.error)

  // 4. Envio
  const ipAddress = req.headers.get('x-forwarded-for') ?? req.ip ?? 'unknown'
  const result = await sendEmail({ ...parsed.data, apiKeyId: auth.apiKey!.id, ipAddress })

  return NextResponse.json({ success: true, ...result }, {
    headers: rateLimitHeaders(rl),
  })
}
```

---

## Data Models

### Prisma Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

model ApiKey {
  id         String    @id @default(uuid())
  name       String    @db.VarChar(100)
  keyHash    String    @unique @db.Char(64)
  active     Boolean   @default(true)
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  lastUsedAt DateTime?
  expiresAt  DateTime?

  emailLogs  EmailLog[]
  rateLimits RateLimit[]

  @@index([active])
  @@index([keyHash])       // lookup de autenticação
  @@map("api_keys")
}

model EmailLog {
  id           String   @id @default(uuid())
  apiKeyId     String
  recipient    String   @db.VarChar(254)
  subject      String   @db.VarChar(255)
  status       EmailStatus
  messageId    String?  @db.VarChar(255)
  ipAddress    String   @db.VarChar(45)   // suporta IPv6
  errorMessage String?  @db.Text
  createdAt    DateTime @default(now())

  apiKey       ApiKey   @relation(fields: [apiKeyId], references: [id])

  @@index([apiKeyId, createdAt(sort: Desc)])  // listagem paginada
  @@index([apiKeyId, id])                      // busca por id + owner
  @@map("email_logs")
}

model RateLimit {
  apiKeyId    String
  windowStart DateTime                        // início da janela (truncado a 60s)
  count       Int      @default(0)

  apiKey      ApiKey   @relation(fields: [apiKeyId], references: [id])

  @@id([apiKeyId, windowStart])               // PK composta — única por janela
  @@index([apiKeyId, windowStart])
  @@map("rate_limits")
}

enum EmailStatus {
  SENT
  FAILED
}
```

### Índices e Justificativas

| Tabela | Índice | Justificativa |
|--------|--------|---------------|
| `api_keys` | `keyHash` (UNIQUE) | Lookup O(1) na autenticação |
| `api_keys` | `active` | Filtro opcional em listagem |
| `email_logs` | `(apiKeyId, createdAt DESC)` | Paginação ordenada por data |
| `email_logs` | `(apiKeyId, id)` | Busca por ID validando owner |
| `rate_limits` | PK `(apiKeyId, windowStart)` | UPSERT atômico por janela |

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Hash de API Key é determinístico e o valor em texto puro nunca é persistido

*For any* valor de API Key em texto puro gerado aleatoriamente, o hash SHA-256 calculado no momento da criação e o hash calculado no momento da autenticação devem ser idênticos, e o registro persistido no banco deve conter apenas o `keyHash` — nunca o valor em texto puro no campo `keyHash` nem em qualquer outro campo.

**Validates: Requirements 1.3, 1.9, 6.2**

### Property 2: Rate limit respeita o limite máximo por janela e bloqueia excedentes

*For any* API Key e qualquer sequência de N requisições dentro de uma mesma janela de 60 segundos, as primeiras 30 devem retornar `allowed: true` com `remaining` decrescente, e todas as requisições a partir da 31ª devem retornar `allowed: false` com `resetAt` correspondendo ao fim da janela atual.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

### Property 3: Janela de rate limit é reiniciada e contadores são isolados por API Key

*For any* par de API Keys distintas K1 e K2, o contador de K1 nunca deve influenciar o contador de K2; e para qualquer API Key que tenha esgotado seu limite em uma janela W, requisições realizadas na janela W+1 (60 segundos após o início de W) devem ter o contador reiniciado a zero e ser permitidas normalmente.

**Validates: Requirements 3.1, 3.5, 3.6**

### Property 4: Log de e-mail sempre reflete o resultado real do envio SMTP

*For any* tentativa de envio de e-mail com qualquer payload válido, o `EmailLog` persistido deve ter `status = "SENT"` com `messageId` preenchido quando o SMTP retornar sucesso, e `status = "FAILED"` com `errorMessage` preenchido quando o SMTP falhar ou atingir timeout — sem exceções ou estados intermediários.

**Validates: Requirements 4.7, 4.8, 4.12**

### Property 5: Isolamento completo de logs entre API Keys distintas

*For any* par de API Keys distintas K1 e K2, e qualquer conjunto de `EmailLog`s criados por K1, nenhum desses logs deve aparecer em listagens nem em buscas por ID realizadas com K2 — a resposta deve ser idêntica à de um log inexistente (HTTP 404) para buscas por ID e ausente da listagem paginada.

**Validates: Requirements 5.1, 5.6, 5.7**

### Property 6: Campos proibidos no body são sempre rejeitados com HTTP 400

*For any* requisição `POST /api/v1/email/send` cujo body contenha qualquer subconjunto não vazio de `{from, cc, bcc, attachments}`, o sistema deve retornar HTTP 400 indicando o campo proibido, independentemente de os demais campos serem válidos.

**Validates: Requirements 4.5**

### Property 7: Validação de endereço de e-mail é consistente para `to` e `replyTo`

*For any* string fornecida nos campos `to` ou `replyTo`, o sistema deve aceitar o valor se e somente se for um endereço de e-mail sintaticamente válido com no máximo 254 caracteres para `to`, retornando HTTP 422 com indicação do campo específico em caso contrário.

**Validates: Requirements 4.2, 4.3, 4.13**

### Property 8: Revogação de API Key é idempotente

*For any* API Key com ID existente e qualquer número N ≥ 1 de chamadas `DELETE /api/v1/api-keys/:id`, o resultado deve ser sempre `active = false` e HTTP 200 — chamadas subsequentes não devem retornar erro nem alterar o resultado.

**Validates: Requirements 6.7, 6.9**

### Property 9: Security headers obrigatórios estão presentes em todas as respostas

*For any* endpoint da API e qualquer requisição (autenticada ou não, bem-sucedida ou com erro), a resposta HTTP deve sempre conter os headers `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` e `Referrer-Policy: no-referrer`.

**Validates: Requirements 7.1, 7.2, 7.3, 8.3**

### Property 10: Respostas de erro nunca expõem detalhes internos de implementação

*For any* input que provoque um erro interno (falha de DB, timeout SMTP, exceção não tratada), o corpo da resposta HTTP não deve conter stack traces, caminhos de arquivo do sistema, mensagens internas do Node.js, Prisma ou Nodemailer, nem valores de variáveis de ambiente sensíveis.

**Validates: Requirements 4.9, 7.8, 11.4**

---

## Error Handling

### Estrutura Padronizada de Resposta

Todas as respostas da API seguem um formato consistente:

**Sucesso:**
```json
{
  "success": true,
  "data": { ... }
}
```

**Erro:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Descrição legível por humanos",
    "fields": {               // apenas para 422
      "to": "Invalid email address",
      "subject": "Required"
    }
  }
}
```

### Mapeamento de Erros HTTP

| Situação | HTTP | `code` |
|----------|------|--------|
| Token ausente ou formato errado | 401 | `UNAUTHORIZED` |
| Token inválido (hash não encontrado) | 401 | `INVALID_CREDENTIALS` |
| API Key inativa | 403 | `KEY_DISABLED` |
| API Key expirada | 403 | `KEY_EXPIRED` |
| Admin token inválido | 403 | `ADMIN_FORBIDDEN` |
| Origem CORS não permitida | 403 | `CORS_FORBIDDEN` |
| Recurso não encontrado | 404 | `NOT_FOUND` |
| Método não permitido | 405 | `METHOD_NOT_ALLOWED` |
| Campos proibidos no body | 400 | `FORBIDDEN_FIELD` |
| Falha de validação | 422 | `VALIDATION_ERROR` |
| Content-Type inválido | 415 | `UNSUPPORTED_MEDIA_TYPE` |
| Body excede 100KB | 413 | `PAYLOAD_TOO_LARGE` |
| Rate limit excedido | 429 | `RATE_LIMIT_EXCEEDED` |
| Falha no envio SMTP | 502 | `EMAIL_DELIVERY_FAILED` |
| DB indisponível (auth) | 503 | `SERVICE_UNAVAILABLE` |
| Erro interno genérico | 500 | `INTERNAL_ERROR` |

### Princípios de Segurança nos Erros

1. **Nunca expor**: stack traces, caminhos de arquivo, mensagens de erro do Node.js/Nodemailer/Prisma
2. **Sanitização de erros SMTP**: extrair apenas o código de erro (ex: `"SMTP 550"`) sem host, IP ou credenciais
3. **Logs internos vs resposta pública**: o erro completo é logado no servidor (`console.error`) mas a resposta ao cliente contém apenas a mensagem sanitizada
4. **Indistinguibilidade 404**: para logs de outra API Key, retornar 404 idêntico ao "não encontrado" para não vazar existência de dados

### Helper de Respostas (`src/lib/responses.ts`)

```typescript
export function errorResponse(status: number, code: string, message: string, fields?: Record<string, string>): NextResponse
export function successResponse<T>(data: T, status = 200, headers?: HeadersInit): NextResponse
export function rateLimitResponse(rl: RateLimitResult): NextResponse
export function validationErrorResponse(error: ZodError): NextResponse
```

---

## Testing Strategy

### Avaliação de Aplicabilidade de PBT

Esta feature contém **lógica de negócio com comportamento que varia significativamente com os inputs**: hash de API Keys, contadores de rate limit por janela temporal, validação de campos com regras complexas e isolamento de dados por tenant. PBT é aplicável às camadas de lógica pura e serviços mockados. Os testes de integração com MySQL real e SMTP real são cobertura complementar — não PBT.

### Abordagem Dual: Testes Unitários + Property-Based

**Testes unitários** cobrem: comportamentos específicos, casos extremos e fluxos de integração entre componentes.  
**Property-based tests** cobrem: as 10 propriedades de correção listadas acima, usando mocks do Prisma e Nodemailer.

### Estrutura de Testes

```
tests/
├── unit/
│   ├── lib/
│   │   ├── auth.test.ts             // exemplos: token ausente, inactive, expirado, 503
│   │   ├── rate-limit.test.ts       // exemplos: exatamente 30, exatamente 31
│   │   ├── mailer.test.ts           // exemplos: timeout, multipart
│   │   └── env.test.ts              // smoke: missing vars
│   ├── services/
│   │   ├── email.service.test.ts    // exemplos: sucesso, falha SMTP, timeout
│   │   └── api-key.service.test.ts  // exemplos: create, list, revoke
│   └── validators/
│       ├── email.validator.test.ts  // exemplos: campos proibidos, replyTo inválido
│       └── api-key.validator.test.ts // exemplos: expiresAt no passado
├── property/
│   ├── auth.property.test.ts        // Property 1: hash determinístico
│   ├── rate-limit.property.test.ts  // Property 2: limite máximo; Property 3: reset e isolamento
│   ├── email.property.test.ts       // Property 4: log reflete SMTP; Property 6: campos proibidos; Property 7: validação email
│   ├── logs.property.test.ts        // Property 5: isolamento de logs
│   ├── api-key.property.test.ts     // Property 8: revogação idempotente
│   └── security.property.test.ts   // Property 9: security headers; Property 10: sem detalhes internos
└── integration/
    ├── send-email.integration.test.ts  // fluxo E2E com SMTP mockado, banco real
    ├── api-keys.integration.test.ts    // CRUD completo, banco real
    └── logs.integration.test.ts        // isolamento de logs, banco real
```

### Biblioteca de PBT

Usar **[fast-check](https://fast-check.dev/)** (TypeScript-native, sem dependências externas, compatível com Jest/Vitest).

```bash
npm install --save-dev fast-check
```

### Configuração dos Property Tests

Cada property test deve:
- Executar **mínimo 100 iterações** (`numRuns: 100`)
- Usar mocks do Prisma para não depender de banco real
- Referenciar a propriedade do design com um comentário `// Feature: email-api, Property N: <texto>`

Exemplos representativos:

```typescript
// Feature: email-api, Property 1: Hash de API Key é determinístico e o valor em texto puro nunca é persistido
import fc from 'fast-check'
import crypto from 'crypto'
import { createApiKey } from '@/services/api-key.service'
import { prismaMock } from '../__mocks__/prisma'

test('Property 1: keyHash is sha256 of raw key, raw key never stored', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 100 }),  // name
      async (name) => {
        const result = await createApiKey({ name })
        const expectedHash = crypto.createHash('sha256').update(result.key).digest('hex')
        // hash armazenado deve ser sha256 do texto puro
        expect(prismaMock.apiKey.create.mock.calls[0][0].data.keyHash).toBe(expectedHash)
        // texto puro nunca deve estar no keyHash
        expect(prismaMock.apiKey.create.mock.calls[0][0].data.keyHash).not.toBe(result.key)
      }
    ),
    { numRuns: 100 }
  )
})

// Feature: email-api, Property 2: Rate limit respeita o limite máximo por janela e bloqueia excedentes
test('Property 2: first 30 allowed, 31st blocked', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.uuid(),                              // apiKeyId aleatório
      fc.integer({ min: 1, max: 29 }),        // N permitidas (< 30)
      async (apiKeyId, n) => {
        // mock: simular N+1 chamadas na mesma janela
        // verificar que as primeiras N retornam allowed: true
        // e a N+1-ésima retorna allowed: false somente quando n >= 30
      }
    ),
    { numRuns: 100 }
  )
})

// Feature: email-api, Property 5: Isolamento completo de logs entre API Keys distintas
test('Property 5: logs are isolated per API key', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.uuid(),  // apiKeyId K1
      fc.uuid(),  // apiKeyId K2 (distinto)
      fc.array(fc.record({ recipient: fc.emailAddress(), subject: fc.string({ minLength: 1, maxLength: 255 }) }), { minLength: 1 }),
      async (k1, k2, logsK1) => {
        fc.pre(k1 !== k2)
        // criar logs para k1, consultar com k2
        // resultado deve ser sempre empty array
      }
    ),
    { numRuns: 100 }
  )
})
```

### Testes de Integração

Os testes de integração usam um banco MySQL de teste (variável `TEST_DATABASE_URL`) com banco limpo por suite:

- **`send-email.integration.test.ts`**: fluxo completo com SMTP mockado via `nodemailer-mock`; verifica log criado, response shape, rate limit headers
- **`api-keys.integration.test.ts`**: CRUD completo de API Keys; verifica que keyHash não aparece na listagem
- **`logs.integration.test.ts`**: isolamento de logs entre API Keys diferentes; paginação e ordenação

### Cobertura Esperada

| Camada | Tipo de Teste | Meta |
|--------|---------------|------|
| Validators (Zod schemas) | Unit + Property | 100% |
| `auth.ts` | Unit + Property | 95% |
| `rate-limit.ts` | Unit + Property | 95% |
| `email.service.ts` | Unit + Property (mocks) | 90% |
| `api-key.service.ts` | Unit + Property (mocks) | 90% |
| Security Middleware | Property | 90% |
| Route Handlers | Integration | 85% |
| Fluxo E2E | Integration | Casos críticos |

### Considerações de Deploy na Hostinger

**Sem Redis disponível**: o rate limiting usa MySQL como backend de estado compartilhado. O UPSERT atômico via `prisma.$transaction` com `INSERT ... ON DUPLICATE KEY UPDATE count = count + 1` garante contagem correta mesmo sob concorrência.

**Node.js na Hostinger**: a Hostinger VPS/Cloud suporta Node.js 18+. O Next.js deve ser iniciado com `next start` em modo de produção. Recomenda-se usar PM2 para gerenciar o processo:

```bash
npm run build
pm2 start npm --name "email-api" -- start
pm2 save
pm2 startup
```

**Variáveis de ambiente**: configurar via painel da Hostinger ou arquivo `.env.production` (não versionado, fora do repositório git).

**Porta**: configurar `PORT` via env var; o Nginx da Hostinger deve ser configurado como reverse proxy:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

**Pool de conexões MySQL**: configurar `connection_limit` na `DATABASE_URL` do Prisma para evitar esgotamento em ambientes com múltiplas instâncias PM2:

```
DATABASE_URL="mysql://user:pass@host:3306/db?connection_limit=5"
```

**SMTP da Hostinger**: usar porta 465 (SSL) ou 587 (STARTTLS). O `secure: true` deve ser definido apenas para porta 465. O `SMTP_FROM` deve corresponder exatamente ao e-mail autenticado no painel da Hostinger.

**Limpeza de RateLimit**: registros antigos da tabela `rate_limits` podem ser limpos periodicamente via cron ou job agendado:

```sql
DELETE FROM rate_limits WHERE window_start < DATE_SUB(NOW(), INTERVAL 1 HOUR);
```
