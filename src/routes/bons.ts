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
    SELECT b.*, (rb.id IS NOT NULL) AS has_receipt, a.matricule AS agent_matricule,
           CONCAT(COALESCE(a.nom, ''), ' ', COALESCE(a.prenoms, '')) AS agent_nom,
           ad.num_adherent AS adherent_numero,
           CONCAT(COALESCE(ad.nom, ''), ' ', COALESCE(ad.prenoms, '')) AS adherent_nom
    FROM bons b
    LEFT JOIN agents a ON a.id = b.id_agent
    LEFT JOIN adherents ad ON ad.id = b.id_adherent
    LEFT JOIN recus_bons rb ON rb.id_bon = b.id
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
  const user = (req as any).user;
  if (user?.role !== 'dg') {
    return res.status(403).json({ message: 'Seul le DG peut valider ce bon.' });
  }

  const bonId = Number(req.params.id);
  if (!Number.isInteger(bonId) || bonId <= 0) {
    return res.status(400).json({ message: 'Identifiant de bon invalide.' });
  }

  const validatorId = Number(user.id);
  if (!Number.isInteger(validatorId) || validatorId <= 0) {
    return res.status(401).json({ message: 'Identité du DG introuvable.' });
  }
  const validatorName = String(user.name || user.email || 'DG').slice(0, 255);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [bonRows] = await connection.execute(`
      SELECT b.id, b.numero_bon, b.id_bordereau, b.id_agent, b.id_adherent, b.montant, b.statut,
             b.montant_base, b.taux_couverture, b.date_bon,
             b.basv_validated_by, b.basv_validator_name, b.basv_validated_at,
             a.matricule AS agent_matricule,
             CONCAT(COALESCE(a.nom, ''), ' ', COALESCE(a.prenoms, '')) AS agent_nom,
             a.email AS agent_email, a.telephone AS agent_telephone, a.poste AS agent_poste,
             c.libelle AS college_libelle,
             ad.num_adherent AS adherent_numero,
             CONCAT(COALESCE(ad.nom, ''), ' ', COALESCE(ad.prenoms, '')) AS adherent_nom,
             br.numero_bordereau, basv.email AS basv_email
      FROM bons b
      LEFT JOIN agents a ON a.id = b.id_agent
      LEFT JOIN colleges c ON c.id = a.id_college
      LEFT JOIN adherents ad ON ad.id = b.id_adherent
      LEFT JOIN bordereaux br ON br.id = b.id_bordereau
      LEFT JOIN utilisateurs basv ON basv.id = b.basv_validated_by
      WHERE b.id = ?
      FOR UPDATE
    `, [bonId]) as [Array<Record<string, unknown> & { id: number; statut?: string }>, unknown];
    const bon = bonRows[0];

    if (!bon) {
      await connection.rollback();
      return res.status(404).json({ message: 'Bon non trouvé.' });
    }

    if (bon.statut !== 'dg_a_valider') {
      await connection.rollback();
      return res.status(409).json({ message: 'Ce bon n’est pas en attente de validation du DG.' });
    }

    await connection.execute(`
      UPDATE bons
      SET statut = 'bon_disponible',
          dg_validated_by = ?, dg_validator_name = ?, dg_validated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND statut = 'dg_a_valider'
    `, [validatorId, validatorName, bonId]);
    await connection.execute(`
      INSERT INTO remboursements
        (id_bon, id_agent, id_adherent, montant, date_remboursement, statut)
      SELECT id, id_agent, id_adherent, montant, CURRENT_DATE(), 'a_rembourser'
      FROM bons
      WHERE id = ?
        AND NOT EXISTS (SELECT 1 FROM remboursements WHERE id_bon = ?)
    `, [bonId, bonId]);

    const [actRows] = await connection.execute(`
      SELECT COALESCE(aa.libelle, 'Acte médical') AS libelle, ba.quantite, ba.montant
      FROM bon_actes ba
      LEFT JOIN actes aa ON aa.id = ba.id_acte
      WHERE ba.id_bon = ?
      ORDER BY ba.id
    `, [bonId]) as [Array<{ libelle: string; quantite: number | string; montant: number | string }>, unknown];

    const receipt = {
      numero: `REC-${bon.numero_bon}`,
      bon: {
        numero: bon.numero_bon,
        bordereau: bon.numero_bordereau,
        date: bon.date_bon,
        montant: bon.montant,
        montantBase: bon.montant_base,
        tauxCouverture: bon.taux_couverture,
      },
      agent: {
        matricule: bon.agent_matricule,
        nom: bon.agent_nom,
        email: bon.agent_email,
        telephone: bon.agent_telephone,
        poste: bon.agent_poste,
        college: bon.college_libelle,
      },
      adherent: {
        numero: bon.adherent_numero,
        nom: bon.adherent_nom,
      },
      validations: {
        basv: {
          id: bon.basv_validated_by,
          nom: bon.basv_validator_name,
          email: bon.basv_email,
          valideLe: bon.basv_validated_at,
        },
        dg: {
          id: validatorId,
          nom: validatorName,
          email: user.email,
          valideLe: new Date().toISOString(),
        },
      },
      genereLe: new Date().toISOString(),
      actes: actRows.map((act) => ({
        libelle: act.libelle,
        quantite: Number(act.quantite),
        montant: act.montant,
      })),
    };

    await connection.execute(
      'INSERT INTO recus_bons (id_bon, contenu) VALUES (?, ?)',
      [bonId, JSON.stringify(receipt)]
    );
    await connection.commit();
    return res.json({ message: 'Bon validé et reçu généré pour l’agent.', receipt });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

router.get('/:id/receipt', async (req, res) => {
  const user = (req as any).user;
  if (!['admin', 'agent', 'basv', 'dg'].includes(user?.role)) {
    return res.status(403).json({ message: 'Vous ne pouvez pas consulter ce reçu.' });
  }
  const bonId = Number(req.params.id);
  if (!Number.isInteger(bonId) || bonId <= 0) {
    return res.status(400).json({ message: 'Identifiant de bon invalide.' });
  }

  const isAgent = user?.role === 'agent';
  const [rows] = await pool.execute(`
    SELECT rb.contenu
    FROM recus_bons rb
    INNER JOIN bons b ON b.id = rb.id_bon
    WHERE b.id = ? AND b.statut IN ('bon_disponible', 'valide', 'paye')
      ${isAgent ? 'AND b.id_agent = ?' : ''}
    LIMIT 1
  `, isAgent ? [bonId, Number(user.idAgent || -1)] : [bonId]) as [Array<{ contenu?: string }>, unknown];

  if (!rows.length) {
    return res.status(404).json({ message: 'Le reçu de ce bon n’est pas disponible.' });
  }

  try {
    return res.json(JSON.parse(rows[0].contenu || ''));
  } catch (error) {
    console.error('Reçu de bon enregistré invalide:', error);
    return res.status(500).json({ message: 'Impossible de lire le reçu de ce bon.' });
  }
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
  if (req.body?.statut === 'paye') {
    res.status(409).json({ message: 'Le bon passe au statut payé uniquement après confirmation du remboursement par l’agent.' });
    return true;
  }

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
