# 📘 Guia de Padrões para Alterações em Libs TypeScript

> Este guia deve ser seguido por qualquer IA ou desenvolvedor que fizer alterações nesta biblioteca.
> O objetivo é manter o código simples, consistente, testável e fácil de evoluir.

---

## Objetivo da Lib

Esta lib deve ser:

- simples de usar
- fácil de entender
- bem tipada
- previsível
- extensível sem exagero
- segura para uso em produção

A prioridade é criar uma biblioteca pequena, clara e confiável.

---

## Princípios Gerais

### 1. Simplicidade primeiro
Evite arquiteturas complexas.

### 2. API pública estável
Evite breaking changes.

### 3. Código previsível
Sem efeitos colaterais escondidos.

### 4. Tipagem forte
Evite `any`.

---

## Estrutura

```
src/
  core/
  types/
  utils/
  errors/
  index.ts
```

---

## Exportações

Centralizar no `index.ts`.

---

## Organização

Funções pequenas e com responsabilidade única.

---

## Retry

- Opcional
- Controlado
- Sem loop infinito

---

## Idempotência

Deixar comportamento explícito.

---

## Erros

Nunca silenciar erros.

---

## Testes

Cobrir:

- comportamento principal
- erros
- edge cases

---

## Dependências

Evitar libs desnecessárias.

---

## Documentação

Sempre documentar API pública.

---

## Anti-padrões

- any
- funções gigantes
- duplicação
- estado global

---

## Checklist

- Código simples
- Tipado
- Testado
- Documentado

---

## Objetivo

Lib simples, previsível e robusta.

