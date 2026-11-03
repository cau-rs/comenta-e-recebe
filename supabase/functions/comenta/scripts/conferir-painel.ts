/**
 * Confere a sintaxe do JavaScript que vai dentro do painel.
 *
 * Por que isto existe: o painel mora numa template literal dentro da Edge
 * Function. O Deno valida o arquivo .ts, mas NAO valida o conteudo da string,
 * entao um erro dentro dela passa pelo deploy e so aparece como tela branca no
 * navegador. Foi o que aconteceu na versao 2.3: um \n escrito dentro de aspas
 * simples virou quebra de linha de verdade na interpolacao, e o modulo inteiro
 * parou de carregar.
 *
 * Como funciona: deixa o proprio motor AVALIAR a template literal, em vez de
 * desfazer os escapes na mao. A primeira versao deste script desfazia na mao e
 * deixou passar justamente o \n de uma barra so, que e o caso que importa.
 * Avaliar e a unica forma de obter exatamente o que o Deno produz.
 *
 * O que ele NAO faz: nao testa comportamento. Se a logica estiver errada, ele
 * passa. Ele so garante que a pagina carrega.
 */

const CAMINHO = Deno.args[0] ?? 'supabase/functions/comenta/index.ts';

function erro(msg: string): never {
  console.error('\u274c ' + msg);
  Deno.exit(1);
}

const fonte = await Deno.readTextFile(CAMINHO).catch(() => erro(`nao achei ${CAMINHO}`));

// 1. Recortar a template literal, do backtick de abertura ao ultimo do arquivo.
const abre = fonte.indexOf('const PAGINA = `');
if (abre === -1) erro('nao encontrei a constante PAGINA');
const inicio = fonte.indexOf('`', abre) + 1;
const fim = fonte.lastIndexOf('`');
if (fim <= inicio) erro('nao consegui delimitar a PAGINA');
const bruto = fonte.slice(inicio, fim);

// 2. Descobrir as interpolacoes do servidor. As do painel vem escapadas com
//    \${...} e nao entram nesta conta.
const nomes = new Set<string>();
bruto.replace(/(\\?)\$\{([A-Za-z_$][\w$]*)\}/g, (_m, escapada, nome) => {
  if (!escapada) nomes.add(nome);
  return '';
});
const params = [...nomes];

// 3. Avaliar a literal com valores de mentira. Isso produz exatamente o HTML
//    que o navegador receberia.
let html: string;
try {
  const montar = new Function(...params, 'return `' + bruto + '`');
  html = montar(...params.map(() => 'EXEMPLO'));
} catch (e) {
  const m = e instanceof Error ? e.message : String(e);
  erro(`a template literal da PAGINA nao fecha: ${m}`);
}

// 4. Extrair o modulo do painel.
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!script) erro('nao encontrei o <script type="module"> no painel');

// 5. Compilar sem executar. O import de rede sai antes: new Function nao
//    aceita modulo, e aqui o que se checa e sintaxe, nao dependencia.
const corpo = script[1].replace(/^\s*import[\s\S]*?;\s*$/m, '');

try {
  new Function(corpo);
} catch (e) {
  const m = e instanceof Error ? e.message : String(e);
  erro(`o JavaScript do painel nao compila: ${m}\n`
     + '   Causa comum: quebra de linha ou aspas dentro de uma string.\n'
     + '   Lembre que \\n escrito na template literal vira quebra DE VERDADE;\n'
     + '   para chegar como escape ao navegador, escreva \\\\n.');
}

console.log(`\u2705 painel compila: ${corpo.split('\n').length} linhas conferidas`
  + (params.length ? ` (interpolacoes: ${params.join(', ')})` : ''));
