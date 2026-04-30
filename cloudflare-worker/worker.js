const CLIENT_ID     = 'Ov23liqElRLYKGNYFxZJ';
const CLIENT_SECRET = 'b49852f5716f7d3f4364b2ae1070cb09b56b2359';
const ALLOWED_USER  = 'JHevia70';
const ORIGIN        = 'https://jhevia70.github.io';

export default {
  async fetch(request) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);

    if (url.pathname === '/auth/callback') {
      const code = url.searchParams.get('code');
      if (!code) return jsonError('Missing code', 400);

      // Intercambiar code por access_token
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code }),
      });
      const tokenData = await tokenRes.json();
      if (tokenData.error) return jsonError(tokenData.error_description || tokenData.error, 400);

      // Obtener usuario
      const userRes = await fetch('https://api.github.com/user', {
        headers: { 'Authorization': 'token ' + tokenData.access_token, 'User-Agent': 'SC-Trans' },
      });
      const user = await userRes.json();

      if (user.login !== ALLOWED_USER) {
        return json({ ok: false, error: 'Acceso denegado: usuario no autorizado.' });
      }

      return json({ ok: true, user: user.login });
    }

    return jsonError('Not found', 404);
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function jsonError(msg, status) {
  return json({ ok: false, error: msg }, status);
}
