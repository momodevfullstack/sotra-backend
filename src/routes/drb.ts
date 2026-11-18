import { Router } from 'express';
import { pool } from '../db/index.js';
import { generateAutoCode } from '../lib/codeGenerator.js';

const router = Router();

router.get('/', async (_req, res) => {
  const [rows] = await pool.execute('SELECT * FROM drb ORDER BY id DESC');
  return res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.execute('SELECT * FROM drb WHERE id = ?', [Number(id)]);
  const result = Array.isArray(rows) ? rows : [];

  if (!result.length) {
    return res.status(404).json({ message: 'DRB non trouvé' });
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
  const { libelle, situation } = req.body;

  if (!libelle) {
    return res.status(400).json({ message: 'libelle est requis' });
  }

  const generatedCode = await generateAutoCode('drb', 'DRB');
  const sql = 'INSERT INTO drb (code, libelle, situation) VALUES (?, ?, ?)';
  const [result] = await pool.execute(sql, [generatedCode, libelle, situation || null]);

  return res.status(201).json({ message: 'DRB créé', data: result });
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { libelle, situation } = req.body;
  const fields: string[] = [];
  const values: any[] = [];

  if (libelle) {
    fields.push('libelle = ?');
    values.push(libelle);
  }
  if (situation !== undefined) {
    fields.push('situation = ?');
    values.push(situation);
  }

  if (!fields.length) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  values.push(Number(id));
  await pool.execute(`UPDATE drb SET ${fields.join(', ')} WHERE id = ?`, values);
  return res.json({ message: 'DRB mis à jour' });
});

router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const payload = req.body;

  if (!payload || Object.keys(payload).length === 0) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  const fields: string[] = [];
  const values: any[] = [];

  if (payload.libelle !== undefined) { fields.push('libelle = ?'); values.push(payload.libelle); }
  if (payload.situation !== undefined) { fields.push('situation = ?'); values.push(payload.situation); }

  if (!fields.length) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  values.push(Number(id));
  await pool.execute(`UPDATE drb SET ${fields.join(', ')} WHERE id = ?`, values);
  return res.json({ message: 'DRB partiellement mis à jour' });
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const drbId = Number(id);
  const [usageRows] = await pool.execute(
    'SELECT COUNT(*) AS total FROM etablissements WHERE id_drb = ?',
    [drbId]
  );
  const usageCount = Array.isArray(usageRows)
    ? Number((usageRows[0] as { total?: number | string } | undefined)?.total ?? 0)
    : 0;

  if (usageCount > 0) {
    await pool.execute(
      'UPDATE etablissements SET id_drb = NULL WHERE id_drb = ?',
      [drbId]
    );
  }

  const [result] = await pool.execute('DELETE FROM drb WHERE id = ?', [drbId]);
  const affectedRows = Number((result as { affectedRows?: number }).affectedRows ?? 0);

  if (!affectedRows) {
    return res.status(404).json({ message: 'DRB non trouvé' });
  }

  return res.json({
    message: usageCount > 0
      ? `DRB supprimé et ${usageCount} établissement(s) détaché(s).`
      : 'DRB supprimé',
  });
});

export default router;
