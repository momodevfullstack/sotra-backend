import { Request, Response, Router } from 'express';
import { pool } from '../db/index.js';

const router = Router();

router.get('/', async (_req, res) => {
  const [rows] = await pool.execute(`
    SELECT t.id, t.id_college, t.taux_couverture, c.libelle AS college_libelle
    FROM taux_college t
    INNER JOIN colleges c ON c.id = t.id_college
    ORDER BY c.libelle
  `);
  return res.json(rows);
});

router.get('/:id', async (req, res) => {
  const [rows] = await pool.execute(`
    SELECT t.id, t.id_college, t.taux_couverture, c.libelle AS college_libelle
    FROM taux_college t
    INNER JOIN colleges c ON c.id = t.id_college
    WHERE t.id = ?
  `, [Number(req.params.id)]);

  if (!Array.isArray(rows) || !rows.length) {
    return res.status(404).json({ message: 'Taux non trouvé.' });
  }
  return res.json(rows[0]);
});

router.post('/', async (req, res) => {
  const collegeId = Number(req.body?.idCollege);
  const rate = Number(req.body?.tauxCouverture);
  if (!Number.isInteger(collegeId) || collegeId <= 0 || !Number.isFinite(rate) || rate < 0 || rate > 100) {
    return res.status(400).json({ message: 'Sélectionnez un collège et un taux compris entre 0 et 100 %.' });
  }

  const [collegeRows] = await pool.execute('SELECT id FROM colleges WHERE id = ?', [collegeId]);
  if (!Array.isArray(collegeRows) || !collegeRows.length) {
    return res.status(400).json({ message: 'Collège invalide pour ce taux.' });
  }

  const [existingRows] = await pool.execute('SELECT id FROM taux_college WHERE id_college = ?', [collegeId]);
  if (Array.isArray(existingRows) && existingRows.length) {
    return res.status(409).json({ message: 'Un taux est déjà configuré pour ce collège.' });
  }

  const [result] = await pool.execute(
    'INSERT INTO taux_college (id_college, taux_couverture) VALUES (?, ?)',
    [collegeId, rate]
  );
  return res.status(201).json({ message: 'Taux de couverture créé.', data: result });
});

const updateRate = async (req: Request, res: Response) => {
  const rate = Number(req.body?.tauxCouverture);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return res.status(400).json({ message: 'Le taux doit être compris entre 0 et 100 %.' });
  }

  const [result] = await pool.execute(
    'UPDATE taux_college SET taux_couverture = ? WHERE id = ?',
    [rate, Number(req.params.id)]
  );
  if ((result as { affectedRows?: number }).affectedRows === 0) {
    return res.status(404).json({ message: 'Taux non trouvé.' });
  }
  return res.json({ message: 'Taux de couverture mis à jour.' });
};

router.put('/:id', updateRate);
router.patch('/:id', updateRate);

router.delete('/:id', async (req, res) => {
  const [result] = await pool.execute('DELETE FROM taux_college WHERE id = ?', [Number(req.params.id)]);
  if ((result as { affectedRows?: number }).affectedRows === 0) {
    return res.status(404).json({ message: 'Taux non trouvé.' });
  }
  return res.json({ message: 'Taux supprimé.' });
});

export default router;
