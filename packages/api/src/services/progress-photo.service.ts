import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { NotFoundError, ForbiddenError } from '../utils/errors.js';
import { encrypt, decrypt } from '../utils/encryption.js';

const DATA_DIR = process.env.DATA_DIR || './data';
const PHOTOS_DIR = join(DATA_DIR, 'progress-photos');

function decodeBase64Image(dataUrl: string): Buffer {
  const match = dataUrl.match(/^data:image\/\w+;base64,(.+)$/);
  if (match) return Buffer.from(match[1], 'base64');
  return Buffer.from(dataUrl, 'base64');
}

export async function uploadPhoto(
  fastify: FastifyInstance,
  userId: string,
  data: { takenAt: string; notes?: string; image: string },
) {
  const filename = `${randomUUID()}.jpg`;
  const relativePath = join(userId, filename);
  const absolutePath = join(PHOTOS_DIR, relativePath);

  await mkdir(dirname(absolutePath), { recursive: true });
  const buffer = decodeBase64Image(data.image);
  await writeFile(absolutePath, buffer);

  const encryptedPath = encrypt(relativePath);

  const photo = await fastify.prisma.progressPhoto.create({
    data: {
      userId,
      filePath: encryptedPath,
      takenAt: new Date(data.takenAt + 'T00:00:00Z'),
      notes: data.notes ?? null,
    },
  });

  return {
    id: photo.id,
    userId: photo.userId,
    takenAt: photo.takenAt,
    notes: photo.notes,
    createdAt: photo.createdAt,
  };
}

export async function listPhotos(
  fastify: FastifyInstance,
  userId: string,
  page: number,
  limit: number,
) {
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    fastify.prisma.progressPhoto.findMany({
      where: { userId },
      orderBy: { takenAt: 'desc' },
      select: { id: true, userId: true, takenAt: true, notes: true, createdAt: true },
      skip,
      take: limit,
    }),
    fastify.prisma.progressPhoto.count({ where: { userId } }),
  ]);
  return { data: items, meta: { page, totalPages: Math.ceil(total / limit) || 1 } };
}

export async function getPhotoImage(
  fastify: FastifyInstance,
  userId: string,
  photoId: string,
) {
  const photo = await fastify.prisma.progressPhoto.findUnique({ where: { id: photoId } });
  if (!photo) throw new NotFoundError('Photo');
  if (photo.userId !== userId) throw new ForbiddenError('Not your photo');

  const relativePath = decrypt(photo.filePath);
  const absolutePath = join(PHOTOS_DIR, relativePath);
  const buffer = await readFile(absolutePath);
  return { buffer, contentType: 'image/jpeg' };
}

export async function deletePhoto(
  fastify: FastifyInstance,
  userId: string,
  photoId: string,
) {
  const photo = await fastify.prisma.progressPhoto.findUnique({ where: { id: photoId } });
  if (!photo) throw new NotFoundError('Photo');
  if (photo.userId !== userId) throw new ForbiddenError('Not your photo');

  try {
    const relativePath = decrypt(photo.filePath);
    const absolutePath = join(PHOTOS_DIR, relativePath);
    await unlink(absolutePath);
  } catch {
    // File may already be gone — continue with DB cleanup
  }

  await fastify.prisma.progressPhoto.delete({ where: { id: photoId } });
}
