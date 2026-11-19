import { Router } from 'express';
import { pool } from '../db/index.js';

const router = Router();

router.get('/', async (req, res) => {
  const user = (req as any).user;
  const isAgent = user?.role === 'agent';
  const scopeParts = ["b.statut IN ('valide', 'bon_disponible', 'paye')"];
  const scopeParams: number[] = [];
  if (isAgent) {
    scopeParts.push('b.id_agent = ?');
    scopeParams.push(Number(user.idAgent || -1));
  }
  const scopeClause = `WHERE ${scopeParts.join(' AND ')}`;
  const [rows] = await pool.execute(`
    SELECT
      r.id,
      r.id AS remboursement_id,
      b.id AS id_bon,
      b.numero_bon,
      b.id_agent,
      b.id_adherent,
      a.matricule AS agent_matricule,
      CONCAT(COALESCE(a.nom, ''), ' ', COALESCE(a.prenoms, '')) AS agent_nom,
      ad.num_adherent AS adherent_numero,
      CONCAT(COALESCE(ad.nom, ''), ' ', COALESCE(ad.prenoms, '')) AS adherent_nom,
      COALESCE(r.montant, b.montant) AS montant,
      COALESCE(r.date_remboursement, CURRENT_DATE()) AS date_remboursement,
      COALESCE(r.statut, CASE WHEN b.statut = 'paye' THEN 'paye' ELSE 'a_rembourser' END) AS statut,
      (rcp.id IS NOT NULL) AS has_payment_receipt,
      (rcp.envoye_le IS NOT NULL) AS payment_receipt_sent,
      rcp.nom_envoyeur AS payment_receipt_sender,
      rcp.envoye_le AS payment_receipt_sent_at
    FROM bons b
    LEFT JOIN remboursements r ON r.id = (
      SELECT r2.id
      FROM remboursements r2
      WHERE r2.id_bon = b.id
      ORDER BY r2.id DESC
      LIMIT 1
    )
    LEFT JOIN agents a ON a.id = b.id_agent
    LEFT JOIN adherents ad ON ad.id = b.id_adherent
    LEFT JOIN recus_confirmation_paiement rcp ON rcp.id_remboursement = r.id
    ${scopeClause}
    ORDER BY b.id DESC
  `, scopeParams);
  return res.json(rows);
});

router.post('/:id/transmit-payment-receipt', async (req, res) => {
  const user = (req as any).user;
  if (user?.role !== 'basv') {
    return res.status(403).json({ message: 'Seul le BASV peut transmettre le reçu de confirmation généré.' });
  }

  const reimbursementId = Number(req.params.id);
  if (!Number.isInteger(reimbursementId) || reimbursementId <= 0) {
    return res.status(400).json({ message: 'Identifiant de remboursement invalide.' });
  }

  const senderId = Number(user.id);
  if (!Number.isInteger(senderId) || senderId <= 0) {
    return res.status(401).json({ message: 'Identité du BASV introuvable.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(`
      SELECT r.id, r.statut, rcp.id AS receipt_id
      FROM remboursements r
      LEFT JOIN recus_confirmation_paiement rcp ON rcp.id_remboursement = r.id
      WHERE r.id = ?
      FOR UPDATE
    `, [reimbursementId]) as [Array<{ id: number; statut: string; receipt_id: number | null }>, unknown];
    const reimbursement = rows[0];

    if (!reimbursement || reimbursement.statut !== 'paye') {
      await connection.rollback();
      return res.status(409).json({ message: 'L’agent doit d’abord confirmer le remboursement à la caisse.' });
    }
    if (!reimbursement.receipt_id) {
      await connection.rollback();
      return res.status(409).json({ message: 'Le reçu de paiement n’a pas été généré.' });
    }

    const senderName = String(user.name || user.email || 'BASV').slice(0, 255);
    await connection.execute(`
      UPDATE recus_confirmation_paiement
      SET envoye_par = ?, nom_envoyeur = ?, envoye_le = CURRENT_TIMESTAMP
      WHERE id_remboursement = ?
    `, [senderId, senderName, reimbursementId]);
    await connection.commit();
    return res.json({ message: 'Le reçu de confirmation généré a été transmis à l’agent.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

router.get('/:id/payment-receipt', async (req, res) => {
  const user = (req as any).user;
  if (user?.role !== 'agent') {
    return res.status(403).json({ message: 'Seul l’agent concerné peut télécharger ce reçu.' });
  }

  const reimbursementId = Number(req.params.id);
  const [rows] = await pool.execute(`
    SELECT rcp.contenu, rcp.nom_envoyeur, rcp.envoye_le
    FROM recus_confirmation_paiement rcp
    INNER JOIN remboursements r ON r.id = rcp.id_remboursement
    WHERE r.id = ? AND r.id_agent = ? AND r.statut = 'paye' AND rcp.envoye_le IS NOT NULL
    LIMIT 1
  `, [reimbursementId, Number(user.idAgent || -1)]) as [Array<{
    contenu: string;
    nom_envoyeur: string;
    envoye_le: string;
  }>, unknown];

  if (!rows.length) {
    return res.status(404).json({ message: 'Le reçu de confirmation n’a pas encore été transmis par le BASV.' });
  }

  try {
    return res.json({
      ...JSON.parse(rows[0].contenu),
      transmission: {
        basv: rows[0].nom_envoyeur,
        transmiseLe: rows[0].envoye_le,
      },
    });
  } catch (error) {
    console.error('Reçu de confirmation de paiement enregistré invalide:', error);
    return res.status(500).json({ message: 'Impossible de lire le reçu de confirmation.' });
  }
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const user = (req as any).user;
  const [rows] = await pool.execute(`
    SELECT r.id, r.id_bon, r.id_agent, r.id_adherent, r.montant, r.date_remboursement,
           r.statut, r.document_nom, r.document_mime, (r.document_basv IS NOT NULL) AS has_document
    FROM remboursements r
    INNER JOIN bons b ON b.id = r.id_bon
    WHERE r.id = ? AND b.statut IN ('valide', 'bon_disponible', 'paye')
      ${user?.role === 'agent' ? 'AND b.id_agent = ?' : ''}
  `, user?.role === 'agent' ? [Number(id), Number(user.idAgent || -1)] : [Number(id)]);
  const result = Array.isArray(rows) ? rows : [];

  if (!result.length) {
    return res.status(404).json({ message: 'Remboursement non trouvé' });
  }

  return res.json(result[0]);
});

router.post('/:id/confirm', async (req, res) => {
  const user = (req as any).user;
  if (user?.role !== 'agent') {
    return res.status(403).json({ message: 'Seul l’agent concerné peut confirmer le remboursement.' });
  }

  const confirmationId = Number(user.id);
  if (!Number.isInteger(confirmationId) || confirmationId <= 0) {
    return res.status(401).json({ message: 'Identité de l’agent introuvable.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(`
      SELECT r.id, r.id_bon, r.id_agent, r.id_adherent, r.montant, r.statut,
             b.numero_bon, b.date_bon,
             a.matricule AS agent_matricule,
             CONCAT(COALESCE(a.nom, ''), ' ', COALESCE(a.prenoms, '')) AS agent_nom,
             ad.num_adherent AS adherent_numero,
             CONCAT(COALESCE(ad.nom, ''), ' ', COALESCE(ad.prenoms, '')) AS adherent_nom
      FROM remboursements r
      INNER JOIN bons b ON b.id = r.id_bon
      INNER JOIN agents a ON a.id = r.id_agent
      LEFT JOIN adherents ad ON ad.id = r.id_adherent
      WHERE r.id = ?
      FOR UPDATE
    `, [Number(req.params.id)]) as [Array<{
      id: number;
      id_bon: number;
      id_agent: number;
      id_adherent: number;
      montant: number | string;
      statut: string;
      numero_bon: string;
      date_bon: string;
      agent_matricule: string | null;
      agent_nom: string;
      adherent_numero: string | null;
      adherent_nom: string | null;
    }>, unknown];
    const reimbursement = Array.isArray(rows) ? rows[0] as {
      id: number;
      id_bon: number;
      id_agent: number;
      id_adherent: number;
      montant: number | string;
      statut: string;
      numero_bon: string;
      date_bon: string;
      agent_matricule: string | null;
      agent_nom: string;
      adherent_numero: string | null;
      adherent_nom: string | null;
    } | undefined : undefined;

    if (!reimbursement || Number(reimbursement.id_agent) !== Number(user.idAgent || -1)) {
      await connection.rollback();
      return res.status(404).json({ message: 'Remboursement non trouvé.' });
    }
    if (!['a_rembourser', 'pret_a_rembourser', 'preuve_paiement_transmise'].includes(reimbursement.statut)) {
      await connection.rollback();
      return res.status(409).json({ message: 'Ce remboursement n’est pas en attente de confirmation par l’agent.' });
    }

    await connection.execute(
      "UPDATE remboursements SET statut = 'paye', date_remboursement = CURRENT_DATE() WHERE id = ? AND statut IN ('a_rembourser', 'pret_a_rembourser', 'preuve_paiement_transmise')",
      [reimbursement.id]
    );
    await connection.execute(
      "UPDATE bons SET statut = 'paye' WHERE id = ? AND statut IN ('bon_disponible', 'valide')",
      [reimbursement.id_bon]
    );

    const confirmedAt = new Date().toISOString();
    const receipt = {
      numero: `REC-PAIEMENT-${reimbursement.numero_bon}`,
      genereLe: confirmedAt,
      bon: {
        numero: reimbursement.numero_bon,
        date: reimbursement.date_bon,
      },
      paiement: {
        montant: reimbursement.montant,
        confirmeLe: confirmedAt,
        confirmePar: {
          matricule: reimbursement.agent_matricule,
          nom: reimbursement.agent_nom,
          email: user.email,
        },
      },
      adherent: {
        numero: reimbursement.adherent_numero,
        nom: reimbursement.adherent_nom,
      },
      statut: 'paye',
    };
    await connection.execute(
      'INSERT INTO recus_confirmation_paiement (id_remboursement, contenu) VALUES (?, ?)',
      [reimbursement.id, JSON.stringify(receipt)]
    );

    await connection.commit();
    return res.json({ message: 'Remboursement confirmé et reçu de paiement généré.', receipt });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
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
  const { idBon, idAgent, idAdherent, montant, dateRemboursement, statut } = req.body;
  if (statut === 'paye') {
    return res.status(409).json({ message: 'Le remboursement est marqué payé uniquement après confirmation par l’agent.' });
  }

  if (!idBon || !idAgent || !idAdherent || montant === undefined || montant === null || !dateRemboursement) {
    return res.status(400).json({ message: 'idBon, idAgent, idAdherent, montant et dateRemboursement sont requis' });
  }

  const sql = `
    INSERT INTO remboursements (id_bon, id_agent, id_adherent, montant, date_remboursement, statut)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  const [result] = await pool.execute(sql, [
    Number(idBon),
    Number(idAgent),
    Number(idAdherent),
    Number(montant),
    new Date(dateRemboursement).toISOString().slice(0, 10),
    statut || 'en_attente',
  ]);

  return res.status(201).json({ message: 'Remboursement créé', data: result });
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const payload = req.body;
  if (payload.statut !== undefined && (req as any).user?.role !== 'admin') {
    return res.status(403).json({ message: 'Le statut doit être changé uniquement par l’étape de remboursement prévue.' });
  }
  if (payload.statut === 'paye') {
    return res.status(409).json({ message: 'Le remboursement est marqué payé uniquement après confirmation par l’agent.' });
  }
  const fields: string[] = [];
  const values: any[] = [];

  if (payload.idBon) {
    fields.push('id_bon = ?');
    values.push(Number(payload.idBon));
  }
  if (payload.idAgent) {
    fields.push('id_agent = ?');
    values.push(Number(payload.idAgent));
  }
  if (payload.idAdherent) {
    fields.push('id_adherent = ?');
    values.push(Number(payload.idAdherent));
  }
  if (payload.montant !== undefined && payload.montant !== null) {
    fields.push('montant = ?');
    values.push(Number(payload.montant));
  }
  if (payload.dateRemboursement) {
    fields.push('date_remboursement = ?');
    values.push(new Date(payload.dateRemboursement).toISOString().slice(0, 10));
  }
  if (payload.statut) {
    fields.push('statut = ?');
    values.push(payload.statut);
  }

  if (!fields.length) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  values.push(Number(id));
  const sql = `UPDATE remboursements SET ${fields.join(', ')} WHERE id = ?`;
  await pool.execute(sql, values);

  return res.json({ message: 'Remboursement mis à jour' });
});

router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const payload = req.body;

  if (!payload || Object.keys(payload).length === 0) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }
  if (payload.statut !== undefined && (req as any).user?.role !== 'admin') {
    return res.status(403).json({ message: 'Le statut doit être changé uniquement par l’étape de remboursement prévue.' });
  }
  if (payload.statut === 'paye') {
    return res.status(409).json({ message: 'Le remboursement est marqué payé uniquement après confirmation par l’agent.' });
  }

  const fields: string[] = [];
  const values: any[] = [];

  if (payload.idBon !== undefined) { fields.push('id_bon = ?'); values.push(Number(payload.idBon)); }
  if (payload.idAgent !== undefined) { fields.push('id_agent = ?'); values.push(Number(payload.idAgent)); }
  if (payload.idAdherent !== undefined) { fields.push('id_adherent = ?'); values.push(Number(payload.idAdherent)); }
  if (payload.montant !== undefined) { fields.push('montant = ?'); values.push(Number(payload.montant)); }
  if (payload.dateRemboursement !== undefined) { fields.push('date_remboursement = ?'); values.push(new Date(payload.dateRemboursement).toISOString().slice(0, 10)); }
  if (payload.statut !== undefined) { fields.push('statut = ?'); values.push(payload.statut); }

  if (!fields.length) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  values.push(Number(id));
  await pool.execute(`UPDATE remboursements SET ${fields.join(', ')} WHERE id = ?`, values);
  return res.json({ message: 'Remboursement partiellement mis à jour' });
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  await pool.execute('DELETE FROM remboursements WHERE id = ?', [Number(id)]);
  return res.json({ message: 'Remboursement supprimé' });
});

export default router;
