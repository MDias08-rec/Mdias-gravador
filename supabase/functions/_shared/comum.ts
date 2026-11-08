import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export function erro(mensagem: string, status = 400) {
  return json({ erro: mensagem }, status);
}

export function admin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Confere o token de quem chamou e devolve o perfil (ou null). */
export async function quemChamou(req: Request, sb: SupabaseClient) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: perfil } = await sb.from("perfis").select("*").eq("id", data.user.id).maybeSingle();
  return perfil ? { userId: data.user.id, perfil } : null;
}

export const DOMINIO = "gravador.mdias.app";
export const emailDo = (usuario: string) => `${usuario}@${DOMINIO}`;
export const usuarioValido = (u: string) => /^[a-z0-9][a-z0-9._-]{2,29}$/.test(u);
