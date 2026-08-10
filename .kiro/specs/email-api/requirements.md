# Requirements Document

## Introduction

Uma API REST profissional para envio de e-mails transacionais, construída com Next.js + TypeScript, utilizando Nodemailer via SMTP da Hostinger (domínio próprio), banco de dados MySQL gerenciado pelo Prisma ORM e autenticação por API Keys com armazenamento seguro de credenciais. A API expõe endpoints versionados sob `/api/v1`, suporta controle de ciclo de vida de API Keys, registra logs de cada e-mail enviado e oferece proteções de segurança em todas as camadas. O escopo da V1 é limitado a e-mails simples com um único destinatário, sem anexos, CC, BCC ou templates complexos.

---

## Glossary

- **API**: Interface de programação de aplicações REST que recebe e responde requisições HTTP em formato JSON.
- **API_Key_Service**: Componente responsável por gerar, validar, listar e revogar API Keys.
- **Auth_Middleware**: Componente que intercepta toda requisição autenticada e verifica a validade da API Key antes de prosseguir.
- **Admin_Auth_Middleware**: Componente que intercepta requisições administrativas e verifica a validade da Admin API Key.
- **Email_Service**: Componente responsável por compor e enviar e-mails via SMTP utilizando Nodemailer.
- **Log_Service**: Componente responsável por persistir e recuperar registros de envio de e-mails no banco de dados.
- **Rate_Limiter**: Componente que controla a taxa de requisições por API Key em uma janela de tempo fixa.
- **Request_Validator**: Componente que valida o corpo, cabeçalhos e Content-Type das requisições usando Zod.
- **Security_Middleware**: Conjunto de middlewares que aplicam headers de segurança HTTP, validação de Content-Type, restrição de CORS e limite de tamanho do corpo.
- **ApiKey**: Entidade persistida no banco de dados com campos `id`, `name`, `keyHash`, `active`, `createdAt`, `updatedAt`, `lastUsedAt`, `expiresAt`.
- **EmailLog**: Entidade persistida no banco de dados com campos `id`, `apiKeyId`, `recipient`, `subject`, `status`, `messageId`, `ipAddress`, `errorMessage`, `createdAt`.
- **SMTP_Config**: Conjunto de variáveis de ambiente que configuram o servidor SMTP da Hostinger (host, port, user, password).
- **SHA-256**: Algoritmo de hash unidirecional usado para armazenar API Keys de forma segura.
- **Admin_API_Key**: API Key especial, configurada via variável de ambiente, com permissão exclusiva para operações administrativas de gerenciamento de API Keys.
- **ALLOWED_ORIGINS**: Variável de ambiente que define a lista de origens permitidas pelo CORS.
- **Rate_Limit_Window**: Janela de tempo de 60 segundos usada para contagem de requisições por API Key.

---

## Requirements

### Requirement 1: Autenticação por API Key

**User Story:** Como desenvolvedor consumidor da API, quero me autenticar com uma API Key para que apenas clientes autorizados possam enviar e-mails.

#### Acceptance Criteria

1. WHEN uma requisição chegar a qualquer endpoint `/api/v1/email/*`, THE `Auth_Middleware` SHALL verificar a presença do cabeçalho `Authorization: Bearer <token>`.
2. IF o cabeçalho `Authorization` estiver ausente ou não seguir o formato `Bearer <token>`, THEN THE `Auth_Middleware` SHALL retornar HTTP 401 indicando que autenticação é obrigatória.
3. WHEN o cabeçalho `Authorization: Bearer <token>` for fornecido, THE `Auth_Middleware` SHALL calcular o SHA-256 do token recebido e comparar com os hashes armazenados na tabela `ApiKey`; a autenticação somente poderá funcionar se todos os registros `ApiKey` já estiverem armazenados como hash SHA-256, não sendo suportada comparação com valores em texto puro em nenhuma circunstância.
4. IF o hash calculado não corresponder a nenhum registro na tabela `ApiKey`, THEN THE `Auth_Middleware` SHALL retornar HTTP 401 indicando credencial inválida.
5. IF o registro `ApiKey` correspondente tiver o campo `active` igual a `false`, THEN THE `Auth_Middleware` SHALL retornar HTTP 403 indicando que a chave está desativada.
6. IF o registro `ApiKey` correspondente tiver o campo `expiresAt` definido e inferior ao instante atual, THEN THE `Auth_Middleware` SHALL retornar HTTP 403 indicando que a chave está expirada.
7. WHEN a API Key for válida, ativa e não expirada, THE `Auth_Middleware` SHALL atualizar o campo `lastUsedAt` do registro `ApiKey` correspondente com o instante atual e prosseguir para o próximo handler.
8. IF o repositório de API Keys estiver indisponível durante a validação, THEN THE `Auth_Middleware` SHALL retornar HTTP 503 indicando falha temporária no serviço, sem expor detalhes internos.
9. THE `API_Key_Service` SHALL armazenar API Keys exclusivamente como hash SHA-256, nunca em texto puro.

---

### Requirement 2: Autenticação Administrativa

**User Story:** Como administrador do sistema, quero me autenticar com uma API Key administrativa separada para que somente eu possa gerenciar as API Keys dos clientes.

#### Acceptance Criteria

1. WHEN uma requisição chegar a qualquer endpoint `/api/v1/api-keys/*`, THE `Admin_Auth_Middleware` SHALL verificar a presença e validade do cabeçalho `Authorization: Bearer <admin_token>`.
2. IF o cabeçalho `Authorization` estiver ausente nos endpoints administrativos, THEN THE `Admin_Auth_Middleware` SHALL retornar HTTP 401 indicando que autenticação administrativa é obrigatória.
3. IF o cabeçalho `Authorization` estiver presente mas o valor do token não corresponder ao valor da variável de ambiente `ADMIN_API_KEY`, THEN THE `Admin_Auth_Middleware` SHALL retornar HTTP 403 indicando credencial administrativa inválida.
4. THE `Admin_Auth_Middleware` SHALL comparar os tokens usando tempo constante (constant-time comparison) para evitar ataques de timing, sem expor o valor de `ADMIN_API_KEY` em respostas ou logs.
5. IF a variável de ambiente `ADMIN_API_KEY` não estiver definida na inicialização da aplicação, THEN THE `API` SHALL encerrar o processo imediatamente com código de saída não zero e registrar no stderr quais variáveis estão ausentes; a aplicação não deverá iniciar parcialmente nem bloquear apenas os endpoints administrativos.

---

### Requirement 3: Rate Limiting por API Key

**User Story:** Como operador da plataforma, quero limitar a taxa de requisições por API Key para que um único cliente não sobrecarregue o servidor de e-mail.

#### Acceptance Criteria

1. THE `Rate_Limiter` SHALL controlar individualmente o número de requisições por API Key dentro de uma janela fixa de 60 segundos (`Rate_Limit_Window`).
2. WHEN uma API Key realizar até 30 requisições dentro da `Rate_Limit_Window`, THE `Rate_Limiter` SHALL permitir o prosseguimento da requisição.
3. WHEN uma API Key exceder 30 requisições dentro da `Rate_Limit_Window`, THE `Rate_Limiter` SHALL retornar HTTP 429 com indicação de quantos segundos restam até o reset da janela.
4. THE `Rate_Limiter` SHALL incluir metadados de controle de taxa em todas as respostas aos endpoints de envio de e-mail: limite total da janela, requisições restantes e timestamp Unix do próximo reset.
5. WHEN a `Rate_Limit_Window` expirar, THE `Rate_Limiter` SHALL reiniciar o contador da API Key correspondente para zero, permitindo novas requisições.
6. THE `Rate_Limiter` SHALL funcionar corretamente em ambientes com múltiplas instâncias da aplicação, não dependendo exclusivamente de estado em memória local.

---

### Requirement 4: Envio de E-mail

**User Story:** Como desenvolvedor consumidor da API, quero enviar um e-mail transacional para um único destinatário para que minha aplicação possa notificar usuários finais.

#### Acceptance Criteria

1. WHEN uma requisição `POST /api/v1/email/send` for recebida com autenticação válida, THE `Email_Service` SHALL enviar um e-mail via SMTP usando as credenciais definidas em `SMTP_Config`.
2. WHEN o corpo da requisição for recebido, THE `Request_Validator` SHALL exigir o campo `to` (e-mail válido, máx. 254 caracteres), o campo `subject` (string, 1–255 caracteres) e ao menos um dos campos de conteúdo: `html` (string, máx. 50.000 caracteres) ou `text` (string, máx. 10.000 caracteres).
3. IF qualquer campo obrigatório estiver ausente ou inválido, THEN THE `Request_Validator` SHALL retornar HTTP 422 listando os campos inválidos com descrição do erro por campo.
4. THE `Email_Service` SHALL definir o endereço `from` exclusivamente a partir da variável de ambiente `SMTP_FROM`, ignorando qualquer valor fornecido pelo cliente.
5. IF o corpo da requisição contiver os campos `cc`, `bcc`, `attachments` ou `from`, THEN THE `Request_Validator` SHALL retornar HTTP 400 indicando qual campo não é permitido na V1.
6. WHEN o corpo da requisição contiver `html` e `text` simultaneamente, THE `Email_Service` SHALL utilizá-los como partes complementares da mensagem (multipart/alternative), priorizando HTML para clientes que suportam.
7. WHEN o `Email_Service` concluir o envio com sucesso, THE `Log_Service` SHALL persistir um registro `EmailLog` com `status = "SENT"` e o `messageId` retornado pelo servidor SMTP.
8. IF o `Email_Service` não conseguir enviar o e-mail, THEN THE `Log_Service` SHALL persistir um registro `EmailLog` com `status = "FAILED"` e a mensagem de erro sanitizada no campo `errorMessage`.
9. IF o `Email_Service` não conseguir enviar o e-mail por qualquer motivo (erro SMTP, timeout ou falha de conexão), THEN THE `API` SHALL sempre retornar HTTP 502 sem expor detalhes internos do SMTP na resposta pública.
10. WHEN o envio for bem-sucedido, THE `API` SHALL retornar HTTP 200 com `success: true`, o `messageId` do servidor SMTP e o `id` do registro de log criado.
11. WHEN uma requisição `POST /api/v1/email/send` for recebida, THE `Log_Service` SHALL registrar o endereço IP do cliente no campo `ipAddress` do `EmailLog`.
12. IF o `Email_Service` não receber resposta do servidor SMTP dentro de 30 segundos, THEN THE `Email_Service` SHALL encerrar a conexão e tratar a tentativa como falha, seguindo o fluxo do critério 8 e 9.
13. IF o campo `replyTo` for fornecido, THEN THE `Request_Validator` SHALL validar que o valor é um endereço de e-mail válido, retornando HTTP 422 em caso contrário.

---

### Requirement 5: Consulta de Logs de E-mail

**User Story:** Como desenvolvedor consumidor da API, quero consultar os logs dos e-mails enviados com minha API Key para que eu possa auditar e monitorar os envios.

#### Acceptance Criteria

1. WHEN uma requisição `GET /api/v1/email/logs` for recebida com autenticação válida, THE `Log_Service` SHALL retornar somente os registros `EmailLog` associados à API Key autenticada.
2. THE `Log_Service` SHALL suportar os parâmetros de query opcionais `page` (inteiro ≥ 1, padrão 1) e `limit` (inteiro entre 1 e 100, padrão 20) para paginação; quando omitidos, os valores padrão SHALL ser aplicados silenciosamente sem retornar erro.
3. IF os parâmetros `page` ou `limit` forem fornecidos explicitamente com valores não-inteiros ou fora do intervalo permitido, THEN THE `API` SHALL retornar HTTP 422 indicando quais parâmetros são inválidos.
4. THE `Log_Service` SHALL retornar os logs em ordem decrescente por `createdAt`; quando dois ou mais logs tiverem o mesmo valor de `createdAt`, THE `Log_Service` SHALL aplicar ordenação secundária por `id` de forma decrescente para garantir resultado determinístico.
5. THE `API` SHALL retornar os logs no formato `{"data": [...], "pagination": {"page": n, "limit": n, "total": n, "totalPages": n}}`.
6. WHEN uma requisição `GET /api/v1/email/logs/:id` for recebida com autenticação válida, THE `Log_Service` SHALL retornar o registro `EmailLog` correspondente ao `id` informado somente se ele pertencer à API Key autenticada.
7. IF o `id` informado em `GET /api/v1/email/logs/:id` não existir ou pertencer a outra API Key, THEN THE `API` SHALL retornar HTTP 404, sem distinguir entre os dois casos para não vazar informações de outros clientes.
8. IF uma requisição a `/api/v1/email/logs` ou `/api/v1/email/logs/:id` for feita sem autenticação válida, THEN THE `Auth_Middleware` SHALL retornar HTTP 401 antes de qualquer acesso a dados.

---

### Requirement 6: Gerenciamento de API Keys (Administrativo)

**User Story:** Como administrador do sistema, quero criar, listar e revogar API Keys para que eu possa controlar o acesso de clientes à API.

#### Acceptance Criteria

1. WHEN uma requisição `POST /api/v1/api-keys` for recebida com autenticação administrativa válida, THE `API_Key_Service` SHALL gerar um valor aleatório criptograficamente seguro de 32 bytes codificado em hexadecimal como nova API Key.
2. THE `API_Key_Service` SHALL persistir apenas o hash SHA-256 da nova API Key no campo `keyHash` da entidade `ApiKey`, nunca o valor em texto puro.
3. WHEN a API Key for criada com sucesso, THE `API` SHALL retornar HTTP 201 com os campos `id`, `name`, `key` (valor em texto puro) e `createdAt`, sendo esta a única ocasião em que o valor em texto puro é exposto.
4. WHEN o corpo de `POST /api/v1/api-keys` for recebido, THE `Request_Validator` SHALL exigir o campo `name` (string, 1–100 caracteres) e aceitar opcionalmente `expiresAt` (string ISO 8601 com data futura), retornando HTTP 422 se algum campo for inválido ou malformado.
5. IF o campo `expiresAt` fornecido representar uma data no passado ou tiver formato inválido, THEN THE `Request_Validator` SHALL retornar HTTP 422 indicando o problema no campo `expiresAt`.
6. WHEN uma requisição `GET /api/v1/api-keys` for recebida com autenticação administrativa válida, THE `API_Key_Service` SHALL retornar a lista de todas as entidades `ApiKey` com os campos `id`, `name`, `active`, `createdAt`, `updatedAt`, `lastUsedAt`, `expiresAt`, sem expor o campo `keyHash`.
7. WHEN uma requisição `DELETE /api/v1/api-keys/:id` for recebida com autenticação administrativa válida, THE `API_Key_Service` SHALL definir o campo `active` como `false` e atualizar `updatedAt`; se a chave já estiver desativada, a operação SHALL ser idempotente e retornar HTTP 200.
8. IF o `id` informado em `DELETE /api/v1/api-keys/:id` não existir, THEN THE `API` SHALL retornar HTTP 404.
9. WHEN a revogação for bem-sucedida, THE `API` SHALL retornar HTTP 200 com confirmação de que o registro foi desativado, incluindo o `id` e o novo valor de `active`.

---

### Requirement 7: Segurança de Transporte e Headers HTTP

**User Story:** Como operador da plataforma, quero que a API aplique headers de segurança e políticas de transporte para que clientes e intermediários não possam explorar vulnerabilidades comuns de HTTP.

#### Acceptance Criteria

1. THE `Security_Middleware` SHALL incluir o cabeçalho `X-Content-Type-Options: nosniff` em todas as respostas da API.
2. THE `Security_Middleware` SHALL incluir o cabeçalho `X-Frame-Options: DENY` em todas as respostas da API.
3. THE `Security_Middleware` SHALL incluir o cabeçalho `Referrer-Policy: no-referrer` em todas as respostas da API.
4. THE `Security_Middleware` SHALL aplicar política CORS permitindo apenas as origens listadas na variável de ambiente `ALLOWED_ORIGINS`, retornando HTTP 403 para origens não listadas.
5. IF a variável de ambiente `ALLOWED_ORIGINS` não estiver definida, THEN THE `Security_Middleware` SHALL bloquear todas as requisições cross-origin.
6. IF uma requisição com corpo chegar a um endpoint que aceita corpo e o `Content-Type` for diferente de `application/json`, THEN THE `Security_Middleware` SHALL retornar HTTP 415 indicando o tipo esperado.
7. THE `Security_Middleware` SHALL aplicar as validações na seguinte ordem de precedência: CORS → Content-Type → tamanho do body; a primeira validação que falhar SHALL retornar seu código HTTP correspondente imediatamente, sem processar as validações subsequentes.
8. THE `API` SHALL nunca incluir stack traces, caminhos internos de arquivo ou mensagens de erro internas do Node.js em respostas HTTP 4xx ou 5xx públicas.

---

### Requirement 8: Health Check

**User Story:** Como operador da plataforma, quero um endpoint de verificação de saúde sem autenticação para que sistemas de monitoramento possam verificar a disponibilidade da API.

#### Acceptance Criteria

1. WHEN uma requisição `GET /api/health` for recebida, THE `API` SHALL retornar HTTP 200 sem exigir autenticação; o endpoint `/api/health` SHALL ser explicitamente isento de qualquer middleware de autenticação, incluindo `Auth_Middleware` e `Admin_Auth_Middleware`.
2. THE `API` SHALL retornar o corpo `{"status": "ok", "timestamp": "<iso8601>", "version": "<semver>"}` na resposta ao `GET /api/health`.
3. THE `Security_Middleware` SHALL aplicar os headers de segurança definidos no Requirement 7 também ao endpoint `/api/health`.

---

### Requirement 9: Versionamento de API

**User Story:** Como desenvolvedor consumidor da API, quero que todos os endpoints estejam sob o prefixo `/api/v1` para que futuras versões possam coexistir sem quebrar integrações existentes.

#### Acceptance Criteria

1. THE `API` SHALL expor todos os endpoints de negócio sob o prefixo de rota `/api/v1`.
2. WHEN uma requisição for feita a um caminho inexistente, THE `API` SHALL retornar HTTP 404 com corpo `{"error": "Not found"}`.
3. WHEN uma requisição usar um método HTTP não suportado em um endpoint existente, THE `API` SHALL retornar HTTP 405 com corpo `{"error": "Method not allowed"}`.

---

### Requirement 10: Persistência de Dados (ApiKey e EmailLog)

**User Story:** Como operador da plataforma, quero que as entidades de API Keys e logs de e-mail sejam persistidas em MySQL via Prisma ORM para que os dados sobrevivam a reinicializações da aplicação.

#### Acceptance Criteria

1. THE `API_Key_Service` SHALL persistir entidades `ApiKey` com os campos `id` (UUID v4), `name`, `keyHash`, `active` (padrão `true`), `createdAt`, `updatedAt`, `lastUsedAt` (nullable), `expiresAt` (nullable) no banco de dados MySQL.
2. THE `Log_Service` SHALL persistir entidades `EmailLog` com os campos `id` (UUID v4), `apiKeyId`, `recipient`, `subject`, `status` (enum `SENT` | `FAILED`), `messageId` (nullable), `ipAddress`, `errorMessage` (nullable), `createdAt` no banco de dados MySQL.
3. THE `API_Key_Service` SHALL garantir que o campo `keyHash` seja único na tabela `ApiKey`.
4. IF uma operação de escrita no banco de dados falhar, THEN THE `API` SHALL retornar HTTP 500 com corpo `{"error": "Internal server error"}` sem expor detalhes da falha.
5. THE `API` SHALL utilizar exclusivamente o Prisma ORM para todas as operações de leitura e escrita no banco de dados MySQL.

---

### Requirement 11: Configuração via Variáveis de Ambiente

**User Story:** Como operador da plataforma, quero que todas as credenciais e configurações sensíveis sejam carregadas de variáveis de ambiente para que a aplicação possa ser implantada em diferentes ambientes sem alteração de código.

#### Acceptance Criteria

1. THE `API` SHALL carregar as seguintes variáveis de ambiente obrigatórias na inicialização: `DATABASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ADMIN_API_KEY`, `ALLOWED_ORIGINS`.
2. IF qualquer variável de ambiente obrigatória não estiver definida na inicialização, THEN THE `API` SHALL encerrar o processo com código de saída não zero e registrar quais variáveis estão ausentes no log do servidor.
3. THE `API` SHALL carregar a variável de ambiente opcional `PORT` (padrão 3000) para definir a porta de escuta do servidor HTTP; o carregamento de `PORT` SHALL ocorrer independentemente do status das variáveis obrigatórias.
4. THE `API` SHALL nunca registrar valores de variáveis de ambiente sensíveis (`SMTP_PASS`, `ADMIN_API_KEY`) em logs de qualquer nível, incluindo `debug` e `trace`, mesmo durante diagnóstico de problemas de conexão.

---

### Requirement 12: Documentação

**User Story:** Como desenvolvedor consumidor da API, quero uma documentação completa em README para que eu possa integrar com a API sem necessidade de suporte adicional.

#### Acceptance Criteria

1. THE `API` SHALL fornecer um arquivo `README.md` na raiz do projeto documentando todos os endpoints, seus parâmetros, cabeçalhos obrigatórios, exemplos de requisição e resposta para cada status HTTP possível.
2. THE `README.md` SHALL documentar todas as variáveis de ambiente obrigatórias e opcionais com descrição, tipo e exemplo de valor.
3. THE `README.md` SHALL incluir instruções de instalação, configuração e execução local da aplicação.
4. THE `README.md` SHALL descrever explicitamente as restrições da V1 (sem anexos, CC, BCC, múltiplos destinatários).
