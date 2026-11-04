# Comenta e Recebe — CAU/RS

Responde automaticamente a quem comenta no Instagram do CAU/RS: o comentário
chega por webhook, o sistema reconhece a palavra-chave e manda no direct a
mensagem com o link pedido.

Painel de operação: `https://comenta-e-recebe.comunicacao-b28.workers.dev/painel`

## Estrutura

```
painel/index.html                    esqueleto da página
painel/painel.css                    estilos
painel/painel.js                     a interface inteira
scripts/montar-painel.ts             junta os três dentro da função
scripts/conferir-painel.ts           confere a sintaxe do painel
supabase/functions/comenta/index.ts  servidor + painel montado (GERADO)
.github/workflows/publicar.yml       monta, confere e publica a cada push
```

**Edite `painel/`, nunca o `index.ts`.** O bloco entre os marcadores `PAINEL`
é gerado; qualquer edição ali é perdida na próxima montagem, e o fluxo recusa
publicar se os dois divergirem.

Depois de mexer em `painel/`, rode antes de commitar:

```
deno run --allow-read --allow-write scripts/montar-painel.ts
```

## Por que o painel vive fora

Ele morava dentro de uma template literal no `index.ts`. Ali, toda crase, todo
`${` e toda barra invertida precisam de escape, feito à mão a cada edição.

Foi assim que a versão 2.3 caiu: um `\n` escrito dentro de aspas simples virou
quebra de linha **de verdade** na interpolação, o que é erro de sintaxe, e o
painel inteiro parou de carregar. O servidor continuou funcionando, e por isso
o estrago passou despercebido por horas.

Em arquivo próprio o painel é JavaScript comum. O escape passou a ser feito por
código, uma vez, no montador.

## Como publicar

Commit na `main`. O fluxo monta, confere e publica. Não publique pela CLI nem
pelo painel do Supabase: o repositório deixa de refletir o que está no ar.

Voltar uma versão: `git revert <commit>` e push.

## As duas conferências

`deno check` valida o TypeScript do servidor. Mas ele não enxerga dentro da
template literal, então `conferir-painel.ts` recorta a literal, deixa o motor
avaliá-la como o Deno faria, extrai o `<script>` e tenta compilar.

Pega erro de sintaxe, não erro de comportamento. Garante que a página carrega.

## O que custou caro descobrir

**A DM exige token da Página, não o do usuário do sistema.** No esquema de
login unificado, o token do ambiente serve para ler (listar publicações
funciona), mas o envio precisa do token da Página. Quando o tipo está errado a
Meta responde `code 1`, erro desconhecido, sem dizer nada. A função troca um
pelo outro em `tokenDaPagina()`.

**O usuário do sistema precisa de três vínculos.** Página, conta do Instagram e
o app, todos atribuídos a ele no Gerenciador de Negócios. Faltando qualquer um,
a Meta responde que o objeto não existe ou falta permissão, sem dizer qual.
Pior: o portfólio pode não ter usuário do sistema nenhum, e aí nenhum token
funciona, por mais permissões que tenha.

**O envio vai para `/{PAGE_ID}/messages`, não para o ID do Instagram.** Com
login unificado o caminho é a Página. O ID do Instagram ali devolve erro de
objeto inexistente.

**O botão Teste do webhook não prova nada.** Ele dispara do painel da Meta
direto para a URL, sem passar pela inscrição da conta. Passar nesse teste e
falhar com comentário real é o cenário normal.

**A Meta não reporta comentário de quem administra a conta.** Teste com conta
externa, ou o webhook simplesmente não chega.

**O rastreador da Meta infla os cliques.** Ele abre o link curto assim que a DM
é montada, de vários servidores: numa medição foram seis máquinas para um
humano, e a taxa passou de 600%. A classificação de robô vive no gatilho
`cliques_classificar` do banco, de propósito, para ajustar a lista sem
republicar a função. Cuidado: `instagram` **não** pode estar na lista, porque o
navegador interno do app se identifica assim, e era por ali que vinha o clique
humano.

**O Instagram não aceita formatação na DM.** Texto puro, limite de 1000 bytes
em UTF-8. Não há negrito nem itálico na API, e marcador digitado chega literal.
Quebra de linha e emoji funcionam.

**As métricas são acumuladas, não históricas.** Cada leitura é uma fotografia
datada em `metricas_publicacao`. A série de um post só existe a partir da
primeira leitura; a análise por período usa a data de publicação. Os números
levam até 48 horas para consolidar.

**O Worker do Cloudflare converte o content-type.** O Supabase serve HTML como
texto puro. Sem o Worker, o painel aparece como código na tela.

## Segredos

Nenhum mora neste repositório.

| Onde | Nome | Para quê |
|---|---|---|
| GitHub, em Secrets | `SUPABASE_ACCESS_TOKEN` | o fluxo publicar a função |
| Supabase, em Edge Functions | `IG_ACCESS_TOKEN` | falar com a API da Meta |
| Supabase, em Edge Functions | `IG_APP_SECRET` | conferir a assinatura do webhook |
| Supabase, em Edge Functions | `WEBHOOK_VERIFY_TOKEN` | o aperto de mão inicial da Meta |

Credencial vai do lugar onde nasce direto para o lugar onde é usada. Não passa
por chat, e-mail, documento ou captura de tela. Se passar, é tratada como
queimada e trocada.

## Identificadores, que não são segredo

| O quê | Valor |
|---|---|
| App na Meta | `CAU DM`, ID `999973529820350` |
| Configuração da API | `1858647335556512`, login unificado |
| Conta do Instagram | `caursoficial`, `17841405751553890` |
| Página do Facebook | `1503823319868609` |
| Usuário do sistema | `cau-dm`, `61596163404416` |
| Projeto Supabase | `ryxaqocbihbecwwzyqis` |

## Fora deste repositório

O Worker `comenta-e-recebe` no Cloudflare ainda é editado pelo painel da
Cloudflare. Quase nunca muda; vale trazer para cá um dia.
