// Cria, altera e exclui acessos de doutores. Só o gestor pode usar,
// exceto "minha_senha", que qualquer usuário logado usa para trocar a própria senha.
import { admin, CORS, emailDo, erro, json, quemChamou, usuarioValido } from "../_shared/comum.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return erro("Método não permitido", 405);

  const sb = admin();
  const quem = await quemChamou(req, sb);
  if (!quem) return erro("Sessão expirada. Entre de novo.", 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return erro("Pedido inválido."); }
  const acao = String(body.acao || "");

  // Qualquer usuário: trocar a própria senha
  if (acao === "minha_senha") {
    const senha = String(body.senha || "");
    if (senha.length < 6) return erro("A senha precisa ter pelo menos 6 caracteres.");
    const { error } = await sb.auth.admin.updateUserById(quem.userId, { password: senha });
    return error ? erro("Não consegui trocar a senha. Tente de novo.") : json({ ok: true });
  }

  if (quem.perfil.papel !== "gestor") return erro("Só o gestor pode fazer isso.", 403);

  if (acao === "criar") {
    const nome = String(body.nome || "").trim();
    const usuario = String(body.usuario || "").trim().toLowerCase();
    const senha = String(body.senha || "");
    const unidade_id = body.unidade_id ? String(body.unidade_id) : null;
    const papel = body.papel === "gestor" ? "gestor" : "doutor";
    if (!nome) return erro("Informe o nome.");
    if (!usuarioValido(usuario)) return erro("Usuário deve ter de 3 a 30 letras minúsculas, números, ponto, traço ou sublinhado, sem espaço.");
    if (senha.length < 6) return erro("A senha precisa ter pelo menos 6 caracteres.");
    const { data: existe } = await sb.from("perfis").select("id").eq("usuario", usuario).maybeSingle();
    if (existe) return erro(`O usuário "${usuario}" já existe. Escolha outro.`);

    const { data: u, error } = await sb.auth.admin.createUser({ email: emailDo(usuario), password: senha, email_confirm: true });
    if (error || !u?.user) return erro("Não consegui criar o acesso: " + (error?.message || "erro desconhecido"));
    const { error: e2 } = await sb.from("perfis").insert({ id: u.user.id, nome, usuario, papel, unidade_id });
    if (e2) { await sb.auth.admin.deleteUser(u.user.id); return erro("Não consegui salvar o perfil: " + e2.message); }
    return json({ ok: true, id: u.user.id });
  }

  if (acao === "atualizar") {
    const id = String(body.id || "");
    const { data: alvo } = await sb.from("perfis").select("*").eq("id", id).maybeSingle();
    if (!alvo) return erro("Acesso não encontrado.", 404);

    const patch: Record<string, unknown> = {};
    const authPatch: Record<string, unknown> = {};
    if (typeof body.nome === "string") {
      if (!body.nome.trim()) return erro("O nome não pode ficar vazio.");
      patch.nome = body.nome.trim();
    }
    if ("unidade_id" in body) patch.unidade_id = body.unidade_id || null;
    if (typeof body.usuario === "string" && body.usuario.trim().toLowerCase() !== alvo.usuario) {
      const usuario = body.usuario.trim().toLowerCase();
      if (!usuarioValido(usuario)) return erro("Usuário deve ter de 3 a 30 letras minúsculas, números, ponto, traço ou sublinhado, sem espaço.");
      const { data: existe } = await sb.from("perfis").select("id").eq("usuario", usuario).maybeSingle();
      if (existe) return erro(`O usuário "${usuario}" já existe. Escolha outro.`);
      patch.usuario = usuario;
      authPatch.email = emailDo(usuario);
      authPatch.email_confirm = true;
    }
    if (typeof body.senha === "string" && body.senha) {
      if (body.senha.length < 6) return erro("A senha precisa ter pelo menos 6 caracteres.");
      authPatch.password = body.senha;
    }
    if (Object.keys(authPatch).length) {
      const { error } = await sb.auth.admin.updateUserById(id, authPatch);
      if (error) return erro("Não consegui atualizar o acesso: " + error.message);
    }
    if (Object.keys(patch).length) {
      const { error } = await sb.from("perfis").update(patch).eq("id", id);
      if (error) return erro("Não consegui salvar: " + error.message);
    }
    return json({ ok: true });
  }

  if (acao === "excluir") {
    const id = String(body.id || "");
    if (id === quem.userId) return erro("Você não pode excluir o seu próprio acesso.");
    const { error } = await sb.auth.admin.deleteUser(id);
    return error ? erro("Não consegui excluir: " + error.message) : json({ ok: true });
  }

  return erro("Ação desconhecida.");
});
