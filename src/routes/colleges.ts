import { Router } from 'express';
import { pool } from '../db/index.js';
import { generateAutoCode } from '../lib/codeGenerator.js';

const router = Router();

router.get('/', async (_req, res) => {
  const [rows] = await pool.execute('SELECT * FROM colleges ORDER BY id DESC');
  return res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.execute('SELECT * FROM colleges WHERE id = ?', [Number(id)]);
  const result = Array.isArray(rows) ? rows : [];

  if (!result.length) {
    return res.status(404).json({ message: 'Collège non trouvé' });
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
  const { libelle } = req.body;

  if (!libelle) {
    return res.status(400).json({ message: 'libelle est requis' });
  }

  const generatedCode = await generateAutoCode('colleges', 'COL');
  const sql = 'INSERT INTO colleges (code, libelle) VALUES (?, ?)';
  const [result] = await pool.execute(sql, [generatedCode, libelle]);

  return res.status(201).json({ message: 'Collège créé', data: result });
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { libelle } = req.body;

  if (!libelle) {
    return res.status(400).json({ message: 'libelle est requis' });
  }

  await pool.execute('UPDATE colleges SET libelle = ? WHERE id = ?', [libelle, Number(id)]);
  return res.json({ message: 'Collège mis à jour' });
});

router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { libelle } = req.body;

  if (libelle === undefined) {
    return res.status(400).json({ message: 'libelle est requis' });
  }

  await pool.execute('UPDATE colleges SET libelle = ? WHERE id = ?', [libelle, Number(id)]);
  return res.json({ message: 'Collège partiellement mis à jour' });
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  await pool.execute('DELETE FROM colleges WHERE id = ?', [Number(id)]);
  return res.json({ message: 'Collège supprimé' });
});

export default router;
