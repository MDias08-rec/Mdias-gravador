/* MDias Gravador — app web (doutores e gestor de tráfego) */
"use strict";

const SUPABASE_URL = "https://qaubnjuqpsxjnwpqjjnc.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhdWJuanVxcHN4am53cHFqam5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxMDc0MzcsImV4cCI6MjEwOTY4MzQzN30.lWfF4SyPyL1evH-o79d6yKUqfcczcqIpHhExfxTLjU8";
const DOMINIO = "gravador.mdias.app";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

const $ = (s) => document.querySelector(s);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const slug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "");
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const tpl = (t, cidade) => String(t || "").replaceAll("{cidade}", cidade || "");
const FRAME_LABEL = { close: "Close · rosto e ombros", medio: "Plano médio · cintura pra cima" };
function el(html) { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstElementChild; }

let toastT;
function toast(msg, isErr) {
  const t = $("#toast"); t.textContent = msg; t.classList.toggle("err", !!isErr); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), isErr ? 5000 : 2500);
}

function show(id) {
  $("#carregando").hidden = true;
  document.querySelectorAll(".screen").forEach((s) => (s.hidden = s.id !== id));
  window.scrollTo(0, 0);
  if (id !== "gravar") pararCamera();
}

async function chamarFuncao(nome, body) {
  const { data, error } = await sb.functions.invoke(nome, { body });
  if (error) {
    let msg = "Algo deu errado. Tente de novo.";
    try { const j = await error.context.json(); if (j?.erro) msg = j.erro; } catch (e) {}
    throw new Error(msg);
  }
  if (data?.erro) throw new Error(data.erro);
  return data;
}

/* =====================================================================
   SESSÃO
   ===================================================================== */
let perfil = null;     // linha de perfis do usuário logado
let user = null;       // doutor: { id, nome, usuario, unidade, unidade_id }
let rot = null;        // roteiro aberto (linha de roteiros)

async function iniciar() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return show("login");
  await carregarPerfil();
}

async function carregarPerfil() {
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return show("login");
  const { data: p, error } = await sb.from("perfis").select("*").eq("id", u.user.id).maybeSingle();
  if (error || !p) {
    await sb.auth.signOut();
    $("#loginErr").textContent = "Esse acesso não está cadastrado. Fale com a equipe MDias.";
    return show("login");
  }
  perfil = p;
  if (p.papel === "gestor") return abrirGestao();
  return entrarDoutor();
}

$("#formLogin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const usuario = $("#usuario").value.trim().toLowerCase();
  const senha = $("#senha").value;
  const err = $("#loginErr"); err.textContent = "";
  if (!usuario || !senha) { err.textContent = "Preencha usuário e senha."; return; }
  const btn = $("#btnEntrar"); btn.disabled = true; btn.textContent = "Entrando…";
  const { error } = await sb.auth.signInWithPassword({ email: `${usuario}@${DOMINIO}`, password: senha });
  btn.disabled = false; btn.textContent = "Entrar";
  if (error) {
    err.textContent = /invalid/i.test(error.message)
      ? "Usuário ou senha incorretos. Confira o acesso que a equipe enviou."
      : "Não consegui entrar. Confira a internet e tente de novo.";
    return;
  }
  $("#senha").value = "";
  await carregarPerfil();
});

async function sair() {
  await sb.auth.signOut();
  perfil = null; user = null;
  show("login");
}

document.querySelectorAll('[data-acao="sair"]').forEach((b) => (b.onclick = sair));
document.querySelectorAll('[data-acao="senha"]').forEach((b) => (b.onclick = () => {
  $("#novaSenha").value = ""; $("#senhaErr").textContent = ""; $("#sheetSenha").hidden = false; $("#novaSenha").focus();
}));
$("#senhaCancelar").onclick = () => ($("#sheetSenha").hidden = true);
$("#formSenha").addEventListener("submit", async (e) => {
  e.preventDefault();
  const s = $("#novaSenha").value;
  if (s.length < 6) { $("#senhaErr").textContent = "A senha precisa ter pelo menos 6 caracteres."; return; }
  try {
    await chamarFuncao("admin-usuarios", { acao: "minha_senha", senha: s });
    $("#sheetSenha").hidden = true; toast("Senha alterada");
  } catch (er) { $("#senhaErr").textContent = er.message; }
});

/* =====================================================================
   DOUTOR
   ===================================================================== */
let progresso = new Set();

async function entrarDoutor() {
  let unidade = null;
  if (perfil.unidade_id) {
    const { data } = await sb.from("unidades").select("*").eq("id", perfil.unidade_id).maybeSingle();
    unidade = data;
  }
  user = { id: perfil.id, nome: perfil.nome, usuario: perfil.usuario, unidade: unidade?.nome || "", unidade_id: unidade?.id || null };
  rot = null;
  if (unidade?.roteiro_id) {
    const { data } = await sb.from("roteiros").select("*").eq("id", unidade.roteiro_id).maybeSingle();
    rot = data;
  }
  await carregarProgresso();
  renderHome();
  if (rot && progresso.size < rot.blocos.length) abrirRoteiro();
  else show("home");
}

async function carregarProgresso() {
  progresso = new Set();
  if (!rot) return;
  const { data } = await sb.from("gravacoes").select("bloco_idx").eq("doutor_id", user.id).eq("roteiro_id", rot.id);
  (data || []).forEach((g) => progresso.add(g.bloco_idx));
}

function renderHome() {
  $("#olaNome").textContent = `Olá, ${user.nome}`;
  $("#olaUnidade").textContent = user.unidade ? `Unidade ${user.unidade}` : "Você ainda não está em nenhuma unidade";
  const box = $("#listaRoteiros"); box.innerHTML = "";
  if (!rot) {
    box.append(el(`<div class="card"><h3>Nenhum roteiro liberado ainda</h3><p>A equipe MDias vai liberar o roteiro da sua unidade. Volte mais tarde.</p></div>`));
    return;
  }
  const completo = progresso.size >= rot.blocos.length;
  const card = el(`<button class="card"><h3>${esc(rot.titulo)}</h3><p>${esc(rot.objetivo)}</p><div class="steps"></div><div class="card-foot"><span>${completo ? "Gravado · gravar de novo" : "Abrir roteiro"}</span><span>→</span></div></button>`);
  rot.blocos.forEach((b, i) => {
    const s = el(`<span class="step${progresso.has(i) ? " done" : ""}"><i></i>${esc(b.tipo)}</span>`);
    card.querySelector(".steps").append(s);
  });
  card.onclick = abrirRoteiro;
  box.append(card);
}

function miniFrame(tipo) {
  return tipo === "close"
    ? `<svg viewBox="0 0 14 20" fill="none" stroke="currentColor" stroke-width="1.2"><rect x=".6" y=".6" width="12.8" height="18.8" rx="2"/><circle cx="7" cy="8" r="3.6"/><path d="M1 19c1-4 3-5.5 6-5.5s5 1.5 6 5.5"/></svg>`
    : `<svg viewBox="0 0 14 20" fill="none" stroke="currentColor" stroke-width="1.2"><rect x=".6" y=".6" width="12.8" height="18.8" rx="2"/><circle cx="7" cy="6.5" r="2.3"/><path d="M2.5 19.4V13c0-2 2-3.5 4.5-3.5s4.5 1.5 4.5 3.5v6.4"/></svg>`;
}

function abrirRoteiro() {
  $("#rTitulo").textContent = rot.titulo;
  $("#rObjetivo").textContent = rot.objetivo;
  const box = $("#rBlocos"); box.innerHTML = "";
  rot.blocos.forEach((b, i) => {
    const bl = el(`<div class="block"><div class="block-top"><span class="tag">${i + 1} · ${esc(b.tipo)}</span><span class="frame-chip">${miniFrame(b.enquadramento)}<span>${FRAME_LABEL[b.enquadramento] || ""}</span></span></div><p class="text"></p>${b.dica ? '<p class="tip"></p>' : ""}</div>`);
    bl.querySelector(".text").textContent = tpl(b.texto, user.unidade);
    if (b.dica) bl.querySelector(".tip").textContent = "Dica: " + b.dica;
    box.append(bl);
  });
  show("roteiro");
}
$("#rVoltar").onclick = () => { renderHome(); show("home"); };
$("#finalVoltar").onclick = async () => { await carregarProgresso(); renderHome(); show("home"); };
$("#vamosGravar").onclick = () => { bi = 0; takes = []; abrirGravacao(); };

/* =====================================================================
   GRAVAÇÃO
   ===================================================================== */
let bi = 0, takes = [];
let modo = store.get("modo") || "frase";
let wpm = store.get("wpm") || 140;
let stream = null, recorder = null, chunks = [], gravando = false, t0 = 0, tick = null, wake = null;
const MIME = ["video/mp4;codecs=avc1,mp4a", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
  .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";

async function abrirGravacao() {
  show("gravar");
  $("#review").hidden = true;
  renderBloco();
  if (!navigator.mediaDevices?.getUserMedia) { camErro("Este navegador não libera a câmera. Abra o link no Safari (iPhone) ou no Chrome (Android)."); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1080 }, height: { ideal: 1920 }, frameRate: { ideal: 30 } },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    $("#cam").srcObject = stream;
    $("#camMsg").hidden = true;
    try { wake = await navigator.wakeLock?.request("screen"); } catch (e) {}
  } catch (e) {
    camErro(e.name === "NotAllowedError"
      ? "Você não liberou a câmera. Toque no “aA” ou no cadeado da barra de endereço, permita câmera e microfone e recarregue a página."
      : "Não consegui abrir a câmera. Feche outros apps que estejam usando a câmera e tente de novo.");
  }
}
function camErro(msg) { const m = $("#camMsg"); m.hidden = false; m.textContent = msg; }
function pararCamera() {
  if (gravando) pararGravacao(true);
  stream?.getTracks().forEach((t) => t.stop()); stream = null;
  try { wake?.release(); } catch (e) {} wake = null;
}

function desenharGuia(tipo) {
  const thirds = `<line x1="30" y1="0" x2="30" y2="160" stroke="#fff" stroke-width=".2" opacity=".25"/><line x1="60" y1="0" x2="60" y2="160" stroke="#fff" stroke-width=".2" opacity=".25"/>`;
  $("#guia").innerHTML = tipo === "medio" ? thirds + `
    <line class="ln" x1="6" y1="26" x2="84" y2="26"/><text x="8" y="24">TOPO DA CABEÇA</text>
    <line class="ln" x1="6" y1="43" x2="84" y2="43"/><text x="8" y="41.2">OLHOS AQUI</text>
    <ellipse class="shape" cx="45" cy="45" rx="13" ry="17.5"/>
    <path class="shape" d="M38.5 61 L39 68 Q20 70 15 84 L11 160 M51.5 61 L51 68 Q70 70 75 84 L79 160"/>
    <text x="8" y="154">CINTURA NA BORDA DE BAIXO</text>`
  : thirds + `
    <line class="ln" x1="6" y1="20" x2="84" y2="20"/><text x="8" y="18">TOPO DA CABEÇA</text>
    <line class="ln" x1="6" y1="47" x2="84" y2="47"/><text x="8" y="45.2">OLHOS AQUI</text>
    <ellipse class="shape" cx="45" cy="50" rx="19" ry="26"/>
    <path class="shape" d="M35 74 L35.5 86 Q10 92 -2 122 M55 74 L54.5 86 Q80 92 92 122"/>`;
}

let frases = [], fi = 0, rolarRAF = null;
const quebrarFrases = (t) => (t.match(/[^.!?…]+[.!?…]*/g) || [t]).map((s) => s.trim()).filter(Boolean);

function renderBloco() {
  const b = rot.blocos[bi];
  $("#pBloco").textContent = `${bi + 1}/${rot.blocos.length} · ${b.tipo} · ${b.enquadramento === "medio" ? "Plano médio" : "Close"}`;
  frases = quebrarFrases(tpl(b.texto, user.unidade)); fi = 0;
  desenharGuia(b.enquadramento);
  renderPrompt();
}
function renderPrompt() {
  cancelAnimationFrame(rolarRAF);
  $("#mFrase").classList.toggle("on", modo === "frase");
  $("#mRolar").classList.toggle("on", modo === "rolar");
  $("#vMenos").hidden = $("#vMais").hidden = modo !== "rolar";
  const body = $("#pBody"); body.innerHTML = "";
  if (modo === "frase") {
    const p = el(`<p class="frase"></p>`); p.textContent = frases[fi] || "";
    const n = el(`<p class="frase-next"></p>`);
    n.textContent = frases[fi + 1] ? "Depois: " + frases[fi + 1] : (frases.length > 1 ? "Última frase" : "");
    const tap = el(`<button class="p-tap" aria-label="Próxima frase"></button>`);
    tap.onclick = () => { if (fi < frases.length - 1) { fi++; renderPrompt(); } };
    body.append(p, n, tap);
    $("#pDica").textContent = gravando ? "Toque no texto para a próxima frase" : "Olhe para a lente, logo acima deste texto";
  } else {
    const sc = el(`<div class="scroller" id="scroller"><p></p></div>`);
    sc.querySelector("p").textContent = frases.join(" ");
    body.append(sc);
    $("#pDica").textContent = `Rolagem: ${wpm} palavras/min`;
  }
}
function iniciarRolagem() {
  const sc = $("#scroller"); if (!sc) return;
  let last = performance.now(), pos = 0;
  const palavras = frases.join(" ").split(/\s+/).length;
  const step = (now) => {
    const dur = (palavras / wpm) * 60;
    const max = sc.scrollHeight - sc.clientHeight * 1.2;
    pos += ((now - last) / 1000) * (max / dur); last = now;
    sc.scrollTop = pos;
    if (gravando && pos < sc.scrollHeight) rolarRAF = requestAnimationFrame(step);
  };
  rolarRAF = requestAnimationFrame(step);
}
$("#mFrase").onclick = () => { modo = "frase"; store.set("modo", modo); renderPrompt(); };
$("#mRolar").onclick = () => { modo = "rolar"; store.set("modo", modo); renderPrompt(); if (gravando) iniciarRolagem(); };
$("#vMenos").onclick = () => { wpm = Math.max(80, wpm - 10); store.set("wpm", wpm); $("#pDica").textContent = `Rolagem: ${wpm} palavras/min`; };
$("#vMais").onclick = () => { wpm = Math.min(220, wpm + 10); store.set("wpm", wpm); $("#pDica").textContent = `Rolagem: ${wpm} palavras/min`; };

$("#rec").onclick = () => (gravando ? pararGravacao() : contagem());
$("#sairGravar").onclick = () => { pararCamera(); show("roteiro"); };

function contagem() {
  if (!stream) return;
  $("#rec").disabled = true;
  let n = 3; const c = $("#count"); c.hidden = false; c.textContent = n;
  const iv = setInterval(() => {
    n--;
    if (n > 0) { c.textContent = n; return; }
    clearInterval(iv); c.hidden = true; $("#rec").disabled = false; iniciarGravacao();
  }, 1000);
}
function iniciarGravacao() {
  chunks = [];
  try { recorder = new MediaRecorder(stream, MIME ? { mimeType: MIME, videoBitsPerSecond: 8_000_000 } : {}); }
  catch (e) { recorder = new MediaRecorder(stream); }
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.onstop = finalizarTake;
  recorder.start(500);
  gravando = true; t0 = Date.now();
  $("#rec").classList.add("on"); $("#rec").setAttribute("aria-label", "Parar");
  $("#guia").classList.add("rec");
  $("#timer").hidden = false; $("#tempo").textContent = "0:00";
  tick = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); $("#tempo").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }, 250);
  renderPrompt();
  if (modo === "rolar") iniciarRolagem();
}
let descartar = false;
function pararGravacao(descarte = false) {
  descartar = descarte;
  gravando = false; clearInterval(tick); cancelAnimationFrame(rolarRAF);
  $("#rec").classList.remove("on"); $("#rec").setAttribute("aria-label", "Gravar");
  $("#guia").classList.remove("rec"); $("#timer").hidden = true;
  if (recorder && recorder.state !== "inactive") recorder.stop();
}
let takeAtual = null;
function finalizarTake() {
  if (descartar) { descartar = false; return; }
  const type = recorder.mimeType || MIME || "video/webm";
  const blob = new Blob(chunks, { type });
  const ext = type.includes("mp4") ? "mp4" : "webm";
  const b = rot.blocos[bi];
  const nome = `${slug(user.unidade)}_${slug(user.nome)}_${String(bi + 1).padStart(2, "0")}_${slug(b.tipo)}.${ext}`;
  takeAtual = { blob, url: URL.createObjectURL(blob), nome, tipo: b.tipo, idx: bi };
  $("#revBloco").textContent = `${bi + 1}/${rot.blocos.length} · ${b.tipo}`;
  const v = $("#revVideo"); v.src = takeAtual.url; v.play().catch(() => {});
  $("#review").hidden = false;
}
$("#regravar").onclick = () => {
  URL.revokeObjectURL(takeAtual.url); takeAtual = null;
  $("#revVideo").pause(); $("#review").hidden = true; fi = 0; renderPrompt();
};
$("#usarTake").onclick = async () => {
  $("#revVideo").pause();
  const t = takeAtual; takes[bi] = t; takeAtual = null;
  // registra no servidor (não bloqueia a gravação se falhar)
  sb.from("gravacoes").insert({
    doutor_id: user.id, unidade_id: user.unidade_id, roteiro_id: rot.id,
    bloco_idx: t.idx, bloco_tipo: t.tipo, arquivo_nome: t.nome,
  }).then(({ error }) => { if (error) console.warn(error); });
  if (bi < rot.blocos.length - 1) { bi++; $("#review").hidden = true; renderBloco(); }
  else { pararCamera(); renderFinal(); show("final"); }
};

function renderFinal() {
  const box = $("#takes"); box.innerHTML = "";
  takes.forEach((t) => {
    const it = el(`<div class="take"><video muted playsinline preload="metadata"></video><div style="min-width:0"><h3></h3><p></p></div><button class="btn btn-ghost btn-sm">Salvar</button></div>`);
    it.querySelector("video").src = t.url + "#t=0.1";
    it.querySelector("h3").textContent = t.tipo;
    it.querySelector("p").textContent = t.nome;
    it.querySelector("button").onclick = () => salvarArquivos([t]);
    box.append(it);
  });
}
$("#enviarTodos").onclick = () => salvarArquivos(takes);
async function salvarArquivos(lista) {
  const files = lista.map((t) => new File([t.blob], t.nome, { type: t.blob.type }));
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files, title: `${rot.titulo} · ${user.unidade}` }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  files.forEach((f) => {
    const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name;
    document.body.append(a); a.click(); a.remove();
  });
}

/* =====================================================================
   GESTÃO
   ===================================================================== */
let G = { unidades: [], doutores: [], roteiros: [], gravacoes: [] };
let aba = "unidades";
let ultimosGerados = [];
let credNova = null;
const TRATAMENTOS = ["Implante dentário", "Clareamento dental", "Lentes de contato dental", "Aparelho ortodôntico", "Alinhadores invisíveis", "Prótese dentária", "Limpeza e prevenção", "Tratamento de canal"];

async function carregarGestao() {
  const [u, d, r, g] = await Promise.all([
    sb.from("unidades").select("*").order("nome"),
    sb.from("perfis").select("*").eq("papel", "doutor").order("nome"),
    sb.from("roteiros").select("*").order("criado_em", { ascending: false }),
    sb.from("gravacoes").select("doutor_id, roteiro_id, bloco_idx"),
  ]);
  const err = u.error || d.error || r.error || g.error;
  if (err) toast("Não consegui carregar os dados. Confira a internet.", true);
  G = { unidades: u.data || [], doutores: d.data || [], roteiros: r.data || [], gravacoes: g.data || [] };
}
async function abrirGestao() {
  show("gestao");
  $("#gBody").innerHTML = `<p class="g-help">Carregando…</p>`;
  await carregarGestao();
  renderGestao();
}
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => { aba = t.dataset.aba; credNova = null; renderGestao(); }));

const opts = (list, sel, vazio) => (vazio ? `<option value="">${esc(vazio)}</option>` : "") +
  list.map(([v, t]) => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(t)}</option>`).join("");
const listaRoteiros = () => G.roteiros.map((r) => [r.id, r.titulo]);
const listaUnidades = () => G.unidades.map((u) => [u.id, u.nome]);

const timers = {};
function salvarDepois(chave, fn, ms = 700) { clearTimeout(timers[chave]); timers[chave] = setTimeout(fn, ms); }

function statusDoutor(d) {
  const un = G.unidades.find((u) => u.id === d.unidade_id);
  const r = un && G.roteiros.find((x) => x.id === un.roteiro_id);
  if (!r) return { txt: "Sem roteiro", cls: "" };
  const feitos = new Set(G.gravacoes.filter((g) => g.doutor_id === d.id && g.roteiro_id === r.id).map((g) => g.bloco_idx)).size;
  const total = r.blocos.length;
  if (feitos >= total) return { txt: `Gravou tudo · ${r.titulo}`, cls: "done" };
  if (feitos > 0) return { txt: `${feitos}/${total} blocos · ${r.titulo}`, cls: "part" };
  return { txt: `Não gravou ainda · ${r.titulo}`, cls: "" };
}

function renderGestao() {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.aba === aba));
  const box = $("#gBody"); box.innerHTML = "";
  if (aba === "unidades") renderUnidades(box);
  if (aba === "doutores") renderDoutores(box);
  if (aba === "roteiros") renderRoteiros(box);
}

/* ---- Unidades ---- */
function renderUnidades(box) {
  box.append(el(`<p class="g-help">Escolha qual roteiro cada unidade vai gravar. Todos os doutores da unidade recebem esse roteiro.</p>`));
  G.unidades.forEach((u) => {
    const n = G.doutores.filter((d) => d.unidade_id === u.id).length;
    const row = el(`<div class="g-card">
      <div class="field"><label>Unidade</label><input class="inp" data-k="nome"></div>
      <div class="field"><label>Roteiro</label><select class="inp" data-k="roteiro_id">${opts(listaRoteiros(), u.roteiro_id, "Sem roteiro")}</select></div>
      <div class="g-foot"><span>${n} doutor${n === 1 ? "" : "es"}</span><button class="link-del">Excluir</button></div></div>`);
    row.querySelector('[data-k="nome"]').value = u.nome;
    row.querySelectorAll(".inp").forEach((i) => (i.oninput = () => {
      const k = i.dataset.k; u[k] = i.value || null;
      salvarDepois("u" + u.id + k, async () => {
        const { error } = await sb.from("unidades").update({ [k]: i.value || null }).eq("id", u.id);
        toast(error ? "Não consegui salvar a unidade." : "Salvo", !!error);
      }, k === "nome" ? 800 : 0);
    }));
    row.querySelector(".link-del").onclick = async () => {
      if (!confirm(n ? `${u.nome} tem ${n} doutor(es). Excluir mesmo assim? Eles ficarão sem unidade.` : `Excluir a unidade ${u.nome}?`)) return;
      const { error } = await sb.from("unidades").delete().eq("id", u.id);
      if (error) return toast("Não consegui excluir.", true);
      await carregarGestao(); renderGestao();
    };
    box.append(row);
  });
  const add = el(`<button class="btn btn-ghost">+ Adicionar unidade</button>`);
  add.onclick = async () => {
    const { error } = await sb.from("unidades").insert({ nome: "Nova unidade" });
    if (error) return toast("Não consegui criar a unidade.", true);
    await carregarGestao(); renderGestao();
    const ins = $("#gBody").querySelectorAll('[data-k="nome"]'); const last = [...ins].find((i) => i.value === "Nova unidade");
    last?.focus(); last?.select();
  };
  box.append(add);
}

/* ---- Doutores ---- */
function senhaAleatoria() { return String(Math.floor(100000 + Math.random() * 900000)); }

function renderDoutores(box) {
  box.append(el(`<p class="g-help">Cadastre o acesso de cada doutor e a unidade dele. Ele vai gravar o roteiro dessa unidade.</p>`));

  const novo = el(`<form class="gen">
    <div class="eyebrow" style="color:var(--accent)">Novo doutor</div>
    <div class="field"><label for="nNome">Nome</label><input class="inp" id="nNome" placeholder="Ex: Dra. Maria Souza"></div>
    <div class="g-2">
      <div class="field"><label for="nUsuario">Usuário</label><input class="inp" id="nUsuario" autocapitalize="none" autocorrect="off" placeholder="ex: maria.souza"></div>
      <div class="field"><label for="nSenha">Senha</label><input class="inp" id="nSenha"></div>
    </div>
    <div class="field"><label for="nUnidade">Unidade</label><select class="inp" id="nUnidade">${opts(listaUnidades(), "", "Escolha a unidade")}</select></div>
    <div class="err" id="nErr" role="alert"></div>
    <button class="btn btn-primary" type="submit">Criar acesso</button>
  </form>`);
  novo.querySelector("#nSenha").value = senhaAleatoria();
  novo.querySelector("#nNome").oninput = (e) => {
    const sug = norm(e.target.value).replace(/^(dra?|dr)\.?\s+/, "").split(/\s+/).filter(Boolean);
    const u = novo.querySelector("#nUsuario");
    if (!u.dataset.mexeu) u.value = sug.length ? (sug.length > 1 ? sug[0] + "." + sug[sug.length - 1] : sug[0]).replace(/[^a-z0-9._-]/g, "") : "";
  };
  novo.querySelector("#nUsuario").oninput = (e) => (e.target.dataset.mexeu = "1");
  novo.onsubmit = async (e) => {
    e.preventDefault();
    const btn = novo.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Criando…";
    const dados = {
      acao: "criar",
      nome: novo.querySelector("#nNome").value,
      usuario: novo.querySelector("#nUsuario").value,
      senha: novo.querySelector("#nSenha").value,
      unidade_id: novo.querySelector("#nUnidade").value || null,
    };
    try {
      await chamarFuncao("admin-usuarios", dados);
      const un = G.unidades.find((u) => u.id === dados.unidade_id);
      credNova = { nome: dados.nome, usuario: dados.usuario.trim().toLowerCase(), senha: dados.senha, unidade: un?.nome || "" };
      await carregarGestao(); renderGestao();
    } catch (er) {
      novo.querySelector("#nErr").textContent = er.message;
      btn.disabled = false; btn.textContent = "Criar acesso";
    }
  };
  box.append(novo);

  if (credNova) {
    const link = location.origin;
    const msg = `Olá, ${credNova.nome}! Este é o seu acesso para gravar os vídeos da sua unidade:\n\nLink: ${link}\nUsuário: ${credNova.usuario}\nSenha: ${credNova.senha}\n\nAbra o link no celular, entre e siga o roteiro.`;
    const c = el(`<div class="cred"><strong>Acesso criado. Envie para o doutor:</strong><div>Usuário: <code></code></div><div>Senha: <code></code></div><div class="row"><button class="btn btn-primary btn-sm" type="button">Copiar mensagem</button></div></div>`);
    c.querySelectorAll("code")[0].textContent = credNova.usuario;
    c.querySelectorAll("code")[1].textContent = credNova.senha;
    c.querySelector("button").onclick = async () => {
      try { await navigator.clipboard.writeText(msg); toast("Mensagem copiada"); }
      catch (e) { toast("Não consegui copiar. Selecione e copie o usuário e a senha.", true); }
    };
    box.append(c);
  }

  if (!G.doutores.length) box.append(el(`<p class="g-help">Nenhum doutor cadastrado ainda.</p>`));
  G.doutores.forEach((d) => {
    const st = statusDoutor(d);
    const row = el(`<form class="g-card">
      <div class="field"><label>Nome</label><input class="inp" data-k="nome"></div>
      <div class="g-2">
        <div class="field"><label>Usuário</label><input class="inp" data-k="usuario" autocapitalize="none" autocorrect="off"></div>
        <div class="field"><label>Nova senha</label><input class="inp" data-k="senha" placeholder="Deixe vazio"></div>
      </div>
      <div class="field"><label>Unidade</label><select class="inp" data-k="unidade_id">${opts(listaUnidades(), d.unidade_id, "Sem unidade")}</select></div>
      <div class="g-foot"><span class="status ${st.cls}"></span></div>
      <div class="err" role="alert" style="min-height:0;margin:0"></div>
      <div class="g-foot"><button class="link-del" type="button">Excluir</button><button class="btn btn-ghost btn-sm" type="submit" disabled>Salvar</button></div>
    </form>`);
    row.querySelector(".status").textContent = st.txt;
    row.querySelector('[data-k="nome"]').value = d.nome;
    row.querySelector('[data-k="usuario"]').value = d.usuario;
    const salvar = row.querySelector("button[type=submit]");
    row.querySelectorAll(".inp").forEach((i) => (i.oninput = () => { salvar.disabled = false; salvar.classList.add("btn-primary"); }));
    row.onsubmit = async (e) => {
      e.preventDefault();
      salvar.disabled = true; salvar.textContent = "Salvando…";
      const body = { acao: "atualizar", id: d.id };
      row.querySelectorAll(".inp").forEach((i) => (body[i.dataset.k] = i.value));
      if (!body.senha) delete body.senha;
      try {
        await chamarFuncao("admin-usuarios", body);
        toast(body.senha ? `Salvo. Nova senha: ${body.senha}` : "Salvo");
        await carregarGestao(); renderGestao();
      } catch (er) {
        row.querySelector(".err").textContent = er.message;
        salvar.disabled = false; salvar.textContent = "Salvar";
      }
    };
    row.querySelector(".link-del").onclick = async () => {
      if (!confirm(`Excluir o acesso de ${d.nome}? Ele não vai mais conseguir entrar.`)) return;
      try { await chamarFuncao("admin-usuarios", { acao: "excluir", id: d.id }); toast("Acesso excluído"); await carregarGestao(); renderGestao(); }
      catch (er) { toast(er.message, true); }
    };
    box.append(row);
  });
}

/* ---- Roteiros ---- */
let gerando = false;
function renderRoteiros(box) {
  const p = el(`<form class="gen">
    <div class="eyebrow" style="color:var(--accent)">Gerar com IA</div>
    <h3>Gerar roteiros para uma unidade</h3>
    <p class="g-help">Cria 3 roteiros de uma vez: dor → solução, quebra de objeção e chamada local.</p>
    <div class="field"><label for="gTrat">Tratamento</label><input class="inp" id="gTrat" list="gTratList" placeholder="Ex: Implante dentário"><datalist id="gTratList">${TRATAMENTOS.map((t) => `<option value="${esc(t)}">`).join("")}</datalist></div>
    <div class="field"><label for="gCid">Cidade ou unidade</label><input class="inp" id="gCid" list="gCidList" placeholder="Ex: Jacareí"><datalist id="gCidList">${G.unidades.map((u) => `<option value="${esc(u.nome)}">`).join("")}</datalist></div>
    <div class="field"><label for="gObs">Observações (opcional)</label><input class="inp" id="gObs" placeholder="Ex: avaliação gratuita em novembro"></div>
    <div class="err" id="gErr" role="alert"></div>
    <button class="btn btn-primary" id="gBtn" type="submit">${gerando ? "Gerando roteiros… (leva uns 20 segundos)" : "Gerar 3 roteiros"}</button>
  </form>`);
  p.querySelector("#gBtn").disabled = gerando;
  p.onsubmit = async (e) => {
    e.preventDefault();
    const trat = p.querySelector("#gTrat").value.trim(), cid = p.querySelector("#gCid").value.trim(), obs = p.querySelector("#gObs").value.trim();
    if (!trat || !cid) { p.querySelector("#gErr").textContent = "Preencha o tratamento e a cidade."; return; }
    gerando = true; renderGestao();
    try {
      const r = await chamarFuncao("gerar-roteiros", { tratamento: trat, cidade: cid, observacoes: obs });
      ultimosGerados = r.ids || [];
      gerando = false; await carregarGestao(); renderGestao(); toast("3 roteiros criados");
    } catch (er) {
      gerando = false; renderGestao();
      $("#gErr").textContent = er.message;
      $("#gTrat").value = trat; $("#gCid").value = cid; $("#gObs").value = obs;
    }
  };
  box.append(p);
  box.append(el(`<p class="g-help">Use {cidade} no texto para entrar o nome da unidade automaticamente.</p>`));

  const ordem = [...G.roteiros].sort((a, b) => ultimosGerados.includes(b.id) - ultimosGerados.includes(a.id));
  ordem.forEach((r) => {
    const usado = G.unidades.filter((u) => u.roteiro_id === r.id).map((u) => u.nome);
    const novo = ultimosGerados.includes(r.id);
    const card = el(`<div class="card${novo ? " card-new" : ""}"><div class="card-top"><h3></h3>${novo ? '<span class="badge">Novo</span>' : ""}</div><p class="c-info"></p><p class="c-prev"></p><div class="c-acts"></div></div>`);
    card.querySelector("h3").textContent = r.titulo;
    card.querySelector(".c-info").textContent = `${r.blocos.length} blocos · ${usado.length ? "Usado em: " + usado.join(", ") : "Nenhuma unidade usando"}`;
    card.querySelector(".c-prev").textContent = "“" + (r.blocos[0]?.texto || "") + "”";
    const acts = card.querySelector(".c-acts");
    const ed = el(`<button class="btn btn-ghost btn-sm">Ver e editar</button>`); ed.onclick = () => editarRoteiro(r.id); acts.append(ed);
    const un = r.cidade && G.unidades.find((u) => norm(u.nome) === norm(r.cidade));
    if (un && un.roteiro_id !== r.id) {
      const usar = el(`<button class="btn btn-primary btn-sm"></button>`);
      usar.textContent = `Usar em ${un.nome}`;
      usar.onclick = async () => {
        const { error } = await sb.from("unidades").update({ roteiro_id: r.id }).eq("id", un.id);
        if (error) return toast("Não consegui trocar o roteiro.", true);
        toast(`${un.nome} vai gravar este roteiro`); await carregarGestao(); renderGestao();
      };
      acts.append(usar);
    }
    box.append(card);
  });

  const add = el(`<button class="btn btn-ghost">+ Novo roteiro em branco</button>`);
  add.onclick = async () => {
    const { data, error } = await sb.from("roteiros").insert({
      titulo: "Novo roteiro", objetivo: "",
      blocos: [
        { tipo: "Gancho", enquadramento: "close", texto: "Olá, {cidade}! ", dica: "" },
        { tipo: "Desenvolvimento", enquadramento: "medio", texto: "", dica: "" },
        { tipo: "CTA", enquadramento: "close", texto: "Clique no link e agende sua avaliação.", dica: "" },
      ],
    }).select().single();
    if (error) return toast("Não consegui criar o roteiro.", true);
    G.roteiros.unshift(data); editarRoteiro(data.id);
  };
  box.append(add);
}

let editR = null;
function editarRoteiro(id) {
  editR = G.roteiros.find((r) => r.id === id);
  $("#eTitulo").value = editR.titulo; $("#eObjetivo").value = editR.objetivo;
  $("#eTitulo").oninput = () => { editR.titulo = $("#eTitulo").value; salvarRoteiro(); };
  $("#eObjetivo").oninput = () => { editR.objetivo = $("#eObjetivo").value; salvarRoteiro(); };
  $("#eStatus").textContent = "As alterações são salvas automaticamente.";
  renderBlocosEditor(); show("editor");
}
function salvarRoteiro() {
  $("#eStatus").textContent = "Salvando…";
  salvarDepois("rot", async () => {
    const { error } = await sb.from("roteiros").update({ titulo: editR.titulo, objetivo: editR.objetivo, blocos: editR.blocos }).eq("id", editR.id);
    $("#eStatus").textContent = error ? "Não consegui salvar. Confira a internet." : "Salvo.";
  });
}
function renderBlocosEditor() {
  const box = $("#eBlocos"); box.innerHTML = "";
  editR.blocos.forEach((b, i) => {
    const row = el(`<div class="g-card">
      <div class="g-2">
        <div class="field"><label>Bloco ${i + 1}</label><input class="inp" data-k="tipo"></div>
        <div class="field"><label>Enquadramento</label><select class="inp" data-k="enquadramento">${opts([["close", "Close"], ["medio", "Plano médio"]], b.enquadramento)}</select></div>
      </div>
      <div class="field"><label>Texto que o doutor fala</label><textarea class="inp" data-k="texto" rows="4"></textarea></div>
      <div class="field"><label>Dica de interpretação</label><input class="inp" data-k="dica"></div>
      <div class="g-foot"><span></span><button class="link-del">Remover bloco</button></div></div>`);
    ["tipo", "texto", "dica"].forEach((k) => (row.querySelector(`[data-k="${k}"]`).value = b[k] || ""));
    row.querySelectorAll(".inp").forEach((inp) => (inp.oninput = () => { b[inp.dataset.k] = inp.value; salvarRoteiro(); }));
    row.querySelector(".link-del").onclick = () => {
      if (editR.blocos.length < 2) return toast("O roteiro precisa ter pelo menos 1 bloco.", true);
      editR.blocos.splice(i, 1); salvarRoteiro(); renderBlocosEditor();
    };
    box.append(row);
  });
}
$("#eAddBloco").onclick = () => { editR.blocos.push({ tipo: "Novo bloco", enquadramento: "close", texto: "", dica: "" }); salvarRoteiro(); renderBlocosEditor(); };
$("#eVoltar").onclick = async () => { aba = "roteiros"; show("gestao"); await carregarGestao(); renderGestao(); };
$("#eExcluir").onclick = async () => {
  if (!confirm(`Excluir o roteiro "${editR.titulo}"? As unidades que usam ele ficarão sem roteiro.`)) return;
  const { error } = await sb.from("roteiros").delete().eq("id", editR.id);
  if (error) return toast("Não consegui excluir.", true);
  aba = "roteiros"; show("gestao"); await carregarGestao(); renderGestao();
};

/* ---------- Início ---------- */
iniciar().catch(() => show("login"));
