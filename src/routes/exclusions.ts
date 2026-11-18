import { Router } from 'express';
import { pool } from '../db/index.js';

const router = Router();

router.get('/', async (_req, res) => {
  const [rows] = await pool.execute(`
        SELECT e.*, a.num_adherent, CONCAT(a.nom, ' ', a.prenoms) AS beneficiaire,
          p.libelle AS produit_libelle, ac.libelle AS acte_libelle
    FROM exclusions e
    LEFT JOIN adherents a ON a.id = e.id_adherent
    LEFT JOIN produits p ON p.id = e.id_produit
    LEFT JOIN actes ac ON ac.id = e.id_acte
    ORDER BY e.id DESC
  `);

  return res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.execute(`
        SELECT e.*, a.num_adherent, CONCAT(a.nom, ' ', a.prenoms) AS beneficiaire,
          p.libelle AS produit_libelle, ac.libelle AS acte_libelle
    FROM exclusions e
    LEFT JOIN adherents a ON a.id = e.id_adherent
    LEFT JOIN produits p ON p.id = e.id_produit
    LEFT JOIN actes ac ON ac.id = e.id_acte
    WHERE e.id = ?
  `, [Number(id)]);

  const result = Array.isArray(rows) ? rows : [];

  if (!result.length) {
    return res.status(404).json({ message: 'Exclusion non trouvée' });
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
  const { idAdherent, idProduit, idActe, motif, duree, statut } = req.body;

  if (!idAdherent || !motif) {
    return res.status(400).json({ message: 'idAdherent et motif sont requis' });
  }

  const [adherentRows] = await pool.execute('SELECT id FROM adherents WHERE id = ?', [Number(idAdherent)]);
  const adherents = Array.isArray(adherentRows) ? adherentRows : [];

  if (!adherents.length) {
    return res.status(400).json({ message: 'Adhérent invalide pour cette exclusion.' });
  }

  if (idProduit) {
    const [produitRows] = await pool.execute('SELECT id FROM produits WHERE id = ?', [Number(idProduit)]);
    const produits = Array.isArray(produitRows) ? produitRows : [];

    if (!produits.length) {
      return res.status(400).json({ message: 'Produit invalide pour cette exclusion.' });
    }
  }

  if (idActe) {
    const [acteRows] = await pool.execute('SELECT id FROM actes WHERE id = ?', [Number(idActe)]);
    if (!Array.isArray(acteRows) || !acteRows.length) {
      return res.status(400).json({ message: 'Acte médical invalide pour cette exclusion.' });
    }
  }

  const sql = `
    INSERT INTO exclusions (id_adherent, id_produit, id_acte, motif, duree, statut)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  const [result] = await pool.execute(sql, [
    Number(idAdherent),
    idProduit ? Number(idProduit) : null,
    idActe ? Number(idActe) : null,
    motif,
    duree || 'Temporaire (3 mois)',
    statut || 'active',
  ]);

  return res.status(201).json({ message: 'Exclusion créée', data: result });
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const payload = req.body;
  const fields: string[] = [];
  const values: any[] = [];

  if (payload.idAdherent !== undefined) {
    fields.push('id_adherent = ?');
    values.push(Number(payload.idAdherent));
  }
  if (payload.idProduit !== undefined) {
    fields.push('id_produit = ?');
    values.push(payload.idProduit ? Number(payload.idProduit) : null);
  }
  if (payload.idActe !== undefined) {
    fields.push('id_acte = ?');
    values.push(payload.idActe ? Number(payload.idActe) : null);
  }
  if (payload.motif !== undefined) {
    fields.push('motif = ?');
    values.push(payload.motif);
  }
  if (payload.duree !== undefined) {
    fields.push('duree = ?');
    values.push(payload.duree);
  }
  if (payload.statut !== undefined) {
    fields.push('statut = ?');
    values.push(payload.statut);
  }

  if (!fields.length) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  values.push(Number(id));
  await pool.execute(`UPDATE exclusions SET ${fields.join(', ')} WHERE id = ?`, values);
  return res.json({ message: 'Exclusion mise à jour' });
});

router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const payload = req.body;

  if (!payload || Object.keys(payload).length === 0) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  const fields: string[] = [];
  const values: any[] = [];

  if (payload.idAdherent !== undefined) { fields.push('id_adherent = ?'); values.push(Number(payload.idAdherent)); }
  if (payload.idProduit !== undefined) { fields.push('id_produit = ?'); values.push(payload.idProduit ? Number(payload.idProduit) : null); }
  if (payload.idActe !== undefined) { fields.push('id_acte = ?'); values.push(payload.idActe ? Number(payload.idActe) : null); }
  if (payload.motif !== undefined) { fields.push('motif = ?'); values.push(payload.motif); }
  if (payload.duree !== undefined) { fields.push('duree = ?'); values.push(payload.duree); }
  if (payload.statut !== undefined) { fields.push('statut = ?'); values.push(payload.statut); }

  if (!fields.length) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  values.push(Number(id));
  await pool.execute(`UPDATE exclusions SET ${fields.join(', ')} WHERE id = ?`, values);
  return res.json({ message: 'Exclusion partiellement mise à jour' });
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  await pool.execute('DELETE FROM exclusions WHERE id = ?', [Number(id)]);
  return res.json({ message: 'Exclusion supprimée' });
});

export default router;
