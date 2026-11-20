// OPTIONAL: Cloudflare Worker als Zwischenstation, damit die echte Discord-URL nie in der Datenbank steht.
// Im Admin-Feld "Webhook" trägst du dann ein:  https://DEIN-WORKER.DEIN-ACCOUNT.workers.dev/?k=DEIN_TOKEN
// Worker -> Settings -> Variables and Secrets (Typ Secret):
//   DISCORD_WEBHOOK_URL = https://discord.com/api/webhooks/...
//   RELAY_TOKEN         = langer Zufallswert (derselbe wie "k" in der URL oben)
export default {
  async fetch(req, env) {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    if (new URL(req.url).searchParams.get('k') !== env.RELAY_TOKEN) return new Response('Forbidden', { status: 403 });
    const body = await req.text();
    if (body.length > 20000) return new Response('Too large', { status: 413 });
    const r = await fetch(env.DISCORD_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    return new Response(r.ok ? 'ok' : 'discord ' + r.status, { status: r.ok ? 200 : 502 });
  }
};
