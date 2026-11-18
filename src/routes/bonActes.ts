import { Router } from 'express';
import { pool } from '../db/index.js';

const router = Router();

async function refreshBonTotal(bonId: number) {
  await pool.execute(`
    UPDATE bons b
    SET b.montant = (
      SELECT COALESCE(SUM(ba.montant), 0)
      FROM bon_actes ba
      WHERE ba.id_bon = b.id
    )
    WHERE b.id = ?
  `, [bonId]);
}

router.get('/', async (req, res) => {
  const bonId = Number(req.query.bonId ?? 0);
  const user = (req as any).user;

  if (!bonId) {
    return res.status(400).json({ message: 'Le bon est requis pour charger les actes.' });
  }

  if (user?.role === 'agent') {
    const [ownedRows] = await pool.execute(`
      SELECT id FROM bons
      WHERE id = ? AND id_agent = ?
        AND (statut = 'dossier_agent' OR statut IN ('valide', 'bon_disponible', 'paye'))
    `, [bonId, Number(user.idAgent || -1)]);
    if (!Array.isArray(ownedRows) || ownedRows.length === 0) {
      return res.status(404).json({ message: 'Bon non trouvé.' });
    }
  }

  const [rows] = await pool.execute(`
    SELECT ba.*, a.libelle AS acte_libelle, a.code_acte, a.montant AS acte_montant
    FROM bon_actes ba
    LEFT JOIN actes a ON a.id = ba.id_acte
    WHERE ba.id_bon = ?
    ORDER BY ba.id DESC
  `, [bonId]);

  return res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const user = (req as any).user;
  const agentScope = user?.role === 'agent'
    ? `AND EXISTS (
        SELECT 1 FROM bons b
        WHERE b.id = ba.id_bon AND b.id_agent = ?
          AND (b.statut = 'dossier_agent' OR b.statut IN ('valide', 'bon_disponible', 'paye'))
      )`
    : '';
  const params = user?.role === 'agent'
    ? [Number(id), Number(user.idAgent || -1)]
    : [Number(id)];
  const [rows] = await pool.execute(`
    SELECT ba.*, a.libelle AS acte_libelle, a.code_acte, a.montant AS acte_montant
    FROM bon_actes ba
    LEFT JOIN actes a ON a.id = ba.id_acte
    WHERE ba.id = ? ${agentScope}
  `, params);

  const result = Array.isArray(rows) ? rows : [];

  if (!result.length) {
    return res.status(404).json({ message: 'Acte du bon non trouvé' });
  }

  return res.json(result[0]);
});

router.post('/', async (req, res) => {
  const { idBon, idActe, quantite, montant } = req.body || {};
  const user = (req as any).user;

  if (!idBon || !idActe) {
    return res.status(400).json({ message: 'idBon et idActe sont requis.' });
  }

  const actId = Number(idActe);
  const bonId = Number(idBon);
  const quantity = Number(quantite ?? 1);

  if (!Number.isInteger(bonId) || bonId <= 0 || !Number.isInteger(actId) || actId <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ message: 'Le bon, l’acte et la quantité doivent être valides.' });
  }

  if (user?.role === 'agent') {
    const [ownedRows] = await pool.execute('SELECT id FROM bons WHERE id = ? AND id_agent = ? AND statut = ?', [bonId, Number(user.idAgent || -1), 'dossier_agent']);
    if (!Array.isArray(ownedRows) || ownedRows.length === 0) {
      return res.status(403).json({ message: 'Cet acte ne peut être ajouté qu’à votre propre dossier.' });
    }
  }

  const [bonRows] = await pool.execute('SELECT id FROM bons WHERE id = ?', [bonId]);
  if (!Array.isArray(bonRows) || bonRows.length === 0) {
    return res.status(400).json({ message: 'Le bordereau sélectionné est introuvable.' });
  }

  const [actRows] = await pool.execute('SELECT id, montant FROM actes WHERE id = ?', [actId]);
  const act = Array.isArray(actRows) ? actRows[0] as { montant?: number | string } : null;

  if (!act) {
    return res.status(400).json({ message: 'L’acte médical sélectionné est introuvable.' });
  }

  const unitPrice = Number(montant ?? act.montant ?? 0);

  const [result] = await pool.execute(
    'INSERT INTO bon_actes (id_bon, id_acte, quantite, montant) VALUES (?, ?, ?, ?)',
    [bonId, actId, quantity, unitPrice * quantity]
  );

  await refreshBonTotal(bonId);

  return res.status(201).json({ message: 'Acte ajouté au bordereau', data: result });
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const payload = req.body || {};

  const fields: string[] = [];
  const values: any[] = [];

  if (payload.quantite !== undefined) {
    fields.push('quantite = ?');
    values.push(Number(payload.quantite));
  }

  if (payload.montant !== undefined) {
    fields.push('montant = ?');
    values.push(Number(payload.montant));
  }

  if (!fields.length) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  const [rows] = await pool.execute('SELECT id_bon FROM bon_actes WHERE id = ?', [Number(id)]);
  const existing = Array.isArray(rows) ? rows[0] as { id_bon?: number } | undefined : undefined;
  if (!existing?.id_bon) {
    return res.status(404).json({ message: 'Acte du bordereau non trouvé' });
  }

  values.push(Number(id));
  await pool.execute(`UPDATE bon_actes SET ${fields.join(', ')} WHERE id = ?`, values);
  await refreshBonTotal(Number(existing.id_bon));

  return res.json({ message: 'Acte du bordereau mis à jour' });
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.execute('SELECT id_bon FROM bon_actes WHERE id = ?', [Number(id)]);
  const existing = Array.isArray(rows) ? rows[0] as { id_bon?: number } | undefined : undefined;
  if (!existing?.id_bon) {
    return res.status(404).json({ message: 'Acte du bordereau non trouvé' });
  }

  await pool.execute('DELETE FROM bon_actes WHERE id = ?', [Number(id)]);
  await refreshBonTotal(Number(existing.id_bon));

  return res.json({ message: 'Acte retiré du bordereau' });
});

export default router;
