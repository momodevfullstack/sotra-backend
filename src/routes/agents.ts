import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agents } from '../db/schema.js';
import { generateAutoCode } from '../lib/codeGenerator.js';

const router = Router();

router.get('/', async (req, res) => {
  const user = (req as any).user;
  if (user?.role === 'agent' && !user.idAgent) {
    return res.json([]);
  }
  const result = user?.role === 'agent'
    ? await db.select().from(agents).where(eq(agents.id, Number(user.idAgent)))
    : await db.select().from(agents);
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const result = await db.select().from(agents).where(eq(agents.id, Number(id)));

  if (!result.length) {
    return res.status(404).json({ message: 'Agent non trouvé' });
  }

  return res.json(result[0]);
});

router.head('/', (_req, res) => {
  res.status(200).end();
});

router.options('/', (_req, res) => {
  res.header('Allow', 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD');
  res.status(204).end();
});

router.post('/', async (req, res) => {
  const { matricule, nom, prenoms, email, telephone, poste, idCollege } = req.body;

  if (!nom || !prenoms || !idCollege) {
    return res.status(400).json({ message: 'nom, prénoms et collège sont requis' });
  }

  const collegeId = Number(idCollege);
  if (!Number.isInteger(collegeId) || collegeId <= 0) {
    return res.status(400).json({ message: 'Le collège sélectionné est invalide.' });
  }

  const generatedMatricule = matricule || await generateAutoCode('agents', 'AG');

  const [created] = await db.insert(agents).values({
    idCollege: collegeId,
    matricule: generatedMatricule,
    nom,
    prenoms,
    email,
    telephone,
    poste,
  });

  return res.status(201).json({ message: 'Agent créé', data: created });
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const payload = req.body;
  const update = { ...payload, updatedAt: new Date() };
  if (payload.idCollege !== undefined) update.idCollege = Number(payload.idCollege) || null;

  await db.update(agents).set(update).where(eq(agents.id, Number(id)));

  return res.json({ message: 'Agent mis à jour' });
});

router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const payload = req.body;

  if (!payload || Object.keys(payload).length === 0) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  const update = { ...payload, updatedAt: new Date() };
  if (payload.idCollege !== undefined) update.idCollege = Number(payload.idCollege) || null;

  await db.update(agents).set(update).where(eq(agents.id, Number(id)));

  return res.json({ message: 'Agent partiellement mis à jour' });
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    await db.delete(agents).where(eq(agents.id, Number(id)));
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ER_ROW_IS_REFERENCED_2'
    ) {
      return res.status(409).json({
        message: 'Impossible de supprimer cet agent car il est encore associé à des données existantes.',
      });
    }

    throw error;
  }

  return res.json({ message: 'Agent supprimé' });
});

export default router;
