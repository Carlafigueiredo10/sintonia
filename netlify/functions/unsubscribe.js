// netlify/functions/unsubscribe.js
// Cancela a inscrição: marca unsubscribed=true no Supabase.
// URL: /.netlify/functions/unsubscribe?email=...&t=<token>
//
// Variáveis de ambiente esperadas (Netlify):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   UNSUBSCRIBE_SECRET   (mesmo segredo usado no send-forecast.js)

import crypto from "node:crypto";

function pageHtml(title, message) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Sintonia</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background: linear-gradient(to bottom, #e8c9a8, #22243a);
         font-family: Georgia, serif; color:#15162a; padding:2rem; }
  .card { max-width:480px; text-align:center; background:rgba(250,240,220,0.9);
          padding:3rem 2rem; border-radius:4px; }
  h1 { font-style:italic; font-weight:500; font-size:2rem; margin:0 0 1rem; letter-spacing:-0.02em; }
  p { font-size:1.05rem; line-height:1.6; color:#2a2c45; margin:0 0 1.5rem; }
  a { color:#7a2a1a; text-decoration:none; font-family:monospace; font-size:0.75rem;
      letter-spacing:0.2em; text-transform:uppercase; border-bottom:1px solid #7a2a1a; padding-bottom:2px; }
</style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="/">voltar ao início</a>
  </div>
</body>
</html>`;
}

export async function handler(event) {
  const params = event.queryStringParameters || {};
  const email = (params.email || "").trim().toLowerCase();
  const token = (params.t || "").trim();

  if (!email || !token) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: pageHtml("Link inválido", "Faltam parâmetros para cancelar a inscrição."),
    };
  }

  const expected = crypto
    .createHmac("sha256", process.env.UNSUBSCRIBE_SECRET || "sintonia-dev-secret")
    .update(email)
    .digest("hex")
    .slice(0, 16);

  if (token !== expected) {
    return {
      statusCode: 403,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: pageHtml("Link inválido", "Este link de cancelamento expirou ou não é válido."),
    };
  }

  try {
    const url = `${process.env.SUPABASE_URL}/rest/v1/sintonia_waitlist?email=eq.${encodeURIComponent(email)}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ unsubscribed: true }),
    });

    if (!res.ok) {
      console.error("Supabase erro:", res.status, await res.text());
      throw new Error("supabase");
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: pageHtml(
        "Inscrição cancelada",
        "Pronto. Você não receberá mais e-mails da Sintonia. Se mudar de ideia, é só voltar e se inscrever de novo."
      ),
    };
  } catch (err) {
    console.error("Erro ao cancelar:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: pageHtml("Algo deu errado", "Não conseguimos cancelar agora. Tente daqui a pouco ou responda o e-mail pedindo o cancelamento."),
    };
  }
}
