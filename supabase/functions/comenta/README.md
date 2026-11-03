# Comenta e Recebe — CAU/RS

Responde automaticamente a quem comenta no Instagram do CAU/RS: o comentário
chega por webhook, o sistema reconhece a palavra-chave e manda uma mensagem no
direct com o link pedido.

O painel de operação fica em
`https://comenta-e-recebe.comunicacao-b28.workers.dev/painel`.

## Estrutura

```
supabase/functions/comenta/index.ts   tudo: webhook, envio, link curto, API e painel
scripts/conferir-painel.ts            confere a sintaxe do painel antes do deploy
.github/workflows/publicar.yml        confere e publica a cada push na main
```

O painel mora dentro de uma template literal na própria função. É o maior
defeito da estrutura atual e está na fila para ser separado: hoje, mexer num
rótulo de tela obriga a republicar o mesmo arquivo que carrega o webhook.

## Como publicar

Commit na `main`. O fluxo confere e publica sozinho. Não publique pela CLI
manualmente: o repositório deixa de refletir o que está no ar.

Para voltar uma versão: `git revert <commit>` e push.

## A conferência do painel

`deno check` valida o arquivo TypeScript, mas não enxerga dentro da template
literal onde o painel vive. Um erro ali passava pelo deploy e só aparecia como
tela branca.

O script `conferir-painel.ts` recorta a literal, deixa o motor avaliá-la como o
Deno faria, extrai o `<script>` e tenta compilar. Ele pega erro de sintaxe, não
erro de comportamento.

A armadilha que ele existe para pegar: `\n` escrito dentro da template literal
vira quebra de linha **de verdade** na interpolação. Dentro de aspas simples,
isso é erro de sintaxe e derruba o painel inteiro. Para a sequência chegar ao
navegador como escape, escreva `\\n`.

## Segredos

Nenhum segredo mora neste repositório.

| Onde | Nome | Para quê |
|---|---|---|
| GitHub, em Secrets | `SUPABASE_ACCESS_TOKEN` | o fluxo publicar a função |
| Supabase, em Edge Functions | `IG_ACCESS_TOKEN` | falar com a API da Meta |
| Supabase, em Edge Functions | `IG_APP_SECRET` | conferir a assinatura do webhook |
| Supabase, em Edge Functions | `WEBHOOK_VERIFY_TOKEN` | o aperto de mão inicial da Meta |

Credencial vai do lugar onde nasce direto para o lugar onde é usada. Não passa
por chat, e-mail, documento ou captura de tela. Se passar, é tratada como
queimada e trocada.

## Fora deste repositório

O encaminhador no Cloudflare (`comenta-e-recebe`) ainda é editado pelo painel
da Cloudflare. Ele converte o `content-type` que o Supabase serve como texto
puro, e é por isso que o painel aparece como página e não como código.
