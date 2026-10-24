import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { ready } from '../../infrastructure/database/shared-state.js';
export function registerHealthRoutes(app:FastifyInstance,database:Pool|null) {
  app.get('/api/v1/health', {
    schema: { response: { 200: { type: 'object', additionalProperties: false, required: ['product', 'status'], properties: { product: { type: 'string' }, status: { type: 'string', enum: ['ok'] } } } } }
  }, async () => ({ product: 'Trueda Tribe ID', status: 'ok' }));
  app.get('/api/v1/health/ready', async (_request, reply) => {
    if (!database) return reply.code(503).send({status:'unavailable'});
    try { if(!await ready(database)) throw new Error('Migrations pending'); return {status:'ready'}; }
    catch { return reply.code(503).send({status:'unavailable'}); }
  });
}
