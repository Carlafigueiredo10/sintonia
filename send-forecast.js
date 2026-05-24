// send-forecast.js
// Roda toda semana via GitHub Actions:
//   1. Busca inscritas ativas no Supabase (sintonia_waitlist)
//   2. Gera a previsão astrológica com Claude
//   3. Envia o e-mail individual pra cada inscrita via Resend
//
// Variáveis de ambiente esperadas:
//   ANTHROPIC_API_KEY
//   SUPABASE_URL                ex: https://rwdiujiuryiwqfsviitf.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   (precisa do service role pra burlar RLS de leitura)
//   RESEND_API_KEY
//   FROM_EMAIL                  ex: previsoes@sintonia.com.br
//   UNSUBSCRIBE_BASE_URL        ex: https://sintonia.app/.netlify/functions/unsubscribe

import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";

const {
  ANTHROPIC_API_KEY,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  RESEND_API_KEY,
  FROM_EMAIL,
  UNSUBSCRIBE_BASE_URL,
  UNSUBSCRIBE_SECRET,
} = process.env;

// ─────────────────────────────────────────
// 1. Busca inscritas ativas no Supabase
// ─────────────────────────────────────────
async function getSubscribers() {
  const url = `${SUPABASE_URL}/rest/v1/sintonia_waitlist?select=email,nome&unsubscribed=eq.false`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Supabase erro ${res.status}: ${await res.text()}`);
  }

  const rows = await res.json();
  const seen = new Set();
  return rows
    .filter((r) => r.email && !seen.has(r.email.toLowerCase()) && seen.add(r.email.toLowerCase()))
    .map((r) => ({ email: r.email, nome: r.nome || null }));
}

// ─────────────────────────────────────────
// 2. Gera a previsão com Claude
// ─────────────────────────────────────────
async function generateForecast() {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const hoje = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 900,
    messages: [
      {
        role: "user",
        content: `Você é a voz da Sintonia — uma plataforma brasileira de encontros curados por astrologia, com linguagem poética, acolhedora e feminina.

Hoje é ${hoje}.

Escreva a previsão astrológica semanal para as inscritas da Sintonia. Deve ter:

1. **Abertura** (1 parágrafo): O clima geral do céu nessa semana — qual energia predomina, que movimento planetário importa. Seja específica: mencione o signo ou trânsito real mais relevante para a semana.

2. **O convite da semana** (1 parágrafo): Uma prática, intenção ou abertura concreta que faz sentido com esse céu. Pode ser sobre encontros, presença, relacionamentos, tempo próprio.

3. **A frase da semana** (1 linha): Uma frase curta, com imagem poética, que resume o espírito do período.

Formato: texto corrido, sem subtítulos, sem emojis. Linguagem íntima, como uma carta. Máximo 250 palavras.`,
      },
    ],
  });

  return message.content[0].text;
}

// ─────────────────────────────────────────
// 3. Monta o HTML do e-mail
// ─────────────────────────────────────────
function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function unsubscribeUrl(email) {
  const token = crypto
    .createHmac("sha256", UNSUBSCRIBE_SECRET || "sintonia-dev-secret")
    .update(email.toLowerCase())
    .digest("hex")
    .slice(0, 16);
  const params = new URLSearchParams({ email, t: token });
  return `${UNSUBSCRIBE_BASE_URL}?${params.toString()}`;
}

function buildEmailHTML(forecastText, weekLabel, unsubUrl) {
  const paragraphs = forecastText
    .split(/\n\n+/)
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 1.2em 0; line-height:1.7;">${escapeHtml(p.trim())}</p>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5ede0;font-family:Georgia,serif;">
  <div style="max-width:560px;margin:0 auto;padding:2rem 1rem;">

    <div style="border-bottom:1px solid #c8b89a;padding-bottom:1.5rem;margin-bottom:2rem;text-align:center;">
      <p style="margin:0;font-family:monospace;font-size:0.65rem;letter-spacing:0.2em;text-transform:uppercase;color:#7a6a5a;">${escapeHtml(weekLabel)}</p>
      <p style="margin:0.5rem 0 0;font-size:1.5rem;font-style:italic;color:#22243a;letter-spacing:-0.02em;">Sintonia</p>
    </div>

    <div style="color:#2a2035;font-size:1.05rem;">
      ${paragraphs}
    </div>

    <div style="border-top:1px solid #c8b89a;margin-top:2.5rem;padding-top:1.5rem;text-align:center;">
      <p style="margin:0;font-family:monospace;font-size:0.65rem;letter-spacing:0.15em;text-transform:uppercase;color:#9a8a7a;">Brasília · Encontros no tempo certo</p>
      <p style="margin:0.75rem 0 0;font-family:monospace;font-size:0.65rem;color:#b0a090;">
        <a href="${unsubUrl}" style="color:#7a2a1a;text-decoration:none;">cancelar inscrição</a>
      </p>
    </div>

  </div>
</body>
</html>`;
}

// ─────────────────────────────────────────
// 4. Envia o e-mail via Resend (em lotes)
// ─────────────────────────────────────────
async function sendEmails(subscribers, subject, forecastText, weekLabel) {
  if (subscribers.length === 0) {
    console.log("Nenhuma inscrita ativa encontrada.");
    return;
  }

  console.log(`Enviando para ${subscribers.length} inscritas...`);

  const BATCH = 50;
  let enviados = 0;
  let falhas = 0;

  for (let i = 0; i < subscribers.length; i += BATCH) {
    const lote = subscribers.slice(i, i + BATCH);

    const results = await Promise.allSettled(
      lote.map((sub) => {
        const html = buildEmailHTML(forecastText, weekLabel, unsubscribeUrl(sub.email));
        return fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: `Sintonia <${FROM_EMAIL}>`,
            to: [sub.email],
            subject,
            html,
          }),
        }).then(async (r) => {
          if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
        });
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled") enviados++;
      else {
        falhas++;
        console.error("  Falha:", r.reason?.message || r.reason);
      }
    }

    console.log(`  ✓ ${enviados}/${subscribers.length} (falhas: ${falhas})`);

    if (i + BATCH < subscribers.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`Envio concluído. Sucesso: ${enviados} · Falhas: ${falhas}`);
  if (falhas > 0) process.exitCode = 1;
}

// ─────────────────────────────────────────
// Principal
// ─────────────────────────────────────────
async function main() {
  const required = {
    ANTHROPIC_API_KEY,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    RESEND_API_KEY,
    FROM_EMAIL,
    UNSUBSCRIBE_BASE_URL,
    UNSUBSCRIBE_SECRET,
  };
  const faltando = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (faltando.length) {
    console.error("Variáveis faltando:", faltando.join(", "));
    process.exit(1);
  }

  const weekLabel = new Date().toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });

  console.log(`\n☽ Sintonia — Previsão de ${weekLabel}\n`);

  console.log("Buscando inscritas...");
  const subscribers = await getSubscribers();
  console.log(`${subscribers.length} inscritas ativas.`);

  console.log("Gerando previsão com Claude...");
  const forecast = await generateForecast();
  console.log("Previsão gerada:\n---\n" + forecast + "\n---");

  const subject = `☽ Sintonia — o céu desta semana`;
  await sendEmails(subscribers, subject, forecast, weekLabel);
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
