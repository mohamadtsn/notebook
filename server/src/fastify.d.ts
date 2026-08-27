import '@fastify/jwt';
import type { onRequestHookHandler } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: onRequestHookHandler;
    /** Always used after `authenticate` — it reads the user id off the verified token. */
    requirePro: onRequestHookHandler;
    /** Also always after `authenticate`. Authority is the ADMIN_EMAILS env, per request. */
    requireAdmin: onRequestHookHandler;
  }
}