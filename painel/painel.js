import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const sb = createClient('@@SUPABASE_URL@@', '@@CHAVE_PUBLICA@@');
const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const normalizar = (s) => (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
const num = (n) => Number(n ?? 0).toLocaleString('pt-BR');
const bytes = (s) => new TextEncoder().encode(s ?? '').length;
const LOGO = 'data:image/png;base64,__LOGO__';
const marcaImg = (estilo) =>
  `<img class="logo" src="${LOGO}" alt="CAU/RS" ${estilo ? 'style="'+estilo+'"' : ''}>`;
const LIMITE_DM = 1000;
let sessao=null, perfil=null, aba='automacoes', modoTeste=true, contagem=0, pastaAtual='todas', situacao='todas';
const souAdmin = () => perfil?.papel === 'administrador';

document.documentElement.dataset.theme = localStorage.getItem('tema') || 'light';

async function api(rota, opcoes){
  const r = await fetch(rota, { ...opcoes, headers: {
    'content-type':'application/json',
    authorization: 'Bearer ' + sessao.access_token, ...(opcoes?.headers ?? {}) } });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(corpo.erro || 'erro inesperado');
  return corpo;
}

function toast(texto, acao, aoDesfazer){
  document.querySelector('.toast')?.remove();
  const d = document.createElement('div');
  d.className = 'toast';
  d.innerHTML = `<span>${esc(texto)}</span>` + (acao ? `<button>${esc(acao)}</button>` : '');
  if (acao) d.querySelector('button').onclick = () => { d.remove(); aoDesfazer(); };
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 7000);
}

function menuContexto(ev, itens){
  ev.preventDefault();
  document.querySelector('.menu')?.remove();
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML = itens.map((i) => i === '-' ? '<hr>' : `<button class="${i.perigo?'perigo':''}">${esc(i.texto)}</button>`).join('');
  document.body.appendChild(m);
  m.style.left = Math.min(ev.clientX, innerWidth - m.offsetWidth - 10) + 'px';
  m.style.top = Math.min(ev.clientY, innerHeight - m.offsetHeight - 10) + 'px';
  [...m.querySelectorAll('button')].forEach((b, i) => {
    const item = itens.filter((x) => x !== '-')[i];
    b.onclick = () => { m.remove(); item.acao(); };
  });
  setTimeout(() => addEventListener('click', () => m.remove(), { once:true }));
}

const iniciais = (nome) => {
  const p = (nome || '?').trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length-1][0] : '')).toUpperCase();
};

const quando = (iso) => {
  if (!iso) return 'nunca entrou';
  const d = new Date(iso);
  const min = Math.round((new Date() - d) / 60000);
  if (min < 2) return 'agora mesmo';
  if (min < 60) return `há ${min} minutos`;
  if (min < 1440) return `há ${Math.round(min/60)} horas`;
  return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'short' }) + ', '
       + d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
};

// Mesma regra do servidor: no modo botao o [link] sai e so espaco horizontal
// e colapsado, para a quebra de linha sobreviver.
const textoDaMensagem = (bruto, rotulo, link) => rotulo
  ? (bruto ?? '').replace(/\[link\]/gi, '').replace(/[ \t]{2,}/g, ' ')
      .split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').trim()
  : (bruto ?? '').replace(/\[link\]/gi, link);

async function iniciar(){
  const { data } = await sb.auth.getSession();
  sessao = data.session;
  if (!sessao) return telaEntrar();
  const [{ data: c }, { data: p }, { count }] = await Promise.all([
    sb.from('configuracoes').select('valor').eq('chave','modo_teste').maybeSingle(),
    sb.from('perfis').select('nome,email,papel,trocar_senha').eq('id', sessao.user.id).maybeSingle(),
    sb.from('regras').select('id', { count:'exact', head:true }).eq('ativa', true),
  ]);
  modoTeste = c?.valor === true;
  perfil = p;
  contagem = count ?? 0;
  if (perfil?.trocar_senha) return telaTrocarSenha();
  desenhar();
}

function telaTrocarSenha(aviso){
  app.innerHTML = `<div class="formulario" style="min-height:100vh"><div class="caixa">
    ${marcaImg('width:190px;margin-bottom:28px')}
    <h2>Crie sua senha</h2>
    <p class="sub">Você entrou com uma senha provisória. Escolha uma sua para continuar.</p>
    ${aviso ? `<div class="aviso">${esc(aviso)}</div>` : ''}
    <label class="rotulo" for="n1">Nova senha</label>
    <input id="n1" type="password" autocomplete="new-password">
    <label class="rotulo" for="n2">Repita</label>
    <input id="n2" type="password" autocomplete="new-password">
    <button class="btn pri" id="ok" style="width:100%;margin-top:20px">Salvar e entrar</button>
    <p class="primeiro">No mínimo 8 caracteres. Depois disso a senha provisória deixa de valer.</p>
  </div></div>`;
  document.getElementById('ok').onclick = async () => {
    const a = document.getElementById('n1').value, b = document.getElementById('n2').value;
    if (a.length < 8) return telaTrocarSenha('A senha precisa de pelo menos 8 caracteres.');
    if (a !== b) return telaTrocarSenha('As duas senhas não conferem.');
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) return telaTrocarSenha(error.message);
    await sb.from('perfis').update({ trocar_senha:false }).eq('id', sessao.user.id);
    perfil.trocar_senha = false;
    desenhar(); toast('Senha criada. Bem-vindo!');
  };
}

// O painel da marca fica a direita; o formulario, a esquerda.
function telaEntrar(msg, tipo){
  app.innerHTML = `<div class="entrada">
    <div class="formulario"><div class="caixa">
      <h2>Boas-vindas</h2>
      <p class="sub">Entre com seu e-mail e senha para gerenciar as respostas do perfil.</p>
      ${msg ? `<div class="aviso ${tipo==='ok'?'ok':''}" role="status">${esc(msg)}</div>` : ''}
      <label class="rotulo" for="e">E-mail</label>
      <input id="e" type="email" autocomplete="username" inputmode="email">
      <label class="rotulo" for="s">Senha</label>
      <div class="senha"><input id="s" type="password" autocomplete="current-password">
        <button type="button" id="ver">Mostrar</button></div>
      <button class="btn pri" id="b" style="width:100%;margin-top:20px">Entrar</button>
      <button class="elo" id="esqueci">Esqueci minha senha</button>
      <p class="primeiro"><b>Primeiro acesso?</b> Use a senha provisória que a coordenação de Comunicação entregou. O sistema pede uma senha sua logo na entrada.</p>
    </div></div>
    <div class="vitrine">
      <svg class="fundo" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <path d="M300 -100 L620 -100 L300 900 L-20 900 Z" fill="var(--bg)" opacity=".7"/>
        <path d="M120 900 Q 320 480 300 -100 L600 -100 L600 900 Z" fill="var(--sup2)" opacity=".5"/>
      </svg>
      <div class="dentro">
        ${marcaImg()}
        <p class="conselho">Conselho de Arquitetura e Urbanismo do Rio Grande do Sul</p>
        <div class="produto"><h1>Comenta e Recebe</h1>
          <p>Respostas automáticas no Instagram, em um só lugar.</p></div>
      </div>
    </div></div>`;

  const ver = document.getElementById('ver');
  ver.onclick = () => {
    const campo = document.getElementById('s');
    const escondido = campo.type === 'password';
    campo.type = escondido ? 'text' : 'password';
    ver.textContent = escondido ? 'Ocultar' : 'Mostrar';
  };
  const botao = document.getElementById('b');
  const entrar = async () => {
    botao.disabled = true; botao.textContent = 'Entrando…';
    const { error } = await sb.auth.signInWithPassword({
      email: document.getElementById('e').value.trim(),
      password: document.getElementById('s').value });
    if (error) return telaEntrar('E-mail ou senha não conferem. Confira os dados ou use a opção Esqueci minha senha.');
    iniciar();
  };
  botao.onclick = entrar;
  document.getElementById('s').onkeydown = (ev) => { if (ev.key === 'Enter') entrar(); };
  document.getElementById('e').onkeydown = (ev) => { if (ev.key === 'Enter') document.getElementById('s').focus(); };
  document.getElementById('esqueci').onclick = async () => {
    const email = document.getElementById('e').value.trim();
    if (!email) return telaEntrar('Escreva seu e-mail antes de pedir a troca de senha.');
    await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    telaEntrar('Se o e-mail estiver cadastrado, você vai receber um link para criar uma nova senha.', 'ok');
  };
}

const ABAS = { automacoes:'Automações', desempenho:'Desempenho', pessoas:'Pessoas', usuarios:'Usuários', ajustes:'Ajustes' };

function desenhar(){
  app.innerHTML = `<div class="layout">
    <aside>
      <div class="marca">${marcaImg()}
        <div class="apoio">Comenta e Recebe</div></div>
      <nav>${Object.entries(ABAS).map(([k,v]) => `<a data-aba="${k}" ${k===aba?'aria-current="page"':''}>${v}
        ${k==='automacoes'&&contagem?`<span class="pilula">${contagem}</span>`:''}</a>`).join('')}</nav>
      <div class="rodape">
        <div class="euzinho"><span class="inicial" aria-hidden="true">${esc(iniciais(perfil?.nome))}</span>
          <span style="min-width:0">
            <span style="display:block;font-size:13px;color:var(--tx2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(perfil?.nome ?? '')}</span>
            <span style="display:block;font-size:12px;color:var(--tx3)">${souAdmin() ? 'Administrador' : 'Editor'}</span>
          </span></div>
        <a id="sair">Sair</a>
      </div>
    </aside>
    <div class="palco"><main id="conteudo"></main></div></div>
    ${aba==='automacoes'?'<button class="fab" id="fab" title="Nova automação" aria-label="Nova automação">+</button>':''}`;

  app.querySelectorAll('nav a').forEach((a) => { a.onclick = () => { aba = a.dataset.aba; desenhar(); }; });
  document.getElementById('sair').onclick = async () => { await sb.auth.signOut(); location.reload(); };
  const fab = document.getElementById('fab');
  if (fab) fab.onclick = () => assistente();
  ({ automacoes: abaAutomacoes, desempenho: abaDesempenho, pessoas: abaPessoas,
     usuarios: abaUsuarios, ajustes: abaAjustes })[aba]();
}

function tarja(){
  return modoTeste ? `<div class="tarja"><span>Modo de teste ligado. Só as contas testadoras recebem mensagem.</span>
    ${souAdmin() ? '<button class="btn sm" id="desligar">Desligar</button>' : ''}</div>` : '';
}
function ligarTarja(){
  const b = document.getElementById('desligar');
  if (b) b.onclick = async () => {
    await sb.from('configuracoes').update({ valor:false }).eq('chave','modo_teste');
    modoTeste = false; desenhar();
    toast('Modo de teste desligado', 'Desfazer', async () => {
      await sb.from('configuracoes').update({ valor:true }).eq('chave','modo_teste');
      modoTeste = true; desenhar();
    });
  };
}

/* --------------------------------------------------------- automacoes */

let resultados = {};

async function abaAutomacoes(){
  const c = document.getElementById('conteudo');
  c.innerHTML = tarja() + '<p class="sub">Carregando automações…</p>';
  ligarTarja();

  const [{ data: itens, error }, { data: pastas }, { data: medidas }] = await Promise.all([
    sb.from('regras').select('*, pastas(nome)').order('criado_em', { ascending:false }),
    sb.from('pastas').select('*').order('criado_em'),
    sb.from('desempenho_por_regra').select('*'),
  ]);
  if (error) { c.innerHTML = tarja() + `<div class="aviso">Não foi possível carregar: ${esc(error.message)}</div>`; return ligarTarja(); }

  resultados = Object.fromEntries((medidas ?? []).map((m) => [m.regra_id, m]));
  const soma = (k) => (medidas ?? []).reduce((t,l) => t + Number(l[k] ?? 0), 0);

  const visiveis = itens.filter((r) =>
    (pastaAtual === 'todas' || (pastaAtual === 'soltas' ? !r.pasta_id : r.pasta_id === pastaAtual)) &&
    (situacao === 'todas' || (situacao === 'ativas' ? r.ativa : !r.ativa)));

  c.innerHTML = tarja() + `<div class="topo">
      <div class="cresce"><h1>Automações</h1>
        <p>Respostas automáticas a quem comenta no Instagram.</p></div>
      <button class="btn" id="npasta">Nova pasta</button>
      <button class="btn pri" id="nova">Criar automação</button></div>
    <div class="numeros">
      <div class="numero"><b>${itens.filter((r)=>r.ativa).length}</b><span>automações ativas</span></div>
      <div class="numero"><b>${num(soma('comentarios'))}</b><span>comentários recebidos</span></div>
      <div class="numero"><b>${num(soma('dms_enviadas'))}</b><span>conversas iniciadas</span></div>
      <div class="numero"><b>${num(soma('cliques'))}</b><span>cliques no link</span></div>
    </div>
    <p class="sub" style="margin:0 0 20px">Desde o início. O recorte por período fica em Desempenho.</p>
    <div id="form"></div>
    ${(pastas ?? []).length ? `<div class="pastas">
      <button class="chipsel mini" data-pasta="todas" aria-pressed="${pastaAtual==='todas'}">Todas as pastas</button>
      ${pastas.map((p) => `<button class="chipsel mini" data-pasta="${p.id}" aria-pressed="${pastaAtual===p.id}">${esc(p.nome)}
        ${itens.filter((r)=>r.pasta_id===p.id).length}</button>`).join('')}
      <button class="chipsel mini" data-pasta="soltas" aria-pressed="${pastaAtual==='soltas'}">Sem pasta</button>
    </div>` : ''}
    <div class="pastas">
      <button class="chipsel mini" data-sit="todas" aria-pressed="${situacao==='todas'}">Todas</button>
      <button class="chipsel mini" data-sit="ativas" aria-pressed="${situacao==='ativas'}">Ativas</button>
      <button class="chipsel mini" data-sit="pausadas" aria-pressed="${situacao==='pausadas'}">Pausadas</button>
    </div>
    ${visiveis.length ? `<div class="lista">${visiveis.map(linhaAutomacao).join('')}</div>`
      : (itens.length ? '<div class="vazio"><b>Nada neste filtro</b><span>Troque a pasta ou a situação acima.</span></div>'
        : '<div class="vazio"><b>Nenhuma automação ainda</b><span>Crie a primeira para começar a responder comentários.</span></div>')}`;
  ligarTarja();

  document.getElementById('nova').onclick = () => assistente();
  document.getElementById('npasta').onclick = async () => {
    const nome = prompt('Nome da pasta');
    if (!nome?.trim()) return;
    await sb.from('pastas').insert({ nome: nome.trim() });
    abaAutomacoes(); toast('Pasta criada');
  };
  c.querySelectorAll('[data-pasta]').forEach((b) => { b.onclick = () => { pastaAtual = b.dataset.pasta; abaAutomacoes(); }; });
  c.querySelectorAll('[data-sit]').forEach((b) => { b.onclick = () => { situacao = b.dataset.sit; abaAutomacoes(); }; });

  c.querySelectorAll('[data-id]').forEach((el) => {
    const r = itens.find((x) => x.id === el.dataset.id);
    el.oncontextmenu = (ev) => menuContexto(ev, [
      { texto:'Editar', acao:() => assistente(r) },
      { texto: r.ativa ? 'Pausar' : 'Ativar', acao:() => alternar(r) },
      { texto:'Duplicar', acao:() => duplicar(r) },
      '-', { texto:'Excluir', perigo:true, acao:() => excluir(r) },
    ]);
    el.querySelector('[data-editar]').onclick = () => assistente(r);
    el.querySelector('[data-alternar]').onclick = () => alternar(r);
    const bx = el.querySelector('[data-excluir]');
    if (!bx) return;
    let armado = false;
    bx.onclick = () => {
      if (!armado) { armado = true; bx.classList.add('armado'); bx.textContent = 'Confirmar';
        setTimeout(() => { armado = false; bx.classList.remove('armado'); bx.textContent = 'Excluir'; }, 4000); return; }
      excluir(r);
    };
  });
}

function alcance(r){
  if (r.alvo === 'qualquer') return 'Qualquer publicação';
  if (r.alvo === 'proxima' && !r.media_id) return 'Aguardando a próxima publicação';
  return `<a href="${esc(r.permalink||'#')}" target="_blank" rel="noopener" style="color:var(--acc-tx)">Publicação específica</a>`;
}

function capa(r){
  if (r.miniatura_url) return `<img class="capa" src="${esc(r.miniatura_url)}" alt="" loading="lazy">`;
  if (r.alvo === 'qualquer') return '<div class="capa vazia">todas</div>';
  if (r.alvo === 'proxima') return '<div class="capa vazia">próxima</div>';
  return '<div class="capa vazia">post</div>';
}

function linhaAutomacao(r){
  const esperando = r.alvo === 'proxima' && !r.media_id;
  const m = resultados[r.id] ?? {};
  const temBotao = (r.rotulo_botao ?? '').trim();
  const formato = temBotao ? `botão “${esc(r.rotulo_botao)}”` : 'link no texto';
  const placar = esperando
    ? '<div class="sub">Sem números ainda. Começa a contar quando a próxima publicação sair.</div>'
    : `<div class="placar">
        <div><b>${num(m.comentarios)}</b>comentários</div>
        <div><b>${num(m.dms_enviadas)}</b>conversas</div>
        ${temBotao
          ? `<div><b>${num(m.cliques)}</b>cliques</div>
             <div><b>${m.taxa_de_clique ?? 0}%</b>por conversa</div>`
          : '<div><b class="mudo">—</b>link no texto não mede</div>'}
        ${m.dms_recusadas ? `<div><b class="ruim">${num(m.dms_recusadas)}</b>recusaram</div>` : ''}
        ${m.erros ? `<div><b class="ruim">${num(m.erros)}</b>erros</div>` : ''}
      </div>`;
  return `<div class="linha" data-id="${r.id}">
    ${capa(r)}
    <div class="cresce"><h3>${esc(r.nome)}</h3>
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${(r.palavras_chave||[]).map((p)=>`<span class="chip">${esc(p)}</span>`).join('')}</div>
      <div class="sub">${alcance(r)}, ${formato}${r.pastas?.nome ? ', em ' + esc(r.pastas.nome) : ''}</div>
      ${placar}
    </div>
    <span class="chip ${!r.ativa ? '' : esperando ? 'and' : 'ok'}">${!r.ativa ? 'Pausada' : esperando ? 'Agendada' : 'Ativa'}</span>
    <button class="btn sm" data-editar>Editar</button>
    <button class="btn sm" data-alternar>${r.ativa?'Pausar':'Ativar'}</button>
    ${souAdmin() ? '<button class="btn sm" data-excluir>Excluir</button>' : ''}
  </div>`;
}

async function alternar(r){
  const { error } = await sb.from('regras').update({ ativa: !r.ativa, atualizado_por: sessao.user.id }).eq('id', r.id);
  if (error) return toast(error.message);
  abaAutomacoes();
  toast(r.ativa ? 'Automação pausada' : 'Automação ativada', 'Desfazer', async () => {
    await sb.from('regras').update({ ativa: r.ativa }).eq('id', r.id); abaAutomacoes();
  });
}
async function duplicar(r){
  const { id, criado_em, atualizado_em, pastas, ...resto } = r;
  const { error } = await sb.from('regras').insert({ ...resto, nome: r.nome + ' (cópia)', ativa:false,
    codigo_curto: Math.random().toString(36).slice(2,8), criado_por: sessao.user.id });
  if (error) return toast(error.message);
  abaAutomacoes(); toast('Automação duplicada, pausada');
}
async function excluir(r){
  const { error } = await sb.from('regras').delete().eq('id', r.id);
  if (error) return toast('Só administrador pode excluir. Pause no lugar.');
  abaAutomacoes(); toast('Automação excluída');
}

/* ------------------------------------------- assistente em tres etapas */

let rascunho = null, etapa = 1, publicacoesCache = null;

function assistente(regra){
  const e = regra ?? {};
  rascunho = {
    id: e.id ?? null, nome: e.nome ?? '', alvo: e.alvo ?? 'publicacao',
    pasta_id: e.pasta_id ?? '', media_id: e.media_id ?? null,
    permalink: e.permalink ?? null, miniatura_url: e.miniatura_url ?? null, legenda: '',
    palavras: (e.palavras_chave ?? []).join(', '), link: e.link ?? '',
    rotulo_botao: e.rotulo_botao ?? '',
    mensagem: e.mensagem_dm ?? 'Oi! Que bom ter você por aqui.\n\nAqui está o que você pediu: [link]',
    publica: e.resposta_publica ?? '', recusa: e.resposta_publica_recusa ?? '',
  };
  etapa = 1;
  desenharEtapa();
}

function trilha(){
  const nomes = ['Gatilho','Mensagem','Confirmação'];
  return `<ol class="passos">${nomes.map((n,i) => {
    const k = i + 1;
    const classe = k === etapa ? 'aqui' : (k < etapa ? 'feito' : '');
    const bolha = k < etapa
      ? '<span class="bolha" aria-hidden="true"><svg width="13" height="13" viewBox="0 0 16 16"><path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg></span>'
      : `<span class="bolha">${k}</span>`;
    return `<li class="${classe}">${bolha}<span>${n}</span></li>`
      + (k < 3 ? '<li class="risco" aria-hidden="true"></li>' : '');
  }).join('')}</ol>`;
}

function desenharEtapa(){
  const c = document.getElementById('conteudo');
  c.innerHTML = `<div class="topo"><div class="cresce">
      <p style="margin:0;font-size:12px;color:var(--tx3)">Automações</p>
      <h1>${rascunho.id ? 'Editar automação' : 'Nova automação'}</h1></div>
      <button class="btn ghost" id="xis">Cancelar</button></div>
    ${trilha()}<div id="etapa"></div>`;
  document.getElementById('xis').onclick = () => abaAutomacoes();
  ({ 1: etapaGatilho, 2: etapaMensagem, 3: etapaConfirmar })[etapa]();
}

async function etapaGatilho(){
  const d = document.getElementById('etapa');
  const { data: pastas } = await sb.from('pastas').select('*').order('criado_em');
  const opcoes = [
    ['publicacao','Uma publicação','A mais usada. Vale para um post ou reel específico.'],
    ['proxima','A próxima que eu publicar','Fica aguardando e se prende ao próximo post que sair.'],
    ['qualquer','Qualquer publicação','Rede de segurança, só onde não houver automação própria.'],
  ];

  d.innerHTML = `<h2>Onde e quando responder?</h2>
    <p class="sub" style="margin-bottom:24px">Escolha a publicação que vai receber os comentários e as palavras que acionam a resposta.</p>
    <div class="campo"><label for="nome">Nome</label><div>
      <input id="nome" value="${esc(rascunho.nome)}" placeholder="Edital de educação patrimonial">
      <span class="dica">É assim que a equipe encontra a automação depois.</span></div></div>
    ${(pastas ?? []).length ? `<div class="campo"><label for="pasta">Pasta</label><div><select id="pasta">
      <option value="">Sem pasta</option>
      ${pastas.map((p)=>`<option value="${p.id}" ${p.id===rascunho.pasta_id?'selected':''}>${esc(p.nome)}</option>`).join('')}
    </select></div></div>` : ''}
    <div class="campo"><label>Alcance</label><div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px">
      ${opcoes.map(([v,t,s]) => `<label style="display:block;border:${rascunho.alvo===v?'2px':'1px'} solid ${rascunho.alvo===v?'var(--mag)':'var(--ln)'};background:var(--sup);border-radius:6px;padding:15px;cursor:pointer">
        <span style="display:flex;align-items:center;gap:10px">
          <input type="radio" name="alvo" value="${v}" ${rascunho.alvo===v?'checked':''} style="width:18px;height:18px;accent-color:var(--mag)">
          <span style="font-weight:600">${t}</span></span>
        <span style="display:block;font-size:13px;color:var(--tx2);margin:8px 0 0 28px">${s}</span></label>`).join('')}
      </div></div></div>
    <div class="campo" id="caixaposts"><label>Publicação</label><div>
      <div class="posts" id="posts"></div></div></div>
    <div class="campo"><label for="chaves">Palavras</label><div>
      <input id="chaves" value="${esc(rascunho.palavras)}" placeholder="edital, quero o edital">
      <div id="lidas" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"></div>
      <div id="conflito"></div>
      <span class="dica">Separe por vírgula. Não diferencia maiúsculas nem acentos; basta a palavra aparecer no comentário.</span></div></div>
    <div style="display:flex;gap:12px;align-items:center;border-top:1px solid var(--ln);padding-top:20px;flex-wrap:wrap">
      <span class="sub" style="flex:1;margin:0">Etapa 1 de 3</span>
      <button class="btn pri" id="adiante">Continuar</button></div>`;

  d.querySelectorAll('input[name=alvo]').forEach((i) => {
    i.onchange = () => { rascunho.alvo = i.value; if (i.value !== 'publicacao') rascunho.media_id = null; etapaGatilho(); };
  });
  const caixa = document.getElementById('caixaposts');
  if (rascunho.alvo !== 'publicacao') caixa.style.display = 'none';
  else carregarPosts();

  const chaves = () => document.getElementById('chaves').value.split(',').map((s)=>s.trim()).filter(Boolean);
  let espera;
  const checar = () => {
    document.getElementById('lidas').innerHTML = chaves().map((p)=>`<span class="chip">${esc(normalizar(p))}</span>`).join('');
    const cx = document.getElementById('conflito');
    cx.innerHTML = '';
    if (!chaves().length || (rascunho.alvo === 'publicacao' && !rascunho.media_id)) return;
    clearTimeout(espera);
    espera = setTimeout(async () => {
      const { data } = await sb.rpc('conflitos_de_regra', { p_id: rascunho.id, p_alvo: rascunho.alvo,
        p_media_id: rascunho.media_id, p_palavras: chaves() });
      if (data?.length) cx.innerHTML = `<div class="aviso atencao">A palavra <b>${esc(data[0].palavra)}</b> já é usada por <b>${esc(data[0].nome)}</b> no mesmo alcance. Só uma das duas vai responder.</div>`;
    }, 400);
  };
  document.getElementById('chaves').oninput = checar;
  checar();

  document.getElementById('adiante').onclick = () => {
    rascunho.nome = document.getElementById('nome').value.trim();
    rascunho.pasta_id = document.getElementById('pasta')?.value || '';
    rascunho.palavras = document.getElementById('chaves').value;
    if (!rascunho.nome) return toast('Dê um nome à automação');
    if (rascunho.alvo === 'publicacao' && !rascunho.media_id) return toast('Escolha a publicação ou troque o alcance');
    if (!chaves().length) return toast('Informe pelo menos uma palavra');
    etapa = 2; desenharEtapa();
  };
}

async function carregarPosts(){
  const grade = document.getElementById('posts');
  grade.innerHTML = '<p class="sub">Buscando publicações…</p>';
  if (!publicacoesCache) {
    try { publicacoesCache = await api('/api/publicacoes'); }
    catch (err) {
      grade.innerHTML = `<div class="aviso">Não foi possível buscar as publicações.<small>${esc(String(err.message))}</small></div>`;
      return;
    }
  }
  grade.innerHTML = publicacoesCache.map((p) => `<button type="button" class="post" data-id="${p.media_id}"
    data-link="${esc(p.permalink)}" data-mini="${esc(p.miniatura||'')}" data-leg="${esc(p.legenda||'')}"
    aria-pressed="${p.media_id===rascunho.media_id}">
    <img src="${esc(p.miniatura)}" alt="" loading="lazy"><small>${esc(p.legenda||p.tipo)}</small></button>`).join('');
  grade.querySelectorAll('.post').forEach((b) => {
    b.onclick = () => {
      const marcada = b.getAttribute('aria-pressed') === 'true';
      grade.querySelectorAll('.post').forEach((o) => o.setAttribute('aria-pressed','false'));
      b.setAttribute('aria-pressed', marcada ? 'false' : 'true');
      if (marcada) { rascunho.media_id = null; rascunho.legenda = ''; }
      else {
        rascunho.media_id = b.dataset.id; rascunho.permalink = b.dataset.link;
        rascunho.miniatura_url = b.dataset.mini; rascunho.legenda = b.dataset.leg;
      }
    };
  });
}

function etapaMensagem(){
  const d = document.getElementById('etapa');
  d.innerHTML = `<div style="display:grid;grid-template-columns:minmax(340px,1fr) 300px;gap:36px;align-items:start" id="duas">
    <div>
      <h2>O que a pessoa recebe</h2>
      <p class="sub" style="margin-bottom:24px">A mensagem chega no direct poucos segundos depois do comentário.</p>
      <div class="campo"><label for="link">Link</label><div>
        <input id="link" type="url" inputmode="url" value="${esc(rascunho.link)}" placeholder="https://caurs.gov.br/..."></div></div>
      <div class="campo"><label for="rotulo">Texto do botão</label><div>
        <input id="rotulo" maxlength="20" value="${esc(rascunho.rotulo_botao)}" placeholder="Ler a matéria">
        <div id="expbotao" class="dica"></div></div></div>
      <div class="campo"><label for="msg">Mensagem</label><div>
        <textarea id="msg" rows="5">${esc(rascunho.mensagem)}</textarea>
        <span class="dica"><span class="contador" id="contador"></span><span id="dicamsg"></span></span>
        <div class="aviso info" style="margin:12px 0 0;font-size:13px">O Instagram entrega a mensagem como <b>texto puro</b>. Não há negrito, itálico nem tachado na API, e um marcador digitado chegaria literal. Quebra de linha, parágrafo e emoji funcionam normalmente.</div>
      </div></div>
      <div class="campo"><label for="pub">No post</label><div>
        <input id="pub" value="${esc(rascunho.publica)}" placeholder="Te enviamos no direct!">
        <span class="dica">Opcional. Vira comentário público quando a mensagem é entregue.</span></div></div>
      <div class="campo"><label for="rec">Se recusarem</label><div>
        <input id="rec" value="${esc(rascunho.recusa)}" placeholder="O link está na bio.">
        <span class="dica">Opcional. Para quem bloqueia mensagens de perfis comerciais.</span></div></div>
      <div style="display:flex;gap:12px;align-items:center;border-top:1px solid var(--ln);padding-top:20px;flex-wrap:wrap">
        <button class="btn" id="voltar">Voltar</button>
        <span class="sub" style="flex:1;margin:0">Etapa 2 de 3</span>
        <button class="btn pri" id="adiante">Continuar</button></div>
    </div>
    <aside>
      <h3 style="font-size:13px;color:var(--tx2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">Prévia</h3>
      <div id="previa"></div>
    </aside></div>`;

  if (innerWidth < 980) document.getElementById('duas').style.gridTemplateColumns = '1fr';

  const ver = () => {
    const rotulo = document.getElementById('rotulo').value.trim();
    const link = document.getElementById('link').value;
    document.getElementById('expbotao').innerHTML = rotulo
      ? 'A mensagem vai com botão e nenhum endereço aparece. Os cliques são contados. <b>O botão não aparece para quem lê o direct pelo navegador do computador.</b>'
      : 'Vazio, a mensagem vai como texto com o endereço inteiro à mostra, e os cliques não são contados.';
    document.getElementById('dicamsg').textContent = rotulo
      ? 'No modo botão o [link] sai do texto, porque o endereço vive no botão.'
      : 'Use [link] onde o endereço deve entrar.';

    const texto = textoDaMensagem(document.getElementById('msg').value, rotulo, link || 'https://…');
    const n = bytes(texto);
    const cont = document.getElementById('contador');
    cont.textContent = `${n} de ${LIMITE_DM} bytes`;
    cont.className = 'contador' + (n > LIMITE_DM ? ' cheio' : '');

    const pub = document.getElementById('pub').value;
    document.getElementById('previa').innerHTML =
      `<div class="balao">${esc(texto)}${rotulo ? `<span class="botaodm">${esc(rotulo)}</span>` : ''}</div>`
      + (pub ? `<div class="balao pub" style="margin-top:10px"><b>@caursoficial</b> ${esc(pub)}</div>` : '');
  };
  ['link','rotulo','msg','pub'].forEach((id) => { document.getElementById(id).oninput = ver; });
  ver();

  const guardar = () => {
    rascunho.link = document.getElementById('link').value.trim();
    rascunho.rotulo_botao = document.getElementById('rotulo').value.trim();
    rascunho.mensagem = document.getElementById('msg').value;
    rascunho.publica = document.getElementById('pub').value.trim();
    rascunho.recusa = document.getElementById('rec').value.trim();
  };
  document.getElementById('voltar').onclick = () => { guardar(); etapa = 1; desenharEtapa(); };
  document.getElementById('adiante').onclick = () => {
    guardar();
    if (!rascunho.link) return toast('Informe o link que a pessoa vai receber');
    const n = bytes(textoDaMensagem(rascunho.mensagem, rascunho.rotulo_botao, rascunho.link));
    if (n > LIMITE_DM) return toast(`A mensagem tem ${n} bytes; o limite da Meta é ${LIMITE_DM}`);
    etapa = 3; desenharEtapa();
  };
}

function etapaConfirmar(){
  const d = document.getElementById('etapa');
  const chaves = rascunho.palavras.split(',').map((s)=>s.trim()).filter(Boolean);
  const onde = rascunho.alvo === 'qualquer' ? 'em <mark>qualquer publicação</mark>'
    : rascunho.alvo === 'proxima' ? 'na <mark>próxima publicação</mark> que sair'
    : `na publicação <a href="${esc(rascunho.permalink||'#')}" target="_blank" rel="noopener">${esc(rascunho.legenda || 'escolhida')}</a>`;
  const entrega = rascunho.rotulo_botao
    ? `enviar uma mensagem no direct com o botão <mark>${esc(rascunho.rotulo_botao)}</mark>`
    : 'enviar uma mensagem no direct com o link no texto';

  d.innerHTML = `<h2>Confira antes de ativar</h2>
    <p class="sub" style="margin-bottom:24px">Leia como se fosse uma frase. Se fizer sentido, está pronta.</p>
    <div class="frase">Quando alguém comentar
      ${chaves.map((p)=>`<mark>${esc(p)}</mark>`).join(' ou ')}
      ${onde}, ${entrega}${rascunho.publica ? ` e responder no post <b>“${esc(rascunho.publica)}”</b>` : ''}.</div>
    ${modoTeste ? '<div class="aviso atencao">O <b>modo de teste está ligado</b>. Só as contas testadoras recebem a mensagem; quem comentar fora da lista fica registrado e não recebe nada.</div>' : ''}
    <div style="display:flex;gap:12px;align-items:center;border-top:1px solid var(--ln);padding-top:20px;flex-wrap:wrap;margin-top:22px">
      <button class="btn" id="voltar">Voltar</button>
      <span style="flex:1"></span>
      <button class="btn" id="pausada">Salvar pausada</button>
      <button class="btn pri" id="ativar">${rascunho.id ? 'Salvar e ativar' : 'Ativar agora'}</button></div>`;

  document.getElementById('voltar').onclick = () => { etapa = 2; desenharEtapa(); };
  document.getElementById('pausada').onclick = () => salvar(false);
  document.getElementById('ativar').onclick = () => salvar(true);
}

async function salvar(ativa){
  const dados = {
    nome: rascunho.nome, alvo: rascunho.alvo,
    media_id: rascunho.alvo === 'publicacao' ? rascunho.media_id : null,
    permalink: rascunho.alvo === 'publicacao' ? rascunho.permalink : null,
    miniatura_url: rascunho.alvo === 'publicacao' ? rascunho.miniatura_url : null,
    pasta_id: rascunho.pasta_id || null,
    palavras_chave: rascunho.palavras.split(',').map((s)=>s.trim()).filter(Boolean),
    mensagem_dm: rascunho.mensagem, link: rascunho.link,
    rotulo_botao: rascunho.rotulo_botao || null,
    resposta_publica: rascunho.publica || null,
    resposta_publica_recusa: rascunho.recusa || null,
    ativa,
  };
  const { error } = rascunho.id
    ? await sb.from('regras').update({ ...dados, atualizado_por: sessao.user.id }).eq('id', rascunho.id)
    : await sb.from('regras').insert({ ...dados, codigo_curto: Math.random().toString(36).slice(2,8), criado_por: sessao.user.id });
  if (error) return toast(error.message.replace(/^.*P0001:\s*/, ''));
  abaAutomacoes();
  toast(ativa ? 'Automação ativa' : 'Salva, pausada');
}

/* ------------------------------------------------------ nuvem de palavras */

function desenharNuvem(el, itens){
  if (!itens.length) return;
  const L = Math.max(el.clientWidth || 680, 320);
  const A = Math.round(L * (L < 560 ? 0.95 : 0.58));
  const maior = itens[0][1], menor = itens[itens.length-1][1];
  const cores = ['var(--tx)','var(--late)','var(--ok)','var(--rev)','var(--and)','var(--acc-tx)'];
  const medidor = document.createElement('canvas').getContext('2d');
  const ocupadas = [], postas = [];

  itens.forEach(([palavra, n], i) => {
    const t = maior === menor ? 1 : (n - menor) / (maior - menor);
    const corpo = Math.round(14 + Math.pow(t, 0.6) * (L / 11));
    const girada = i > 2 && i % 7 === 3;
    medidor.font = `700 ${corpo}px Manrope, sans-serif`;
    const larg = medidor.measureText(palavra).width + 4, alt = corpo * 0.98;
    const cx = girada ? alt : larg, cy = girada ? larg : alt;

    let x = 0, y = 0, coube = false;
    for (let passo = 0; passo < 3000; passo++) {
      const ang = passo * 0.3, raio = 1.9 * ang;
      x = L/2 + raio * Math.cos(ang) - cx/2;
      y = A/2 + raio * Math.sin(ang) * 0.58 - cy/2;
      if (x < 1 || y < 1 || x + cx > L - 1 || y + cy > A - 1) continue;
      const bate = ocupadas.some((o) =>
        x < o.x + o.w + 2 && x + cx + 2 > o.x && y < o.y + o.h + 2 && y + cy + 2 > o.y);
      if (!bate) { coube = true; break; }
    }
    if (!coube) return;
    ocupadas.push({ x, y, w: cx, h: cy });
    postas.push({ palavra, corpo, girada, cx: x + cx/2, cy: y + cy/2, cor: cores[i % cores.length], n });
  });

  el.innerHTML = `<svg viewBox="0 0 ${L} ${A}" role="img" aria-label="Palavras mais comentadas">`
    + postas.map((p) => `<text x="${p.cx.toFixed(1)}" y="${p.cy.toFixed(1)}" text-anchor="middle"
        dominant-baseline="central" font-size="${p.corpo}" font-weight="700" fill="${p.cor}"
        ${p.girada ? `transform="rotate(-90 ${p.cx.toFixed(1)} ${p.cy.toFixed(1)})"` : ''}>
        <title>${esc(p.palavra)} — ${p.n} comentários</title>${esc(p.palavra)}</text>`).join('')
    + '</svg>';
}

/* --------------------------------------------------------- desempenho */

/**
 * Cada coluna carrega a propria explicacao, mostrada ao passar o mouse no
 * cabecalho e repetida num glossario aberto embaixo. O mouse sozinho nao
 * serve: nao existe em celular e nao chega a leitor de tela.
 */
const NOMEF = { CAROUSEL_ALBUM:'Carrossel', IMAGE:'Feed', VIDEO:'Reels' };
const COLUNAS = {
  data:              { nome:'Data', n:false, v:(p) => new Date(p.publicado_em).toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}),
                       ajuda:'Dia em que a publicação foi ao ar.' },
  formato:           { nome:'Formato', n:false, v:(p) => NOMEF[p.formato] ?? (p.formato ?? ''),
                       ajuda:'Como a Meta classifica a mídia: Feed (imagem única), Carrossel (várias) ou Reels (vídeo).' },
  alcance:           { nome:'Alcance', n:true,
                       ajuda:'Contas únicas que viram a publicação. Quem volta a ver conta uma vez só.' },
  visualizacoes:     { nome:'Visualizações', n:true,
                       ajuda:'Quantas vezes a publicação foi exibida, somando as repetições da mesma pessoa. É sempre maior ou igual ao alcance.' },
  interacoes:        { nome:'Interações', n:true,
                       ajuda:'Soma de curtidas, comentários, salvamentos e compartilhamentos.' },
  taxa_interacao:    { nome:'Por alcance', n:true, pct:true,
                       ajuda:'Interações dividido por alcance, vezes 100. Quanto de quem viu reagiu de alguma forma. Normaliza post grande e pequeno.' },
  curtidas:          { nome:'Curtidas', n:true,
                       ajuda:'Corações na publicação. O sinal mais barato: custa um toque.' },
  comentarios:       { nome:'Comentários', n:true,
                       ajuda:'Comentários recebidos, incluindo os que não acionam automação.' },
  salvamentos:       { nome:'Salvos', n:true,
                       ajuda:'Quem guardou para ver depois. Sinal de conteúdo útil, não só agradável.' },
  compartilhamentos: { nome:'Compartilhados', n:true,
                       ajuda:'Quem repassou no direct ou nos stories. É o que leva a publicação para fora de quem já segue.' },
  intencao:          { nome:'Salvos+comp.', n:true,
                       ajuda:'Salvamentos mais compartilhamentos. Os dois gestos que exigem decisão, por isso dizem mais que a curtida.' },
  dms_enviadas:      { nome:'Conversas', n:true,
                       ajuda:'Mensagens entregues no direct pela automação desta publicação.' },
  cliques:           { nome:'Cliques', n:true,
                       ajuda:'Aberturas do link curto, já descontados rastreadores e repetições da mesma origem em 90 segundos. Só existe no modo botão.' },
};
const PADRAO = ['data','formato','alcance','visualizacoes','interacoes','taxa_interacao'];

let periodo = 90, ordem = 'taxa_interacao', soFormato = 'todos', soAutomacao = false;
let colunas = (() => {
  try {
    const g = JSON.parse(localStorage.getItem('colunas') || 'null');
    if (Array.isArray(g) && g.length && g.every((k) => COLUNAS[k])) return g;
  } catch { /* usa o padrao */ }
  return [...PADRAO];
})();

const mediana = (xs) => {
  const v = xs.filter((n) => n != null).map(Number).sort((a,b) => a-b);
  if (!v.length) return null;
  const m = Math.floor(v.length/2);
  return v.length % 2 ? v[m] : Math.round((v[m-1]+v[m])/2);
};
const celula = (p, k) => {
  const c = COLUNAS[k];
  if (!c.n) return c.v(p);
  const bruto = p[k];
  if (bruto == null) return '—';
  return c.pct ? bruto + '%' : num(bruto);
};

async function abaDesempenho(){
  const c = document.getElementById('conteudo');
  c.innerHTML = tarja() + '<p class="sub">Somando números…</p>';
  const desde = new Date(Date.now() - periodo * 86400000).toISOString().slice(0,10);

  const [{ data: posts }, { data: palavras }, { data: regras }] = await Promise.all([
    sb.from('desempenho_por_publicacao').select('*').gte('publicado_em', desde),
    sb.from('palavras').select('palavra,contagem,dia').gte('dia', desde).limit(5000),
    sb.from('desempenho_por_regra').select('*'),
  ]);

  const todos = posts ?? [];
  const somaP = (k) => todos.reduce((t,p) => t + Number(p[k] ?? 0), 0);
  const somaR = (k) => (regras ?? []).reduce((t,l) => t + Number(l[k] ?? 0), 0);
  const alcanceTotal = somaP('alcance'), interacoes = somaP('interacoes');

  const ag = {};
  (palavras ?? []).forEach((p) => { ag[p.palavra] = (ag[p.palavra] ?? 0) + p.contagem; });
  const nuvem = Object.entries(ag).sort((a,b) => b[1]-a[1]).slice(0,60);

  const filtrados = todos.filter((p) =>
    (soFormato === 'todos' || p.formato === soFormato) &&
    (!soAutomacao || p.tem_automacao) &&
    Number(p.alcance ?? 0) >= 300);
  const ordenados = [...filtrados].sort((a,b) => Number(b[ordem] ?? 0) - Number(a[ordem] ?? 0));

  const porFormato = ['CAROUSEL_ALBUM','IMAGE','VIDEO'].map((f) => {
    const g = todos.filter((p) => p.formato === f);
    return { f, n: g.length, alcance: mediana(g.map((p) => p.alcance)),
      taxa: mediana(g.map((p) => p.taxa_interacao)) };
  }).filter((x) => x.n);

  c.innerHTML = tarja() + `<div class="topo"><div class="cresce"><h1>Desempenho</h1>
      <p>O que o perfil publicou no período e o que funcionou, para orientar o que vem depois.</p></div>
      <button class="btn" id="csv">Baixar planilha</button></div>
    <div class="pastas">
      <span class="sub" style="margin:0;font-weight:600">Período</span>
      <button class="chipsel mini" data-per="30" aria-pressed="${periodo===30}">30 dias</button>
      <button class="chipsel mini" data-per="90" aria-pressed="${periodo===90}">90 dias</button>
      <button class="chipsel mini" data-per="365" aria-pressed="${periodo===365}">Este ano</button>
    </div>
    <div class="numeros">
      <div class="numero"><b class="grande">${num(alcanceTotal)}</b><span>contas alcançadas</span></div>
      <div class="numero"><b>${num(interacoes)}</b><span>interações</span>
        ${alcanceTotal ? `<em>${(100*interacoes/alcanceTotal).toFixed(1)}% de quem foi alcançado</em>` : ''}</div>
      <div class="numero"><b>${num(somaR('dms_enviadas'))}</b><span>conversas iniciadas</span>
        <em style="color:var(--tx2);font-weight:400">${num(somaR('cliques'))} abriram o link</em></div>
      <div class="numero"><b>${num(todos.length)}</b><span>publicações</span></div>
    </div>
    ${todos.length ? '' : '<div class="aviso info">Nenhuma publicação com métricas no período. Em Ajustes, rode <b>Ler métricas</b> até a fila esvaziar.</div>'}

    <h2 style="margin:28px 0 12px">Publicações</h2>
    <div class="barra">
      <h3>Colunas da tabela</h3>
      <div class="pastas">${Object.entries(COLUNAS).map(([k,v]) =>
        `<button class="chipsel mini" data-col="${k}" aria-pressed="${colunas.includes(k)}" title="${esc(v.ajuda)}">${v.nome}</button>`).join('')}
        <button class="btn sm" id="colpadrao" style="margin-left:auto">Voltar ao padrão</button></div>
    </div>
    <div class="pastas">
      <label class="sub" style="margin:0" for="fmt">Formato</label>
      <select id="fmt" style="width:auto;min-height:44px">
        <option value="todos">Todos</option>
        <option value="IMAGE" ${soFormato==='IMAGE'?'selected':''}>Feed</option>
        <option value="VIDEO" ${soFormato==='VIDEO'?'selected':''}>Reels</option>
        <option value="CAROUSEL_ALBUM" ${soFormato==='CAROUSEL_ALBUM'?'selected':''}>Carrossel</option>
      </select>
      <label class="sub" style="margin:0;display:flex;align-items:center;gap:8px;cursor:pointer;min-height:44px">
        <input type="checkbox" id="soauto" ${soAutomacao?'checked':''} style="width:17px;height:17px;accent-color:var(--mag)"> Só com automação</label>
      <span class="sub" style="margin:0;margin-left:auto">${ordenados.length} publicações</span>
    </div>
    ${ordenados.length ? `<div class="lista rolavel"><table>
      <thead><tr><th>Publicação</th>
        ${colunas.map((k) => `<th class="${COLUNAS[k].n?'n ':''}ordenavel" data-ord="${k}"
          ${ordem===k?'aria-sort="descending"':''}><span class="marcaajuda" title="${esc(COLUNAS[k].ajuda)}">${COLUNAS[k].nome}</span>${ordem===k?' ↓':''}</th>`).join('')}
      </tr></thead>
      <tbody>${ordenados.slice(0,80).map((p) => `<tr>
        <td class="titulo"><div style="display:flex;gap:10px;align-items:center">
          ${p.miniatura_url ? `<img class="capinha" src="${esc(p.miniatura_url)}" alt="" loading="lazy">` : ''}
          <a href="${esc(p.permalink||'#')}" target="_blank" rel="noopener" style="color:var(--tx);font-weight:500">${esc((p.legenda||'Sem legenda').slice(0,70))}</a>
          ${p.tem_automacao ? '<span class="chip ok">auto</span>' : ''}</div></td>
        ${colunas.map((k) => `<td class="${COLUNAS[k].n?'n':''}">${esc(celula(p,k))}</td>`).join('')}
      </tr>`).join('')}</tbody></table></div>
      <details class="glossario"><summary>O que significa cada coluna</summary>
        <dl>${colunas.map((k) => `<div><dt>${COLUNAS[k].nome}</dt><dd>${COLUNAS[k].ajuda}</dd></div>`).join('')}</dl>
        <p class="sub">Os números vindos da Meta podem levar até 48 horas para consolidar, então os últimos dias são provisórios.</p></details>
      <p class="sub" style="margin-top:12px">Ordenado por <b>${COLUNAS[ordem].nome}</b>; clique num cabeçalho para trocar. Publicações com alcance abaixo de 300 ficam fora, para uma taxa alta sobre pouca gente não liderar a lista. Mostrando até 80; a planilha traz todas.</p>`
      : '<div class="vazio"><b>Nada neste recorte</b><span>Troque o período, o formato ou rode a sincronização em Ajustes.</span></div>'}

    ${porFormato.length ? `<h2 style="margin:28px 0 6px">Qual formato está rendendo</h2>
    <p class="sub" style="margin:0 0 12px">Mediana, não média, para um post fora da curva não distorcer a leitura.</p>
    <div class="numeros">${porFormato.map((x) => `<div class="numero">
      <span style="font-weight:600;color:var(--tx)">${NOMEF[x.f]}</span> <span>· ${x.n} posts</span>
      <b style="font-size:22px;margin-top:8px">${x.taxa ?? 0}%</b><span>interações por alcance</span>
      <em style="color:var(--tx2);font-weight:400">alcance mediano ${num(x.alcance)}</em></div>`).join('')}</div>` : ''}

    <h2 style="margin:28px 0 12px">O que as pessoas comentam</h2>
    <div class="cartao">${nuvem.length ? '<div class="nuvem" id="nuvem"></div>'
      : '<p class="sub">Nenhuma palavra contabilizada no período. Em Ajustes, rode <b>Somar palavras</b>.</p>'}
      <p class="sub" style="margin-top:14px">Contagem agregada, com o número ao passar o mouse. O sistema não guarda o texto nem o autor dos comentários que não acionam uma automação.</p></div>

    <h2 style="margin:28px 0 12px">Por automação</h2>
    ${(regras ?? []).length ? `<div class="lista rolavel"><table>
      <thead><tr><th>Automação</th><th class="n">Comentários</th><th class="n">Conversas</th>
      <th class="n">Recusadas</th><th class="n">Cliques</th><th class="n">Por conversa</th></tr></thead>
      <tbody>${regras.map((l) => `<tr><td class="titulo">${esc(l.nome)}</td><td class="n">${num(l.comentarios)}</td>
        <td class="n">${num(l.dms_enviadas)}</td><td class="n">${num(l.dms_recusadas)}</td>
        <td class="n">${num(l.cliques)}</td><td class="n">${l.taxa_de_clique}%</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="vazio"><b>Ainda não há envios para medir</b><span>Os números aparecem depois da primeira mensagem.</span></div>'}`;
  ligarTarja();

  c.querySelectorAll('[data-per]').forEach((b) => { b.onclick = () => { periodo = Number(b.dataset.per); abaDesempenho(); }; });
  c.querySelectorAll('[data-ord]').forEach((b) => { b.onclick = () => { ordem = b.dataset.ord; abaDesempenho(); }; });
  c.querySelectorAll('[data-col]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.col;
      const nova = colunas.includes(k) ? colunas.filter((x) => x !== k) : [...colunas, k];
      if (!nova.length) return toast('Deixe pelo menos uma coluna');
      colunas = Object.keys(COLUNAS).filter((x) => nova.includes(x));
      if (!colunas.includes(ordem)) ordem = colunas.find((x) => COLUNAS[x].n) ?? 'alcance';
      try { localStorage.setItem('colunas', JSON.stringify(colunas)); } catch { /* sem memoria */ }
      abaDesempenho();
    };
  });
  document.getElementById('colpadrao').onclick = () => {
    colunas = [...PADRAO]; ordem = 'taxa_interacao';
    try { localStorage.setItem('colunas', JSON.stringify(colunas)); } catch { /* sem memoria */ }
    abaDesempenho();
  };
  document.getElementById('fmt').onchange = (ev) => { soFormato = ev.target.value; abaDesempenho(); };
  document.getElementById('soauto').onchange = (ev) => { soAutomacao = ev.target.checked; abaDesempenho(); };

  const alvoNuvem = document.getElementById('nuvem');
  if (alvoNuvem) desenharNuvem(alvoNuvem, nuvem);

  document.getElementById('csv').onclick = () => {
    const cabecalho = ['Publicacao','Link', ...colunas.map((k) => COLUNAS[k].nome)];
    const linhas = ordenados.map((p) => [
      (p.legenda || '').replace(/[\r\n]+/g,' '), p.permalink ?? '',
      ...colunas.map((k) => COLUNAS[k].n ? (p[k] ?? '') : COLUNAS[k].v(p)),
    ]);
    const tudo = [cabecalho, ...linhas]
      .map((r) => r.map((v) => '"' + String(v ?? '').replace(/"/g,'""') + '"').join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + tudo], { type:'text/csv;charset=utf-8' }));
    a.download = `desempenho-caurs-${periodo}d.csv`; a.click();
    toast(`Planilha com ${linhas.length} publicações`);
  };
}

/* ------------------------------------------------------------- pessoas */

/**
 * O funil individual: comentou, recebeu, clicou.
 *
 * Só aparece quem acionou uma automação. Comentário que não aciona tem autor e
 * texto descartados pelo gatilho do banco, de propósito, e continua assim.
 *
 * Clique por pessoa só existe para mensagens enviadas depois de 03/11/2026,
 * quando o link curto passou a carregar um código por envio. Antes disso o
 * endereço era o mesmo para todo mundo e não havia a quem atribuir, então
 * esses aparecem como "não medido", que é diferente de "não clicou".
 */
let pPeriodo = 90, pFiltro = 'todos', pRegra = 'todas';

const CORTE_ATRIBUICAO = '2026-11-03';

async function abaPessoas(){
  const c = document.getElementById('conteudo');
  c.innerHTML = tarja() + '<p class="sub">Carregando…</p>';
  ligarTarja();

  const desde = new Date(Date.now() - pPeriodo * 86400000).toISOString();
  const [{ data: linhas, error }, { data: regras }] = await Promise.all([
    sb.from('funil_por_pessoa').select('*').gte('comentado_em', desde)
      .order('comentado_em', { ascending: false }).limit(2000),
    sb.from('regras').select('id,nome').order('nome'),
  ]);
  if (error) {
    c.innerHTML = tarja() + `<div class="aviso">Não foi possível carregar: ${esc(error.message)}</div>`;
    return ligarTarja();
  }

  const todas = linhas ?? [];
  const medido = (l) => l.enviado_em && l.enviado_em >= CORTE_ATRIBUICAO;

  const visiveis = todas.filter((l) =>
    (pRegra === 'todas' || l.regra_id === pRegra) &&
    (pFiltro === 'todos'
      || (pFiltro === 'clicaram'   && l.clicou)
      || (pFiltro === 'receberam'  && l.recebeu && !l.clicou && medido(l))
      || (pFiltro === 'nao_receberam' && !l.recebeu)));

  const semCatalogo = todas.filter((l) => l.publicacao === 'Não catalogada').length;
  const comentaram = todas.length;
  const receberam  = todas.filter((l) => l.recebeu).length;
  const clicaram   = todas.filter((l) => l.clicou).length;
  const atribuiveis = todas.filter(medido).length;
  const pessoas = new Set(todas.map((l) => l.username)).size;

  const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '—';

  c.innerHTML = tarja() + `<div class="topo"><div class="cresce"><h1>Pessoas</h1>
      <p>Quem comentou, quem recebeu a mensagem e quem abriu o link.</p></div>
      <button class="btn" id="csv">Baixar planilha</button></div>

    <div class="pastas">
      <span class="sub" style="margin:0;font-weight:600">Período</span>
      <button class="chipsel mini" data-pper="30" aria-pressed="${pPeriodo===30}">30 dias</button>
      <button class="chipsel mini" data-pper="90" aria-pressed="${pPeriodo===90}">90 dias</button>
      <button class="chipsel mini" data-pper="365" aria-pressed="${pPeriodo===365}">Este ano</button>
    </div>

    <div class="numeros">
      <div class="numero"><b class="grande">${num(comentaram)}</b><span>comentários atendidos</span>
        <em style="color:var(--tx2);font-weight:400">${num(pessoas)} pessoas distintas</em></div>
      <div class="numero"><b>${num(receberam)}</b><span>receberam a mensagem</span>
        <em style="color:var(--tx2);font-weight:400">${pct(receberam, comentaram)} de quem comentou</em></div>
      <div class="numero"><b>${num(clicaram)}</b><span>abriram o link</span>
        <em style="color:var(--tx2);font-weight:400">${pct(clicaram, atribuiveis)} de quem foi medido</em></div>
    </div>

    ${atribuiveis < receberam ? `<div class="aviso info">
      ${num(receberam - atribuiveis)} mensagens foram enviadas antes de o sistema passar a
      identificar quem clica. Elas entram na contagem de envio, mas aparecem como
      <b>não medido</b> na coluna do link, que é diferente de não ter clicado.</div>` : ''}

    ${semCatalogo ? `<div class="aviso info">${num(semCatalogo)} linhas aparecem como
      <b>não catalogada</b> na coluna da publicação. Não afeta os números; é só o
      catálogo de posts desatualizado. Em Ajustes, rode <b>Catalogar publicações</b>.</div>` : ''}

    <div class="pastas">
      <button class="chipsel mini" data-pf="todos" aria-pressed="${pFiltro==='todos'}">Todos</button>
      <button class="chipsel mini" data-pf="clicaram" aria-pressed="${pFiltro==='clicaram'}">Abriram o link</button>
      <button class="chipsel mini" data-pf="receberam" aria-pressed="${pFiltro==='receberam'}">Receberam e não abriram</button>
      <button class="chipsel mini" data-pf="nao_receberam" aria-pressed="${pFiltro==='nao_receberam'}">Não receberam</button>
      <label class="sub" style="margin:0 0 0 8px" for="pregra">Automação</label>
      <select id="pregra" style="width:auto;min-height:44px">
        <option value="todas">Todas</option>
        ${(regras ?? []).map((r) => `<option value="${r.id}" ${pRegra===r.id?'selected':''}>${esc(r.nome)}</option>`).join('')}
      </select>
      <span class="sub" style="margin:0;margin-left:auto">${visiveis.length} linhas</span>
    </div>

    ${visiveis.length ? `<div class="lista rolavel"><table>
      <thead><tr>
        <th>Pessoa</th><th>Comentou</th><th>Automação</th><th>Publicação</th>
        <th>Recebeu</th><th>Abriu o link</th><th class="n">Até abrir</th>
      </tr></thead>
      <tbody>${visiveis.slice(0, 300).map(linhaPessoa).join('')}</tbody>
    </table></div>
    <p class="sub" style="margin-top:12px">Mostrando até 300; a planilha traz todas.
      Quem comentou sem acionar nenhuma automação não aparece aqui: desses, o sistema
      não guarda autor nem texto.</p>`
      : '<div class="vazio"><b>Ninguém neste recorte</b><span>Troque o período, o filtro ou a automação.</span></div>'}

    <div class="cartao" style="margin-top:26px">
      <h3>Sobre estes dados</h3>
      <p class="sub">Esta tela mostra dado pessoal: nome de usuário, o que a pessoa
      pediu e quando abriu. Use para atendimento e para medir, não para outra
      finalidade. O sistema apaga automaticamente nome, identificador e texto do
      comentário depois do prazo definido em Ajustes, mantendo só os números.</p>
    </div>`;
  ligarTarja();

  c.querySelectorAll('[data-pper]').forEach((b) => { b.onclick = () => { pPeriodo = Number(b.dataset.pper); abaPessoas(); }; });
  c.querySelectorAll('[data-pf]').forEach((b) => { b.onclick = () => { pFiltro = b.dataset.pf; abaPessoas(); }; });
  document.getElementById('pregra').onchange = (ev) => { pRegra = ev.target.value; abaPessoas(); };

  document.getElementById('csv').onclick = () => {
    const cab = ['Pessoa','Comentou em','Comentario','Automacao','Publicacao','Link do post',
                 'Recebeu','Enviado em','Abriu o link','Abriu em','Aberturas','Segundos ate abrir'];
    const linhasCsv = visiveis.map((l) => [
      '@' + (l.username ?? ''), l.comentado_em ?? '', (l.texto_comentario ?? '').replace(/[\r\n]+/g,' '),
      l.automacao ?? '', l.publicacao ?? '', l.permalink ?? '',
      l.recebeu ? 'sim' : 'nao', l.enviado_em ?? '',
      !medido(l) ? 'nao medido' : (l.clicou ? 'sim' : 'nao'),
      l.primeiro_clique ?? '', l.aberturas ?? 0, l.segundos_ate_clicar ?? '',
    ]);
    const tudo = [cab, ...linhasCsv]
      .map((r) => r.map((v) => '"' + String(v ?? '').replace(/"/g,'""') + '"').join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + tudo], { type:'text/csv;charset=utf-8' }));
    a.download = `pessoas-caurs-${pPeriodo}d.csv`; a.click();
    toast(`Planilha com ${linhasCsv.length} linhas`);
  };
}

function linhaPessoa(l){
  const medido = l.enviado_em && l.enviado_em >= CORTE_ATRIBUICAO;
  const quandoCurto = (iso) => iso
    ? new Date(iso).toLocaleDateString('pt-BR',{day:'2-digit',month:'short'})
      + ' ' + new Date(iso).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})
    : '—';
  const espera = (s) => s == null ? '—'
    : s < 90 ? `${s}s`
    : s < 5400 ? `${Math.round(s/60)} min`
    : s < 172800 ? `${Math.round(s/3600)} h`
    : `${Math.round(s/86400)} d`;

  const recebeu = l.recebeu
    ? '<span class="chip ok">sim</span>'
    : `<span class="chip late" title="${esc(l.status ?? '')}">${esc(l.status ?? 'não')}</span>`;

  const abriu = !l.recebeu ? '<span class="chip">—</span>'
    : !medido ? '<span class="chip" title="Enviada antes de o sistema identificar quem clica">não medido</span>'
    : l.clicou
      ? `<span class="chip ok">${quandoCurto(l.primeiro_clique)}${l.aberturas > 1 ? ` · ${l.aberturas}x` : ''}</span>`
      : '<span class="chip">não</span>';

  return `<tr>
    <td><b>@${esc(l.username ?? '')}</b></td>
    <td>${quandoCurto(l.comentado_em)}</td>
    <td class="titulo" style="min-width:160px">${esc(l.automacao ?? '—')}</td>
    <td class="titulo" style="min-width:200px">${l.permalink
      ? `<a href="${esc(l.permalink)}" target="_blank" rel="noopener" style="color:var(--acc-tx)">${esc(l.publicacao || 'ver post')}</a>`
      : esc(l.publicacao || '—')}</td>
    <td>${recebeu}</td>
    <td>${abriu}</td>
    <td class="n">${espera(l.segundos_ate_clicar)}</td>
  </tr>`;
}

/* ------------------------------------------------------------ usuarios */

async function abaUsuarios(){
  const c = document.getElementById('conteudo');
  c.innerHTML = '<p class="sub">Carregando…</p>';
  let pessoas = [];
  try { pessoas = await api('/api/usuarios'); }
  catch (err) { c.innerHTML = `<div class="aviso">${esc(err.message)}</div>`; return; }

  c.innerHTML = `<div class="topo"><div class="cresce"><h1>Usuários</h1>
      <p>Quem entra no painel e o que cada pessoa pode fazer.</p></div>
      ${souAdmin() ? '<button class="btn pri" id="nova">Adicionar pessoa</button>' : ''}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px;margin-bottom:24px">
      <div class="cartao"><h3>Administrador</h3><p class="sub">Faz tudo o que o editor faz, e mais: excluir automação, mexer em ajustes, ligar e desligar o modo de teste, e gerir pessoas.</p></div>
      <div class="cartao"><h3>Editor</h3><p class="sub">Cria, edita, duplica e pausa automações. Vê o desempenho. Não exclui nem altera configuração do sistema.</p></div>
    </div>
    <div id="formpessoa"></div>
    <div class="lista">${pessoas.map((p) => `<div class="linha" data-pid="${p.id}">
      <span class="inicial" aria-hidden="true">${esc(iniciais(p.nome))}</span>
      <div class="cresce">
        <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
          <h3 data-nome>${esc(p.nome)}</h3>
          ${p.id === sessao.user.id ? '<span class="chip rev">você</span>' : ''}
          ${p.trocar_senha ? '<span class="chip and">senha provisória</span>' : ''}</div>
        <div class="sub">${esc(p.email ?? '')}</div></div>
      <div style="min-width:140px">
        <div style="font-size:13.5px;font-weight:600">${p.papel === 'administrador' ? 'Administrador' : 'Editor'}</div>
        <div class="sub" style="margin:0">${esc(quando(p.ultimo_acesso))}</div></div>
      ${(souAdmin() || p.id === sessao.user.id) ? '<button class="btn sm" data-renomear>Renomear</button>' : ''}
      ${souAdmin() ? '<button class="btn sm" data-acoes>Ações</button>' : ''}
    </div>`).join('')}</div>`;

  const nova = document.getElementById('nova');
  if (nova) nova.onclick = () => formPessoa();

  c.querySelectorAll('[data-renomear]').forEach((b) => {
    const linha = b.closest('[data-pid]');
    const p = pessoas.find((x) => x.id === linha.dataset.pid);
    b.onclick = () => renomear(p, linha);
  });

  c.querySelectorAll('[data-acoes]').forEach((b) => {
    const linha = b.closest('[data-pid]');
    const p = pessoas.find((x) => x.id === linha.dataset.pid);
    b.onclick = (ev) => menuContexto(ev, [
      { texto:'Renomear', acao: () => renomear(p, linha) },
      { texto: p.papel === 'administrador' ? 'Tornar editor' : 'Tornar administrador', acao: () => mudarPapel(p) },
      { texto:'Gerar senha provisória', acao: () => novaSenha(p) },
      '-', { texto:'Excluir conta', perigo:true, acao: () => excluirPessoa(p) },
    ]);
  });
}

// Edicao no lugar: troca o titulo por um campo, sem tirar a pessoa da lista.
function renomear(p, linha){
  const alvo = linha.querySelector('[data-nome]');
  if (alvo.dataset.editando) return;
  alvo.dataset.editando = '1';
  const antes = p.nome;
  alvo.innerHTML = `<input id="renome" value="${esc(antes)}" maxlength="80"
    style="width:min(280px,60vw);padding:7px 10px;font-size:15px;font-weight:600">`;
  const campo = document.getElementById('renome');
  campo.focus(); campo.select();

  const concluir = async (manter) => {
    const nome = campo.value.trim();
    if (!manter || nome === antes) { alvo.textContent = antes; delete alvo.dataset.editando; return; }
    if (nome.length < 2) { toast('O nome precisa de pelo menos 2 letras'); campo.focus(); return; }
    try {
      await api('/api/usuarios', { method:'PATCH', body: JSON.stringify({ id:p.id, acao:'nome', nome }) });
      if (p.id === sessao.user.id) perfil.nome = nome;
      await abaUsuarios();
      toast('Nome atualizado');
    } catch (err) {
      alvo.textContent = antes; delete alvo.dataset.editando;
      toast(err.message);
    }
  };
  campo.onkeydown = (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); concluir(true); }
    if (ev.key === 'Escape') concluir(false);
  };
  campo.onblur = () => concluir(true);
}

function formPessoa(){
  const f = document.getElementById('formpessoa');
  f.innerHTML = `<div class="cartao" style="margin-bottom:20px">
    <h2 style="margin-bottom:16px">Adicionar pessoa</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:16px">
      <div><label class="rotulo" style="margin-top:0" for="pnome">Nome</label><input id="pnome" placeholder="Marina Pires"></div>
      <div><label class="rotulo" style="margin-top:0" for="pmail">E-mail institucional</label><input id="pmail" type="email" placeholder="nome@caurs.gov.br"></div>
      <div><label class="rotulo" style="margin-top:0" for="ppapel">Papel</label><select id="ppapel"><option value="editor">Editor</option><option value="administrador">Administrador</option></select></div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn pri" id="criar">Criar conta</button>
      <button class="btn ghost" id="fechar">Cancelar</button></div>
    <div id="saidapessoa"></div></div>`;
  f.scrollIntoView({ behavior:'smooth', block:'start' });
  document.getElementById('fechar').onclick = () => { f.innerHTML = ''; };
  document.getElementById('criar').onclick = async () => {
    const b = document.getElementById('criar');
    b.disabled = true;
    try {
      const feito = await api('/api/usuarios', { method:'POST', body: JSON.stringify({
        nome: document.getElementById('pnome').value.trim(),
        email: document.getElementById('pmail').value.trim(),
        papel: document.getElementById('ppapel').value }) });
      mostrarSenha(feito.nome, feito.senha);
    } catch (err) {
      document.getElementById('saidapessoa').innerHTML = `<div class="aviso">${esc(err.message)}</div>`;
    }
    b.disabled = false;
  };
}

function mostrarSenha(nome, senha){
  const f = document.getElementById('formpessoa');
  f.innerHTML = `<div class="aviso ok" style="margin:0 0 20px">
    <p style="margin:0 0 14px">Conta de <b>${esc(nome)}</b> pronta. Entregue a senha abaixo pessoalmente ou por um canal interno. A pessoa cria a própria senha ao entrar.</p>
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <code class="chaveprov">${esc(senha)}</code>
      <button class="btn" id="copiar">Copiar</button>
      <button class="btn ghost" id="pronto">Pronto</button></div>
    <p style="margin:14px 0 0;font-size:12.5px">Esta senha aparece uma única vez. Fechando o aviso, não há como vê-la de novo; só gerar outra.</p></div>`;
  document.getElementById('copiar').onclick = async () => {
    try { await navigator.clipboard.writeText(senha); toast('Senha copiada'); }
    catch { toast('Copie manualmente'); }
  };
  document.getElementById('pronto').onclick = () => abaUsuarios();
}

async function mudarPapel(p){
  const papel = p.papel === 'administrador' ? 'editor' : 'administrador';
  try {
    await api('/api/usuarios', { method:'PATCH', body: JSON.stringify({ id:p.id, acao:'papel', papel }) });
    abaUsuarios(); toast(`${p.nome} agora é ${papel}`);
  } catch (err) { toast(err.message); }
}

async function novaSenha(p){
  try {
    const feito = await api('/api/usuarios', { method:'PATCH', body: JSON.stringify({ id:p.id, acao:'senha' }) });
    await abaUsuarios();
    mostrarSenha(p.nome, feito.senha);
  } catch (err) { toast(err.message); }
}

async function excluirPessoa(p){
  if (!confirm(`Excluir a conta de ${p.nome}? Isso não pode ser desfeito.`)) return;
  try {
    await api('/api/usuarios', { method:'DELETE', body: JSON.stringify({ id:p.id }) });
    abaUsuarios(); toast('Conta excluída');
  } catch (err) { toast(err.message); }
}

/* ------------------------------------------------------------ ajustes */

async function abaAjustes(){
  const c = document.getElementById('conteudo');
  const { data: testadores } = await sb.from('testadores').select('*').order('username');
  const escuro = document.documentElement.dataset.theme === 'dark';

  c.innerHTML = `<div class="topo"><div class="cresce"><h1>Ajustes</h1></div></div>
    <div class="cartao" style="margin-bottom:16px"><h2>Modo de teste</h2>
      <p class="sub">${modoTeste ? 'Ligado. Só as contas abaixo recebem mensagem; o resto é registrado e ignorado.'
        : 'Desligado. Qualquer pessoa que comentar uma palavra-chave recebe mensagem.'}</p>
      ${souAdmin() ? `<button class="btn ${modoTeste?'pri':''}" id="modo" style="margin-top:14px">${modoTeste?'Desligar modo de teste':'Ligar modo de teste'}</button>`
        : '<p class="sub">Só administrador pode mudar.</p>'}</div>
    <div class="cartao" style="margin-bottom:16px"><h2>Contas testadoras</h2>
      <p class="sub" style="margin-bottom:14px">Quem recebe mensagem enquanto o modo de teste está ligado.</p>
      ${(testadores ?? []).length ? `<div class="lista">${testadores.map((t) => `<div class="linha">
        <div class="cresce">@${esc(t.username)}</div>
        ${souAdmin() ? `<button class="btn sm" data-remover="${t.id}">Remover</button>` : ''}</div>`).join('')}</div>`
        : '<p class="sub">Nenhuma conta cadastrada.</p>'}
      <div style="display:flex;gap:8px;margin-top:14px"><input id="novo" placeholder="mastercouto">
        <button class="btn pri" id="add" style="white-space:nowrap">Adicionar</button></div></div>
    ${souAdmin() ? `<div class="cartao" style="margin-bottom:16px"><h2>Dados das publicações</h2>
      <p class="sub" style="margin-bottom:14px">Cataloga os posts de 2026, lê alcance e interações, e soma as palavras dos comentários antigos. Roda 20 por vez; clique de novo até a fila esvaziar. Evite rodar enquanto estiver testando o envio.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" data-sinc="posts">1. Catalogar publicações</button>
        <button class="btn" data-sinc="metricas">2. Ler métricas</button>
        <button class="btn" data-sinc="palavras">3. Somar palavras</button>
      </div><div id="sincsaida"></div></div>` : ''}
    <div class="cartao" style="margin-bottom:16px"><h2>Minha senha</h2>
      <div style="display:flex;gap:8px;margin-top:12px"><input id="nsenha" type="password" autocomplete="new-password" placeholder="Nova senha, no mínimo 8 caracteres">
        <button class="btn pri" id="trocar" style="white-space:nowrap">Trocar</button></div></div>
    <div class="cartao"><h2>Aparência</h2>
      <p class="sub">Tema ${escuro?'escuro':'claro'}.</p>
      <button class="btn" id="tema" style="margin-top:14px">Usar tema ${escuro?'claro':'escuro'}</button></div>
    <p class="sub" style="margin-top:22px">Comenta e Recebe, versão @@VERSAO@@</p>`;

  const bmodo = document.getElementById('modo');
  if (bmodo) bmodo.onclick = async () => {
    const { error } = await sb.from('configuracoes').update({ valor: !modoTeste }).eq('chave','modo_teste');
    if (error) return toast('Só administrador pode mudar o modo de teste');
    modoTeste = !modoTeste; desenhar();
    toast(modoTeste ? 'Modo de teste ligado' : 'Modo de teste desligado');
  };
  document.getElementById('tema').onclick = () => {
    const novo = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = novo;
    localStorage.setItem('tema', novo); desenhar();
  };
  document.getElementById('trocar').onclick = async () => {
    const nova = document.getElementById('nsenha').value;
    if (nova.length < 8) return toast('A senha precisa de pelo menos 8 caracteres');
    const { error } = await sb.auth.updateUser({ password: nova });
    toast(error ? 'Não foi possível trocar: ' + error.message : 'Senha trocada');
    if (!error) document.getElementById('nsenha').value = '';
  };
  document.getElementById('add').onclick = async () => {
    const u = document.getElementById('novo').value.trim().replace(/^@/,'');
    if (!u) return;
    await sb.from('testadores').insert({ username: u.toLowerCase() });
    abaAjustes(); toast('Conta adicionada');
  };
  c.querySelectorAll('[data-remover]').forEach((b) => {
    let armado = false;
    b.onclick = async () => {
      if (!armado) { armado = true; b.classList.add('armado'); b.textContent = 'Confirmar';
        setTimeout(() => { armado = false; b.classList.remove('armado'); b.textContent = 'Remover'; }, 4000); return; }
      const { error } = await sb.from('testadores').delete().eq('id', b.dataset.remover);
      if (error) return toast('Só administrador pode remover');
      abaAjustes(); toast('Conta removida');
    };
  });
  c.querySelectorAll('[data-sinc]').forEach((b) => {
    b.onclick = async () => {
      const saida = document.getElementById('sincsaida');
      const antes = b.textContent;
      b.disabled = true; b.textContent = 'Rodando…';
      try {
        const corpo = await api('/api/sincronizar?o=' + b.dataset.sinc + '&lote=20');
        saida.innerHTML = `<div class="aviso info">${esc(JSON.stringify(corpo))}</div>`;
      } catch (err) {
        saida.innerHTML = `<div class="aviso">${esc(err.message)}</div>`;
      }
      b.disabled = false; b.textContent = antes;
    };
  });
}

iniciar();
