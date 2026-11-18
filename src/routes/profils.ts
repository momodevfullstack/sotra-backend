import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { profils } from '../db/schema.js';

const router = Router();

router.get('/', async (_req, res) => {
  const rows = await db.select().from(profils).orderBy(profils.id);
  return res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const rows = await db.select().from(profils).where(eq(profils.id, Number(id)));

  if (!rows.length) {
    return res.status(404).json({ message: 'Profil non trouvé' });
  }

  return res.json(rows[0]);
});

router.head('/', (_req, res) => {
  res.status(200).end();
});

router.options('/', (_req, res) => {
  res.header('Allow', 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD');
  res.status(204).end();
});

router.post('/', async (req, res) => {
  const { nom, code, role, description, permissions, isActive } = req.body || {};

  if (!nom || !code || !role) {
    return res.status(400).json({ message: 'nom, code et role sont requis' });
  }

  const [created] = await db.insert(profils).values({
    nom,
    code,
    role,
    description: description || '',
    permissions: permissions ? JSON.stringify(permissions) : '',
    isActive: isActive !== undefined ? Boolean(isActive) : true,
  });

  return res.status(201).json({ message: 'Profil créé', data: created });
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const payload = req.body || {};

  await db.update(profils).set({
    ...payload,
    permissions: payload.permissions ? JSON.stringify(payload.permissions) : undefined,
    updatedAt: new Date(),
  }).where(eq(profils.id, Number(id)));

  return res.json({ message: 'Profil mis à jour' });
});

router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const payload = req.body || {};

  if (!payload || Object.keys(payload).length === 0) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  await db.update(profils).set({
    ...payload,
    permissions: payload.permissions ? JSON.stringify(payload.permissions) : undefined,
    updatedAt: new Date(),
  }).where(eq(profils.id, Number(id)));

  return res.json({ message: 'Profil partiellement mis à jour' });
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  await db.delete(profils).where(eq(profils.id, Number(id)));
  return res.json({ message: 'Profil supprimé' });
});

export default router;
