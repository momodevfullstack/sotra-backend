import { Router } from 'express';
import { pool } from '../db/index.js';

const router = Router();

router.get('/', async (_req, res) => {
  const [rows] = await pool.execute('SELECT * FROM etablissements ORDER BY id DESC');
  return res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.execute('SELECT * FROM etablissements WHERE id = ?', [Number(id)]);
  const result = Array.isArray(rows) ? rows : [];

  if (!result.length) {
    return res.status(404).json({ message: 'Établissement non trouvé' });
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
  const { libelle, adresse, telephone, idTypeEtablissement, idDrb } = req.body;

  if (!libelle) {
    return res.status(400).json({ message: 'libelle est requis' });
  }

  const sql = `
    INSERT INTO etablissements (libelle, adresse, telephone, id_type_etablissement, id_drb)
    VALUES (?, ?, ?, ?, ?)
  `;

  const [result] = await pool.execute(sql, [
    libelle,
    adresse || null,
    telephone || null,
    idTypeEtablissement ? Number(idTypeEtablissement) : null,
    idDrb ? Number(idDrb) : null,
  ]);

  return res.status(201).json({ message: 'Établissement créé', data: result });
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const payload = req.body;
  const fields: string[] = [];
  const values: any[] = [];

  if (payload.libelle) {
    fields.push('libelle = ?');
    values.push(payload.libelle);
  }
  if (payload.adresse !== undefined) {
    fields.push('adresse = ?');
    values.push(payload.adresse || null);
  }
  if (payload.telephone !== undefined) {
    fields.push('telephone = ?');
    values.push(payload.telephone || null);
  }
  if (payload.idTypeEtablissement !== undefined) {
    fields.push('id_type_etablissement = ?');
    values.push(payload.idTypeEtablissement ? Number(payload.idTypeEtablissement) : null);
  }
  if (payload.idDrb !== undefined) {
    fields.push('id_drb = ?');
    values.push(payload.idDrb ? Number(payload.idDrb) : null);
  }

  if (!fields.length) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  values.push(Number(id));
  await pool.execute(`UPDATE etablissements SET ${fields.join(', ')} WHERE id = ?`, values);
  return res.json({ message: 'Établissement mis à jour' });
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
  if (payload.adresse !== undefined) { fields.push('adresse = ?'); values.push(payload.adresse || null); }
  if (payload.telephone !== undefined) { fields.push('telephone = ?'); values.push(payload.telephone || null); }
  if (payload.idTypeEtablissement !== undefined) { fields.push('id_type_etablissement = ?'); values.push(payload.idTypeEtablissement ? Number(payload.idTypeEtablissement) : null); }
  if (payload.idDrb !== undefined) { fields.push('id_drb = ?'); values.push(payload.idDrb ? Number(payload.idDrb) : null); }

  if (!fields.length) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  values.push(Number(id));
  await pool.execute(`UPDATE etablissements SET ${fields.join(', ')} WHERE id = ?`, values);
  return res.json({ message: 'Établissement partiellement mis à jour' });
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  await pool.execute('DELETE FROM etablissements WHERE id = ?', [Number(id)]);
  return res.json({ message: 'Établissement supprimé' });
});

export default router;
