// Configuracao do servidor SO por variaveis de ambiente (nenhum segredo no codigo). Ver .env.example e docs/PUBLICAR.md.
import { createHmac } from 'node:crypto';

const list = (v) => String(v ?? '').split(',').map(s => s.trim()).filter(Boolean);
const num = (v, d) => (Number.isFinite(+v) && v !== undefined && v !== '' ? +v : d);

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  let ice = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (env.ICE_SERVERS_JSON) {
    try { const j = JSON.parse(env.ICE_SERVERS_JSON); if (Array.isArray(j)) ice = j; } catch { console.warn('ICE_SERVERS_JSON invalido: usando STUN padrao'); }
  }
  return {
    production,
    port: num(env.PORT, 8080),
    host: '0.0.0.0',
    // origens do CLIENTE permitidas (CORS e WebSocket), ex.: https://seu-usuario.github.io  (sem barra no fim). "*" libera tudo (so para testes)
    allowedOrigins: list(env.ALLOWED_ORIGINS).map(o => o.replace(/\/+$/, '').toLowerCase()),
    // clientes sem cabecalho Origin (scripts/testes): so em desenvolvimento, ou com ALLOW_NO_ORIGIN=1
    allowNoOrigin: env.ALLOW_NO_ORIGIN === '1' || !production,
    maxRooms: num(env.MAX_ROOMS, 6),
    maxConnections: num(env.MAX_CONNECTIONS, 60),
    maxPayload: num(env.MAX_PAYLOAD, 600 * 1024),     // amostras de voz do modo "eco" cabem aqui
    msgRate: { perSec: num(env.MSG_RATE, 90), burst: num(env.MSG_BURST, 200) },
    // STUN/TURN entregues ao cliente por GET /ice. TURN com credenciais efemeras (coturn "use-auth-secret") se TURN_SECRET estiver definido.
    iceServers: ice,
    turnUrls: list(env.TURN_URLS),
    turnSecret: env.TURN_SECRET || '',
    turnTtl: num(env.TURN_TTL, 3600),
    // ganchos de TESTE (teleporte etc.): so com APAGAO_TEST=1, nunca em producao
    testHooks: env.APAGAO_TEST === '1' && !production,
    // nome do "servico" so para logs
    name: env.SERVICE_NAME || 'apagao-server',
  };
}

export function isOriginAllowed(cfg, origin) {
  if (!origin) return cfg.allowNoOrigin;
  const o = String(origin).replace(/\/+$/, '').toLowerCase();
  if (cfg.allowedOrigins.includes('*')) return true;
  if (cfg.allowedOrigins.includes(o)) return true;
  if (!cfg.production && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o)) return true;
  return false;
}

// lista de servidores ICE para o cliente. Com TURN configurado gera usuario/senha temporarios (HMAC-SHA1, padrao do coturn).
export function iceFor(cfg, user = 'apagao') {
  const servers = cfg.iceServers.map(s => ({ ...s }));
  if (cfg.turnSecret && cfg.turnUrls.length) {
    const username = String(Math.floor(Date.now() / 1000) + cfg.turnTtl) + ':' + user;
    const credential = createHmac('sha1', cfg.turnSecret).update(username).digest('base64');
    servers.push({ urls: cfg.turnUrls, username, credential });
  }
  return servers;
}
