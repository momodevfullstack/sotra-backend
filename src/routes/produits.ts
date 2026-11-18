import { Router } from 'express';
import { pool } from '../db/index.js';
import { generateAutoCode } from '../lib/codeGenerator.js';

const router = Router();

router.get('/', async (_req, res) => {
  const [rows] = await pool.execute('SELECT * FROM produits ORDER BY id DESC');
  return res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.execute('SELECT * FROM produits WHERE id = ?', [Number(id)]);
  const result = Array.isArray(rows) ? rows : [];

  if (!result.length) {
    return res.status(404).json({ message: 'Produit non trouvé' });
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
  const { codeProduit, libelle, prixUnitaire } = req.body;

  if (!libelle || prixUnitaire === undefined || prixUnitaire === null) {
    return res.status(400).json({ message: 'libelle et prixUnitaire sont requis' });
  }

  const generatedCodeProduit = codeProduit || await generateAutoCode('produits', 'PROD');

  const sql = `
    INSERT INTO produits (code_produit, libelle, prix_unitaire)
    VALUES (?, ?, ?)
  `;

  const [result] = await pool.execute(sql, [
    generatedCodeProduit,
    libelle,
    Number(prixUnitaire),
  ]);

  return res.status(201).json({ message: 'Produit créé', data: result });
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const payload = req.body;
  const fields: string[] = [];
  const values: any[] = [];

  if (payload.codeProduit) {
    fields.push('code_produit = ?');
    values.push(payload.codeProduit);
  }
  if (payload.libelle) {
    fields.push('libelle = ?');
    values.push(payload.libelle);
  }
  if (payload.prixUnitaire !== undefined && payload.prixUnitaire !== null) {
    fields.push('prix_unitaire = ?');
    values.push(Number(payload.prixUnitaire));
  }

  if (!fields.length) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  values.push(Number(id));
  const sql = `UPDATE produits SET ${fields.join(', ')} WHERE id = ?`;
  await pool.execute(sql, values);

  return res.json({ message: 'Produit mis à jour' });
});

router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const payload = req.body;

  if (!payload || Object.keys(payload).length === 0) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  const fields: string[] = [];
  const values: any[] = [];

  if (payload.codeProduit !== undefined) { fields.push('code_produit = ?'); values.push(payload.codeProduit); }
  if (payload.libelle !== undefined) { fields.push('libelle = ?'); values.push(payload.libelle); }
  if (payload.prixUnitaire !== undefined) { fields.push('prix_unitaire = ?'); values.push(Number(payload.prixUnitaire)); }

  if (!fields.length) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  values.push(Number(id));
  await pool.execute(`UPDATE produits SET ${fields.join(', ')} WHERE id = ?`, values);
  return res.json({ message: 'Produit partiellement mis à jour' });
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  await pool.execute('DELETE FROM produits WHERE id = ?', [Number(id)]);
  return res.json({ message: 'Produit supprimé' });
});

export default router;
