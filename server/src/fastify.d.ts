import '@fastify/jwt';
import type { onRequestHookHandler } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: onRequestHookHandler;
  }
}