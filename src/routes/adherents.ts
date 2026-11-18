import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { adherents, agents } from '../db/schema.js';
import { generateAutoCode } from '../lib/codeGenerator.js';

const router = Router();

router.get('/', async (req, res) => {
  const user = (req as any).user;
  if (user?.role === 'agent' && !user.idAgent) {
    return res.json([]);
  }
  const result = await db
    .select({
      id: adherents.id,
      numAdherent: adherents.numAdherent,
      idAgent: adherents.idAgent,
      nom: adherents.nom,
      prenoms: adherents.prenoms,
      dateNaissance: adherents.dateNaissance,
      telephone: adherents.telephone,
      agentMatricule: agents.matricule,
    })
    .from(adherents)
    .leftJoin(agents, eq(adherents.idAgent, agents.id))
    .where(user?.role === 'agent' && user.idAgent ? eq(adherents.idAgent, Number(user.idAgent)) : undefined);

  res.json(result);
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const user = (req as any).user;
  const ownership = user?.role === 'agent' ? eq(adherents.idAgent, Number(user.idAgent || -1)) : undefined;
  const result = await db.select().from(adherents).where(and(eq(adherents.id, Number(id)), ownership));

  if (!result.length) {
    return res.status(404).json({ message: 'Adhérent non trouvé' });
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
  const { numAdherent, idAgent, nom, prenoms, dateNaissance, telephone } = req.body;
  const user = (req as any).user;

  if (!nom || !prenoms) {
    return res.status(400).json({ message: 'nom et prenoms sont requis' });
  }

  if (!idAgent) {
    return res.status(400).json({ message: 'l\'agent parent est requis' });
  }

  if (user?.role === 'agent' && Number(idAgent) !== Number(user.idAgent)) {
    return res.status(403).json({ message: 'Un agent ne peut créer un adhérent que pour son propre dossier.' });
  }

  const generatedNumAdherent = numAdherent || await generateAutoCode('adherents', 'ADH');

  const [created] = await db.insert(adherents).values({
    numAdherent: generatedNumAdherent,
    idAgent: Number(idAgent),
    nom,
    prenoms,
    dateNaissance: dateNaissance ? new Date(dateNaissance) : null,
    telephone,
  });

  return res.status(201).json({ message: 'Adhérent créé', data: created });
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { sexe, ...payload } = req.body;
  const user = (req as any).user;
  const ownership = user?.role === 'agent' ? eq(adherents.idAgent, Number(user.idAgent || -1)) : undefined;

  await db.update(adherents).set({
    ...payload,
    updatedAt: new Date(),
    dateNaissance: payload.dateNaissance ? new Date(payload.dateNaissance) : undefined,
  }).where(and(eq(adherents.id, Number(id)), ownership));

  return res.json({ message: 'Adhérent mis à jour' });
});

router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const payload = req.body;
  const user = (req as any).user;

  if (!payload || Object.keys(payload).length === 0) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  const ownership = user?.role === 'agent' ? eq(adherents.idAgent, Number(user.idAgent || -1)) : undefined;
  await db.update(adherents).set({
    ...payload,
    updatedAt: new Date(),
    dateNaissance: payload.dateNaissance ? new Date(payload.dateNaissance) : undefined,
  }).where(and(eq(adherents.id, Number(id)), ownership));

  return res.json({ message: 'Adhérent partiellement mis à jour' });
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const user = (req as any).user;
  const ownership = user?.role === 'agent' ? eq(adherents.idAgent, Number(user.idAgent || -1)) : undefined;

  await db.delete(adherents).where(and(eq(adherents.id, Number(id)), ownership));

  return res.json({ message: 'Adhérent supprimé' });
});

export default router;
