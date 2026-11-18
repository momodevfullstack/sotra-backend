import { Router } from 'express';
import { pool } from '../db/index.js';
import { generateAutoCode } from '../lib/codeGenerator.js';

const router = Router();

router.get('/', async (_req, res) => {
  const [rows] = await pool.execute('SELECT * FROM type_etablissement ORDER BY id DESC');
  return res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.execute('SELECT * FROM type_etablissement WHERE id = ?', [Number(id)]);
  const result = Array.isArray(rows) ? rows : [];

  if (!result.length) {
    return res.status(404).json({ message: 'Type d’établissement non trouvé' });
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

  const codeTypeEtablissement = await generateAutoCode('type_etablissement', 'TYPE');
  const sql = 'INSERT INTO type_etablissement (code, libelle) VALUES (?, ?)';
  const [result] = await pool.execute(sql, [codeTypeEtablissement, libelle]);

  return res.status(201).json({ message: 'Type d’établissement créé', data: result });
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { libelle } = req.body;

  if (!libelle) {
    return res.status(400).json({ message: 'libelle est requis' });
  }

  await pool.execute('UPDATE type_etablissement SET libelle = ? WHERE id = ?', [libelle, Number(id)]);
  return res.json({ message: 'Type d’établissement mis à jour' });
});

router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { libelle } = req.body;

  if (libelle === undefined) {
    return res.status(400).json({ message: 'libelle est requis' });
  }

  await pool.execute('UPDATE type_etablissement SET libelle = ? WHERE id = ?', [libelle, Number(id)]);
  return res.json({ message: 'Type d’établissement partiellement mis à jour' });
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const typeId = Number(id);
  const [usageRows] = await pool.execute(
    'SELECT COUNT(*) AS total FROM etablissements WHERE id_type_etablissement = ?',
    [typeId]
  );
  const usageCount = Array.isArray(usageRows)
    ? Number((usageRows[0] as { total?: number | string } | undefined)?.total ?? 0)
    : 0;

  if (usageCount > 0) {
    await pool.execute(
      'UPDATE etablissements SET id_type_etablissement = NULL WHERE id_type_etablissement = ?',
      [typeId]
    );
  }

  const [result] = await pool.execute('DELETE FROM type_etablissement WHERE id = ?', [typeId]);
  const affectedRows = Number((result as { affectedRows?: number }).affectedRows ?? 0);

  if (!affectedRows) {
    return res.status(404).json({ message: 'Type d’établissement non trouvé' });
  }

  return res.json({
    message: usageCount > 0
      ? `Type d’établissement supprimé et ${usageCount} établissement(s) détaché(s).`
      : 'Type d’établissement supprimé',
  });
});

export default router;
