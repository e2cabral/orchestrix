# Próximos Passos para Evoluir a Orchestrix

## Diagnóstico atual

A lib já tem uma base sólida: execução de steps em sequência, retry, timeout, compensação (sagas), idempotência em
memória e tipagem forte. O que falta é tudo que a torna produção-ready e extensível.

## Funcionalidades a implementar (priorizadas)

### 1. 🗄️ Persistência do IdempotencyStore (DynamoDB / Redis)

**O que é:** A interface IdempotencyStore já existe e é agnóstica ao backend. O objetivo é criar implementações
alternativas ao store em memória.

**Guia de implementação:**

- Entenda bem o contrato da interface `IdempotencyStore` que já existe em `src/types/index.ts` — todos os métodos que
  precisam ser implementados (get, start, complete, fail, delete, cleanup)
- Crie uma pasta `src/adapters/` para abrigar as implementações externas
- Para Redis, crie um arquivo `redis.ts` dentro de adapters. Pense em como usar `SET NX EX` para garantir atomicidade no
  método `start` (que precisa ser atômico para evitar race condition). Serialize os registros como JSON. O TTL do Redis
  pode substituir o `expiresAt` manual
- Para DynamoDB, crie um arquivo `dynamo.ts`. Pense em usar `ConditionExpression` na operação de `start` para garantir
  que apenas um processo adquira o lock. O TTL nativo do DynamoDB (ttl attribute) pode ser usado para o cleanup
  automático
- Ambas as implementações recebem o cliente externo como parâmetro no construtor — a lib não instancia o cliente, quem
  chama injeta
- Exporte as factories pelos mesmos padrões do `createIdempotencyStore` já existente
- Documente que essas implementações são peer dependencies — o usuário instala o SDK do Redis ou AWS separadamente
- Escreva testes para cada adapter usando mocks dos clientes externos (sem precisar de infra real)

### 2. 🔁 Retry com Backoff Exponencial e Jitter

**O que é:** O retry atual usa delay fixo (`retryDelayMs`). Sistemas reais precisam de backoff exponencial (o delay
dobra a cada tentativa) e jitter (variação aleatória para evitar thundering herd).

**Guia de implementação:**

- Estude o arquivo `src/utils/retry.ts` atual
- Adicione novas opções ao tipo `StepOptions` em `src/types/index.ts`:
    - uma estratégia de backoff: `'fixed'`, `'exponential'`, `'linear'`
    - um multiplicador para o exponencial
    - uma flag para habilitar jitter
    - um delay máximo (`maxRetryDelayMs`) para limitar o crescimento
- Modifique `runWithRetry` para calcular o delay de cada tentativa baseado na estratégia escolhida
- Mantenha `'fixed'` como padrão para não quebrar quem já usa a lib
- Escreva testes cobrindo cada estratégia, incluindo o caso em que o delay não ultrapassa o máximo

### 3. 🔀 Execução Paralela de Steps

**O que é:** Hoje todos os steps são sequenciais. Muitas vezes steps independentes podem rodar em paralelo (ex: enviar
email E gravar log ao mesmo tempo).

**Guia de implementação:**

- Adicione um novo método no Flow, por exemplo `.parallel(steps[])`, que recebe um array de steps com seus nomes,
  funções e opções
- Internamente, use `Promise.allSettled` para executar todos em paralelo e aguardar todos terminarem (não `Promise.all`,
  para não abortar os demais na primeira falha)
- Defina a semântica de falha: se qualquer step paralelo falhar, o grupo inteiro é considerado falho? Ou só se todos
  falharem? Deixe isso configurável
- Cada step paralelo ainda deve registrar seu próprio `StepResult` individualmente
- Atualize o `State` para rastrear steps dentro de grupos paralelos
- Pense em como a compensação funciona: steps de um grupo paralelo que completaram devem compensar se outro do mesmo
  grupo falhar?
- Escreva testes cobrindo: todos completam, um falha, todos falham, compensação no paralelo

### 4. 📡 Sistema de Eventos / Hooks

**O que é:** Permitir que o consumidor reaja a eventos do ciclo de vida do fluxo sem precisar modificar os steps.

**Guia de implementação:**

- Defina os eventos relevantes: `onStepStart`, `onStepComplete`, `onStepFail`, `onFlowStart`, `onFlowComplete`,
  `onFlowFail`, `onCompensate`
- Adicione um tipo `FlowHooks<TInput>` com callbacks opcionais para cada evento, todos com os dados relevantes (nome do
  step, resultado, erro, etc.)
- Adicione `hooks?: FlowHooks<TInput>` ao `FlowConfig`
- Nos pontos corretos dentro de `flow.ts`, chame os hooks correspondentes — envolva cada chamada em try/catch para que
  um hook com erro não quebre o fluxo
- Não use `EventEmitter` nativo do Node para manter a lib isomórfica (funciona em edge runtimes também)
- Escreva testes verificando que hooks são chamados na ordem certa, com os dados corretos, e que um hook com erro não
  interrompe a execução

### 5. ⏸️ Suporte a Cancelamento (AbortSignal)

**O que é:** Permitir cancelar um fluxo em execução externamente, usando o padrão nativo `AbortSignal` do JavaScript.

**Guia de implementação:**

- Adicione `signal?: AbortSignal` como opção no método `run`
- No loop principal de execução dos steps em `flow.ts`, verifique `signal.aborted` antes de iniciar cada step
- Passe o `signal` para dentro do `FlowContext` para que os steps individuais também possam verificar se devem parar
- Defina um novo status `'cancelled'` para o `FlowResult` (hoje `cancelled` só existe para steps compensados)
- Decida se o cancelamento deve disparar as compensações — provavelmente sim, mas deixe configurável
- Escreva testes usando `AbortController`

### 6. ✅ Validação de Input com Schema

**O que é:** Validar os dados de entrada antes de executar qualquer step, usando bibliotecas como Zod, Valibot ou
qualquer lib que implemente o protocolo Standard Schema.

**Guia de implementação:**

- O projeto já tem `@standard-schema/spec` como dependência — use esse protocolo para ser agnóstico à biblioteca de
  validação
- Adicione `schema?: StandardSchemaV1<TInput>` ao `FlowConfig`
- No início do método `run`, se houver schema, valide o input antes de qualquer step
- Se a validação falhar, retorne um `FlowResult` com status `'failed'` e o erro de validação, ou lance um erro tipado
- Crie um novo tipo de erro `FlowValidationError` em `src/errors/index.ts`
- Escreva testes com schemas válidos e inválidos

### 7. 📊 Observabilidade: Métricas e Traces

**O que é:** Expor dados estruturados de execução para integrar com OpenTelemetry, Datadog, etc.

**Guia de implementação:**

- Crie uma interface `FlowTracer` com métodos como `startSpan`, `endSpan`, `recordError`
- Adicione `tracer?: FlowTracer` ao `FlowConfig`
- Instrumentalize os pontos-chave em `flow.ts` chamando o tracer
- Mantenha a interface simples e que possa ser adaptada para qualquer backend de observabilidade — não acople ao
  OpenTelemetry diretamente
- O `FlowResult` já tem `durationMs` e steps com `durationMs` individuais — considere adicionar `startedAt` timestamp
  para facilitar correlação de traces

### 8. 🔒 Controle de Concorrência (Mutex/Semaphore)

**O que é:** Limitar quantas execuções de um mesmo fluxo podem rodar simultaneamente.

**Guia de implementação:**

- Adicione `maxConcurrency?: number` ao `FlowConfig`
- Crie um utilitário `src/utils/semaphore.ts` que controle o número de execuções ativas
- No método `run`, tente adquirir o semáforo antes de executar. Se não conseguir, decida: esperar, lançar erro ou
  retornar status especial
- Garanta que o semáforo seja liberado sempre no `finally`, mesmo em caso de erro
- Isso é diferente de idempotência — idempotência é sobre a mesma chave, concorrência é sobre qualquer instância do
  mesmo flow

### 9. 📝 Melhoria de Erros: Contexto Rico

**O que é:** Os erros atuais são simples. Em produção, você precisa saber exatamente onde e porquê algo falhou.

**Guia de implementação:**

- Enriqueça os erros existentes com mais contexto: qual step estava em qual tentativa quando falhou, qual foi o input (
  sanitizado), quanto tempo levou
- Crie um `FlowExecutionError` que wrapa o erro original e adiciona o contexto do fluxo
- Garanta que o stack trace original seja preservado (use `cause` do ES2022)
- Adicione um campo `metadata` opcional nos erros para dados extras

### 10. 🔌 Plugins / Middleware [CONCLUÍDO]

**O que é:** Um sistema de extensão que permite adicionar comportamentos transversais (logging, métricas, auth) sem
modificar o núcleo.

**Guia de implementação:**

- Defina uma interface `FlowPlugin` com hooks opcionais que o plugin pode implementar
- Adicione `plugins?: FlowPlugin[]` ao `FlowConfig`
- Na execução, percorra os plugins e chame os hooks relevantes em ordem
- Implemente pelo menos um plugin built-in como exemplo, como um logger simples
- Esse passo pode absorver os Hooks do item 4 — avalie se quer um sistema de hooks simples ou um sistema de plugins mais
  formal

## Ordem sugerida de implementação

| Prioridade | Feature                       | Motivo                                   | Status        |
|------------|-------------------------------|------------------------------------------|---------------|
| 🔴 Alta    | Persistência (Redis/DynamoDB) | Você já quer isso                        | ✓ Implementado |
| 🔴 Alta    | Validação de Input            | Segurança básica em produção             | ✓ Implementado |
| 🟡 Média   | Retry com Backoff Exponencial | Melhoria incremental no que já existe    | ✓ Implementado |
| 🟡 Média   | Hooks / Eventos               | Habilita observabilidade sem acoplamento | ✓ Implementado |
| 🟡 Média   | Cancelamento com AbortSignal  | Padrão moderno, simples de implementar   | ✓ Implementado |
| 🟢 Baixa   | Execução Paralela             | Mudança mais complexa na arquitetura     | ✓ Implementado |
| 🟢 Baixa   | Controle de Concorrência      | Depende do caso de uso                   |               |
| 🟢 Baixa   | Plugins/Middleware            | Depois de ter hooks funcionando          | ✓ Implementado |
| 🟢 Baixa   | Observabilidade/Traces        | Pode vir depois dos hooks                | ✓ Implementado |
