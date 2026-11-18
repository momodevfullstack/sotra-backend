import { Router } from 'express';
import { pool } from '../db/index.js';
import { generateAutoCode } from '../lib/codeGenerator.js';

const router = Router();

router.get('/', async (_req, res) => {
  const [rows] = await pool.execute('SELECT * FROM actes ORDER BY id DESC');
  return res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.execute('SELECT * FROM actes WHERE id = ?', [Number(id)]);
  const result = Array.isArray(rows) ? rows : [];

  if (!result.length) {
    return res.status(404).json({ message: 'Acte non trouvé' });
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
  const { codeActe, libelle, montant } = req.body;

  if (!libelle || montant === undefined || montant === null) {
    return res.status(400).json({ message: 'libelle et montant sont requis' });
  }

  const generatedCodeActe = codeActe || await generateAutoCode('actes', 'ACT');

  const sql = `
    INSERT INTO actes (code_acte, libelle, montant)
    VALUES (?, ?, ?)
  `;

  const [result] = await pool.execute(sql, [
    generatedCodeActe,
    libelle,
    Number(montant),
  ]);

  return res.status(201).json({ message: 'Acte créé', data: result });
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const payload = req.body;
  const fields: string[] = [];
  const values: any[] = [];

  if (payload.codeActe) {
    fields.push('code_acte = ?');
    values.push(payload.codeActe);
  }
  if (payload.libelle) {
    fields.push('libelle = ?');
    values.push(payload.libelle);
  }
  if (payload.montant !== undefined && payload.montant !== null) {
    fields.push('montant = ?');
    values.push(Number(payload.montant));
  }

  if (!fields.length) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  values.push(Number(id));
  const sql = `UPDATE actes SET ${fields.join(', ')} WHERE id = ?`;
  await pool.execute(sql, values);

  return res.json({ message: 'Acte mis à jour' });
});

router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const payload = req.body;

  if (!payload || Object.keys(payload).length === 0) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  const fields: string[] = [];
  const values: any[] = [];

  if (payload.codeActe !== undefined) { fields.push('code_acte = ?'); values.push(payload.codeActe); }
  if (payload.libelle !== undefined) { fields.push('libelle = ?'); values.push(payload.libelle); }
  if (payload.montant !== undefined) { fields.push('montant = ?'); values.push(Number(payload.montant)); }

  if (!fields.length) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  values.push(Number(id));
  await pool.execute(`UPDATE actes SET ${fields.join(', ')} WHERE id = ?`, values);
  return res.json({ message: 'Acte partiellement mis à jour' });
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  await pool.execute('DELETE FROM actes WHERE id = ?', [Number(id)]);
  return res.json({ message: 'Acte supprimé' });
});

export default router;
