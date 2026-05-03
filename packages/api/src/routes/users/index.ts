import type { FastifyInstance } from 'fastify';
import { updateProfileSchema, updateSettingsSchema, updateUserSchema } from '@fittrackr/shared';
import * as userService from '../../services/user.service.js';

export default async function userRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/users/me', async (request) => {
    const user = await userService.getUser(fastify, request.user.sub);
    return { data: user };
  });

  fastify.patch('/users/me', async (request) => {
    const body = updateUserSchema.parse(request.body);
    const user = await userService.updateUser(fastify, request.user.sub, body);
    return { data: user };
  });

  fastify.get('/users/me/profile', async (request) => {
    const profile = await userService.getProfile(fastify, request.user.sub);
    return { data: profile };
  });

  fastify.put('/users/me/profile', async (request) => {
    const body = updateProfileSchema.parse(request.body);
    const profile = await userService.updateProfile(fastify, request.user.sub, body);
    return { data: profile };
  });

  fastify.get('/users/me/settings', async (request) => {
    const settings = await userService.getSettings(fastify, request.user.sub);
    return { data: settings };
  });

  fastify.put('/users/me/settings', async (request) => {
    const body = updateSettingsSchema.parse(request.body);
    const settings = await userService.updateSettings(fastify, request.user.sub, body);
    return { data: settings };
  });
}
