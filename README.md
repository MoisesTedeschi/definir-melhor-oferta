# Custom Activity: Definir Melhor Oferta

> Custom Journey Builder Activity — REST, executada 1x por contato.

---

## O que essa activity faz

Dentro da Journey, depois do Entry Source (`DE_Entrada_Journey_Oferta`), essa activity:

1. Chama o motor de decisão externo (`MOTOR_DECISAO_URL`) com `SubscriberKey`, `SegmentoCliente`, `CPF_ou_CustomerID`.
2. Recebe a lista de ofertas rankeadas e pega a de maior prioridade.
3. Faz `Lookup` em `DE_Oferta` e `DE_Produto` (revalida `Ativo` e `DataFimVigencia`).
4. Faz `LookupRows` em `DE_Mensagens_Oferta`, filtrando pelo `CanalPreferido` do contato — com fallback pra primeira mensagem ativa disponível se o canal preferido não tiver mensagem cadastrada.
5. Loga o envio em `DE_Log_Oferta_Enviada` (alimenta a supressão de 30 dias da Automation Studio).
6. Devolve `outArguments` (`ofertaEncontrada`, `ofertaId`, `canalEnvio`, `textoMensagem`, `ctaTexto`, `ctaUrl`) para os próximos steps — o Decision Split de Canal e o Custom Send Activity.

---

## Pré-requisitos

- [ ] Servidor com HTTPS público (não roda localhost — o MC precisa alcançar seus endpoints)
- [ ] Data Extensions já criadas: `DE_OFERTA`, `DE_PRODUTO`, `DE_MENSAGENS_OFERTA`, `DE_LOG_OFERTA_ENVIADA` (External Key igual ao nome, em maiúsculo, usado no código)
- [ ] Motor de decisão externo já expõe o contrato descrito em `motorDecisao.js`
- [ ] Installed Package criado no MC (mesmo processo do `triggered-send-setup.md`), com um Component do tipo **Journey Builder Custom Activity**

---

## Passo 1 — Deploy do backend

```bash
npm install
cp .env.example .env
# preencha .env com suas credenciais
npm start
```

Hospede em qualquer serviço que sirva Node (Heroku, Render, AWS, seu próprio servidor). O domínio final substitui todos os `https://SEU-DOMINIO.com` no `config.json`.

---

## Passo 2 — Criar o Installed Package no MC

```
Setup → Apps → Installed Packages → New
Nome: Definir Melhor Oferta
Adicionar Component → Journey Builder Custom Activity
```

Ao criar o Component, o MC pede:

```
Endpoint URL:     https://SEU-DOMINIO.com/          (a tela de config)
Config JSON URL:  https://SEU-DOMINIO.com/config.json
```

Depois de salvo, o MC gera:

```
Execute URL:  já configurado no seu config.json (arguments.execute.url)
JWT Signing Secret:  copie esse valor → JB_JWT_SECRET no seu .env
```

**Reinicie o servidor** depois de atualizar o `.env` com o JWT Secret real.

---

## Passo 3 — Atualizar o config.json

Troque todas as ocorrências de `SEU-DOMINIO.com` pelo domínio real do seu deploy, incluindo o `icon` em `metaData`. Re-hospede o `config.json` atualizado (ele precisa estar acessível publicamente na URL que você informou no Passo 2).

---

## Passo 4 — Usar na Journey

```
Journey Builder → arraste "Definir Melhor Oferta" pro canvas
                   (aparece na categoria "Message" da paleta de activities)
Posicione logo após o Entry Source (DE_Entrada_Journey_Oferta)
Clique na activity → "Done" (não há campos manuais — os inArguments já
                              vêm mapeados do config.json)
```

Depois da activity, adicione um **Decision Split** usando o outArgument `ofertaEncontrada` (`true`/`false`) — trate o caminho `false` como saída limpa ou mensagem de fallback, nunca deixe o contato seguir pro envio sem oferta válida.

Em seguida, um segundo **Decision Split** usando `canalEnvio` direciona pro Custom Send Activity certo (WhatsApp, Push, SMS, Email).

---

## Erros mais comuns

1. **JWT inválido em `/execute`** — geralmente `.env` desatualizado depois de recriar o Installed Package (o secret muda se você recriar o Component).
2. **Timeout do motor de decisão** — o `axios` está com `timeout: 5000`. Se sua API de decisão for mais lenta que isso, ajuste, mas lembre que isso atrasa o processamento de todos os contatos na fila da Journey.
3. **`Lookup` retornando `null`** — confira se o `External Key` da DE no MC é exatamente igual ao usado no código (`DE_OFERTA`, `DE_PRODUTO`, etc.), incluindo maiúsculas.
4. **Activity não aparece na paleta** — o `config.json` publicado precisa ser válido e acessível via HTTPS antes de tentar arrastar a activity pro canvas; erros de JSON malformado falham silenciosamente.

---

## Estrutura do projeto

```
definir-melhor-oferta/
├── config.json          # Definição da activity para o Journey Builder
├── server.js             # Endpoints save/validate/publish/stop/execute
├── jwtMiddleware.js       # Validação do JWT assinado pelo MC
├── sfmcClient.js          # Auth OAuth + Lookup/LookupRows/Insert nas DEs
├── motorDecisao.js        # Chamada à API externa de decisioning
├── public/
│   ├── index.html         # Tela de configuração (iframe no canvas)
│   └── js/main.js          # Postmonger — comunicação com o Journey Builder
└── .env.example
```
