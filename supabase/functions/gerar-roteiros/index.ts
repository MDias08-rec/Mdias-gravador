// Gera 3 roteiros (dor → solução, quebra de objeção, chamada local) com a API da Anthropic
// e salva no banco. Só o gestor pode usar. A chave fica no segredo ANTHROPIC_API_KEY.
import { admin, CORS, erro, json, quemChamou } from "../_shared/comum.ts";

const MODELO = "claude-sonnet-5-5";

const SISTEMA = `Você é roteirista de anúncios de tráfego pago (Instagram e Facebook) para uma rede de clínicas odontológicas no Brasil.
Quem grava é o próprio dentista, sozinho, com a câmera frontal do celular, falando direto para a câmera.

Escreva 3 roteiros para o tratamento e a cidade informados, um em cada modelo:
1. "Dor → solução": o gancho nomeia o problema ou incômodo que o paciente sente; o desenvolvimento mostra que há solução e como ela funciona, sem termos técnicos; o CTA convida para a avaliação.
2. "Quebra de objeção": o gancho traz a dúvida ou o medo mais comum sobre o tratamento (dor, preço, tempo, resultado); o desenvolvimento responde com calma e segurança; o CTA convida a tirar as dúvidas pessoalmente.
3. "Chamada local": o gancho chama a cidade pelo nome logo nas primeiras palavras; o desenvolvimento dá um motivo concreto para agendar agora; o CTA é curto e direto.

Regras:
- Cada roteiro tem exatamente 3 blocos: "Gancho", "Desenvolvimento" e "CTA".
- Gancho com no máximo 15 palavras (cerca de 3 segundos). Desenvolvimento com 35 a 60 palavras. CTA com no máximo 15 palavras, terminando com o convite para clicar no link e agendar.
- Duração total entre 25 e 40 segundos falados.
- Linguagem simples, frases curtas, português do Brasil falado, primeira pessoa ("aqui na nossa unidade de ...").
- Cite a cidade pelo nome em pelo menos um bloco de cada roteiro.
- Siga as regras de publicidade do Conselho Federal de Odontologia: não prometa resultado, não use "garantido", "sem dor", "o melhor", "o mais barato", não cite preço nem desconto (a não ser que as observações peçam), não use antes e depois, não critique outros profissionais.
- Enquadramento: "close" (rosto e ombros) para Gancho e CTA; "medio" (da cintura pra cima) para o Desenvolvimento.
- Dica: uma frase curta orientando o dentista a interpretar o bloco (energia, ritmo, olhar, gesto).

Responda SOMENTE com JSON válido, sem texto antes ou depois, neste formato:
{"roteiros":[{"modelo":"Dor → solução","objetivo":"uma frase sobre o que o anúncio busca","blocos":[{"tipo":"Gancho","enquadramento":"close","texto":"...","dica":"..."},{"tipo":"Desenvolvimento","enquadramento":"medio","texto":"...","dica":"..."},{"tipo":"CTA","enquadramento":"close","texto":"...","dica":"..."}]}]}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return erro("Método não permitido", 405);

  const sb = admin();
  const quem = await quemChamou(req, sb);
  if (!quem) return erro("Sessão expirada. Entre de novo.", 401);
  if (quem.perfil.papel !== "gestor") return erro("Só o gestor pode gerar roteiros.", 403);

  const chave = Deno.env.get("ANTHROPIC_API_KEY");
  if (!chave) return erro("A chave da API da Anthropic ainda não foi configurada no servidor.", 500);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return erro("Pedido inválido."); }
  const tratamento = String(body.tratamento || "").trim().slice(0, 120);
  const cidade = String(body.cidade || "").trim().slice(0, 120);
  const obs = String(body.observacoes || "").trim().slice(0, 500);
  if (!tratamento || !cidade) return erro("Preencha o tratamento e a cidade.");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": chave, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 3000,
      system: SISTEMA,
      messages: [{ role: "user", content: `Tratamento: ${tratamento}\nCidade: ${cidade}${obs ? "\nObservações: " + obs : ""}` }],
    }),
  });
  if (res.status === 401) return erro("A chave da API da Anthropic não foi aceita. Confira no painel do Supabase.", 502);
  if (res.status === 429) return erro("Muitos pedidos seguidos. Espere um minuto e tente de novo.", 429);
  if (!res.ok) return erro(`O serviço de IA respondeu com erro (${res.status}). Tente de novo em instantes.`, 502);

  const data = await res.json();
  const txt: string = (data.content || []).map((c: { text?: string }) => c.text || "").join("");
  let parsed: { roteiros?: Array<{ modelo?: string; objetivo?: string; blocos?: Array<Record<string, string>> }> };
  try { parsed = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1)); }
  catch { return erro("A resposta da IA veio incompleta. Tente gerar de novo.", 502); }

  const linhas = (parsed.roteiros || []).filter((r) => r.blocos?.length).map((r) => ({
    titulo: `${tratamento} · ${cidade} · ${r.modelo || "Roteiro"}`,
    objetivo: r.objetivo || "",
    tratamento, cidade, modelo: r.modelo || null,
    blocos: r.blocos!.map((b) => ({
      tipo: b.tipo || "Bloco",
      enquadramento: b.enquadramento === "medio" ? "medio" : "close",
      texto: b.texto || "",
      dica: b.dica || "",
    })),
  }));
  if (!linhas.length) return erro("A IA não devolveu roteiros nesse formato. Tente gerar de novo.", 502);

  const { data: salvos, error } = await sb.from("roteiros").insert(linhas).select("id");
  if (error) return erro("Não consegui salvar os roteiros: " + error.message, 500);
  return json({ ok: true, ids: salvos.map((s) => s.id) });
});
