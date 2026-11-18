import { Router } from 'express';
import { pool } from '../db/index.js';

const router = Router();

router.get('/', async (req, res) => {
  const user = (req as any).user;
  const restrictedRole = user?.role === 'agent' || user?.role === 'basv';
  const whereClause = restrictedRole
    ? user.role === 'agent'
      ? "WHERE b.id_agent = ? AND b.statut IN ('valide', 'bon_disponible', 'paye')"
      : "WHERE b.statut IN ('dg_a_valider', 'valide', 'bon_disponible', 'paye')"
    : '';
  const params = restrictedRole && user.role === 'agent' ? (user.idAgent ? [Number(user.idAgent)] : [-1]) : [];
  const [rows] = await pool.execute(`
    SELECT b.*, a.matricule AS agent_matricule,
           CONCAT(COALESCE(a.nom, ''), ' ', COALESCE(a.prenoms, '')) AS agent_nom,
           ad.num_adherent AS adherent_numero,
           CONCAT(COALESCE(ad.nom, ''), ' ', COALESCE(ad.prenoms, '')) AS adherent_nom
    FROM bons b
    LEFT JOIN agents a ON a.id = b.id_agent
    LEFT JOIN adherents ad ON ad.id = b.id_adherent
    ${whereClause}
    ORDER BY b.id DESC
  `, params);
  return res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const user = (req as any).user;
  const restrictedRole = user?.role === 'agent' || user?.role === 'basv';
  const whereClause = restrictedRole
    ? user.role === 'agent'
      ? "AND b.id_agent = ? AND b.statut IN ('valide', 'bon_disponible', 'paye')"
    : "AND b.statut IN ('dg_a_valider', 'valide', 'bon_disponible', 'paye')"
    : '';
  const params = restrictedRole && user.role === 'agent'
    ? [Number(id), user.idAgent ? Number(user.idAgent) : -1]
    : [Number(id)];
  const [rows] = await pool.execute(`
    SELECT b.*, a.matricule AS agent_matricule,
           CONCAT(COALESCE(a.nom, ''), ' ', COALESCE(a.prenoms, '')) AS agent_nom,
           ad.num_adherent AS adherent_numero,
           CONCAT(COALESCE(ad.nom, ''), ' ', COALESCE(ad.prenoms, '')) AS adherent_nom
    FROM bons b
    LEFT JOIN agents a ON a.id = b.id_agent
    LEFT JOIN adherents ad ON ad.id = b.id_adherent
    WHERE b.id = ? ${whereClause}
  `, params);

  const result = Array.isArray(rows) ? rows : [];

  if (!result.length) {
    return res.status(404).json({ message: 'Bon non trouvé' });
  }

  return res.json(result[0]);
});

router.post('/:id/dg-approve', async (req, res) => {
  if ((req as any).user?.role !== 'dg') {
    return res.status(403).json({ message: 'Seul le DG peut valider ce bon.' });
  }

  const bonId = Number(req.params.id);
  if (!Number.isInteger(bonId) || bonId <= 0) {
    return res.status(400).json({ message: 'Identifiant de bon invalide.' });
  }

  const [result] = await pool.execute(
    "UPDATE bons SET statut = 'bon_disponible' WHERE id = ? AND statut = 'dg_a_valider'",
    [bonId]
  );
  if ((result as { affectedRows?: number }).affectedRows !== 1) {
    const [rows] = await pool.execute('SELECT id FROM bons WHERE id = ?', [bonId]);
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({ message: 'Bon non trouvé.' });
    }
    return res.status(409).json({ message: 'Ce bon n’est pas en attente de validation du DG.' });
  }

  return res.json({ message: 'Bon validé par le DG et disponible pour l’agent.' });
});

router.head('/', (_req, res) => {
  res.status(200).end();
});

router.options('/', (_req, res) => {
  res.header('Allow', 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD');
  res.status(204).end();
});

router.post('/', async (req, res) => {
  const { numeroBon, montantTotal, statut, idAgent, idAdherent, dateBon } = req.body;

  if (!montantTotal || !idAgent || !idAdherent || !dateBon) {
    return res.status(400).json({ message: 'montantTotal, idAgent, idAdherent et dateBon sont requis' });
  }

  const [countRows] = await pool.execute('SELECT COUNT(*) AS total FROM bons');
  const totalBons = Array.isArray(countRows) ? Number((countRows[0] as { total?: number | string } | undefined)?.total ?? 0) : 0;
  const generatedNumeroBon = numeroBon || `BON-${new Date().getFullYear()}-${String(totalBons + 1).padStart(4, '0')}`;

  const agentId = Number(idAgent);
  const adherentId = Number(idAdherent);

  if (!Number.isInteger(agentId) || agentId <= 0) {
    return res.status(400).json({ message: 'L\'agent sélectionné est invalide.' });
  }

  if (!Number.isInteger(adherentId) || adherentId <= 0) {
    return res.status(400).json({ message: 'L\'adhérent sélectionné est invalide.' });
  }

  const [agentRows] = await pool.execute('SELECT id FROM agents WHERE id = ?', [agentId]);
  const [adherentRows] = await pool.execute('SELECT id FROM adherents WHERE id = ?', [adherentId]);

  if (!Array.isArray(agentRows) || agentRows.length === 0) {
    return res.status(400).json({ message: 'L\'agent sélectionné n\'existe pas.' });
  }

  if (!Array.isArray(adherentRows) || adherentRows.length === 0) {
    return res.status(400).json({ message: 'L\'adhérent sélectionné n\'existe pas.' });
  }

  const sql = `
    INSERT INTO bons (numero_bon, id_agent, id_adherent, montant, date_bon, statut)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  const [result] = await pool.execute(sql, [
    generatedNumeroBon,
    agentId,
    adherentId,
    Number(montantTotal),
    new Date(dateBon).toISOString().slice(0, 10),
    statut || 'en_attente',
  ]);

  return res.status(201).json({ message: 'Bon créé', data: result });
});

async function blockDirectDgApproval(req: any, res: any) {
  if (req.body?.statut === undefined) {
    return false;
  }

  const [rows] = await pool.execute('SELECT statut FROM bons WHERE id = ?', [Number(req.params.id)]);
  const currentStatus = Array.isArray(rows) ? (rows[0] as { statut?: string } | undefined)?.statut : undefined;
  if (currentStatus === 'dg_a_valider' && req.body.statut !== 'dg_a_valider') {
    res.status(409).json({ message: 'Seul le DG peut valider ce bon via l’action de validation dédiée.' });
    return true;
  }

  return false;
}

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const payload = req.body;
  if (await blockDirectDgApproval(req, res)) return;

  const fields: string[] = [];
  const values: any[] = [];

  if (payload.numeroBon) {
    fields.push('numero_bon = ?');
    values.push(payload.numeroBon);
  }
  if (payload.montantTotal) {
    fields.push('montant = ?');
    values.push(Number(payload.montantTotal));
  }
  if (payload.idAgent) {
    fields.push('id_agent = ?');
    values.push(Number(payload.idAgent));
  }
  if (payload.idAdherent) {
    fields.push('id_adherent = ?');
    values.push(Number(payload.idAdherent));
  }
  if (payload.dateBon) {
    fields.push('date_bon = ?');
    values.push(new Date(payload.dateBon).toISOString().slice(0, 10));
  }
  if (payload.statut) {
    fields.push('statut = ?');
    values.push(payload.statut);
  }

  if (!fields.length) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  values.push(Number(id));

  const sql = `UPDATE bons SET ${fields.join(', ')} WHERE id = ?`;
  await pool.execute(sql, values);

  return res.json({ message: 'Bon mis à jour' });
});

router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const payload = req.body;
  if (await blockDirectDgApproval(req, res)) return;

  if (!payload || Object.keys(payload).length === 0) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  const fields: string[] = [];
  const values: any[] = [];

  if (payload.numeroBon !== undefined) { fields.push('numero_bon = ?'); values.push(payload.numeroBon); }
  if (payload.montantTotal !== undefined) { fields.push('montant = ?'); values.push(Number(payload.montantTotal)); }
  if (payload.idAgent !== undefined) { fields.push('id_agent = ?'); values.push(Number(payload.idAgent)); }
  if (payload.idAdherent !== undefined) { fields.push('id_adherent = ?'); values.push(Number(payload.idAdherent)); }
  if (payload.dateBon !== undefined) { fields.push('date_bon = ?'); values.push(new Date(payload.dateBon).toISOString().slice(0, 10)); }
  if (payload.statut !== undefined) { fields.push('statut = ?'); values.push(payload.statut); }

  if (!fields.length) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  values.push(Number(id));
  await pool.execute(`UPDATE bons SET ${fields.join(', ')} WHERE id = ?`, values);
  return res.json({ message: 'Bon partiellement mis à jour' });
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  await pool.execute('DELETE FROM bons WHERE id = ?', [Number(id)]);

  return res.json({ message: 'Bon supprimé' });
});

export default router;
