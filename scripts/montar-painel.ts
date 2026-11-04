/**
 * Junta painel/index.html, painel.css e painel.js dentro do index.ts da Edge
 * Function, substituindo tudo entre os marcadores PAINEL.
 *
 * Por que o painel vive fora: dentro de uma template literal, cada crase,
 * cada ${ e cada \ precisa de escape. Foi assim que a versao 2.3 caiu, com um
 * \n que virou quebra de linha de verdade e desmanchou uma string. Em arquivo
 * proprio, o painel e JavaScript comum: o editor confere, o deno check enxerga
 * e a classe inteira de erro desaparece.
 *
 * O escape agora e feito por codigo, aqui, uma vez, e nao a mao em cada edicao.
 *
 * Rode com:  deno run --allow-read --allow-write scripts/montar-painel.ts
 * Com --conferir, nao grava: so avisa se o gerado difere do que esta no disco.
 */

const FUNCAO = 'supabase/functions/comenta/index.ts';
const INICIO = '/* === PAINEL: gerado por scripts/montar-painel.ts, nao edite a mao === */';
const FINAL  = '/* === fim do PAINEL === */';

// As interpolacoes que o servidor resolve. No painel elas aparecem como
// sentinela @@NOME@@, para nao se confundirem com as do proprio painel.
const SERVIDOR = ['SUPABASE_URL', 'CHAVE_PUBLICA', 'VERSAO'];

function erro(msg: string): never {
  console.error('\u274c ' + msg);
  Deno.exit(1);
}

const [html, css, js] = await Promise.all([
  Deno.readTextFile('painel/index.html'),
  Deno.readTextFile('painel/painel.css'),
  Deno.readTextFile('painel/painel.js'),
]).catch(() => erro('nao achei os arquivos em painel/'));

// 1. Remontar a pagina inteira: o CSS e o JS voltam para dentro do HTML.
let pagina = html
  .replace('<link rel="stylesheet" href="painel.css">', `<style>\n${css.trim()}\n</style>`)
  .replace('<script type="module" src="painel.js"></script>',
           `<script type="module">\n${js.trim()}\n</script>`);

if (pagina.includes('painel.css') || pagina.includes('painel.js')) {
  erro('o index.html nao tem as marcacoes esperadas de CSS e JS');
}

// 2. Escapar o que a template literal exige. A ordem importa: a barra invertida
//    vem primeiro, senao ela escaparia as barras que acabamos de inserir.
pagina = pagina
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${');

// 3. Devolver as interpolacoes do servidor, que agora precisam passar vivas.
for (const nome of SERVIDOR) {
  pagina = pagina.replaceAll(`@@${nome}@@`, '${' + nome + '}');
}

const sobrou = pagina.match(/@@[A-Z_]+@@/);
if (sobrou) erro(`sentinela desconhecida no painel: ${sobrou[0]}`);

const bloco = `${INICIO}\nconst PAGINA = \`${pagina.trim()}\`;\n${FINAL}\n`;

const fonte = await Deno.readTextFile(FUNCAO).catch(() => erro(`nao achei ${FUNCAO}`));
const a = fonte.indexOf(INICIO);
const b = fonte.indexOf(FINAL);
if (a === -1 || b === -1) erro(`nao achei os marcadores PAINEL em ${FUNCAO}`);

const novo = fonte.slice(0, a) + bloco + fonte.slice(b + FINAL.length + 1);

if (Deno.args.includes('--conferir')) {
  if (novo !== fonte) {
    erro('o index.ts esta desatualizado em relacao a painel/.\n'
       + '   Rode: deno run --allow-read --allow-write scripts/montar-painel.ts');
  }
  console.log('\u2705 index.ts corresponde aos arquivos de painel/');
  Deno.exit(0);
}

await Deno.writeTextFile(FUNCAO, novo);
console.log(`\u2705 painel montado: ${pagina.length} caracteres`
  + ` (html ${html.length}, css ${css.length}, js ${js.length})`);
