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
      COALESCE(r.statut, 'en_attente_justificatif') AS statut,
      r.document_nom,
      r.document_mime,
      (r.document_basv IS NOT NULL) AS has_document
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
    ${scopeClause}
    ORDER BY b.id DESC
  `, scopeParams);
  return res.json(rows);
});

router.post('/bons/:bonId/document', async (req, res) => {
  const user = (req as any).user;
  if (!['admin', 'basv'].includes(user?.role)) {
    return res.status(403).json({ message: 'Seul le BASV peut transmettre le justificatif de remboursement.' });
  }

  const bonId = Number(req.params.bonId);
  const { fileName, mimeType, data } = req.body || {};
  const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);
  if (!Number.isInteger(bonId) || bonId <= 0 || typeof fileName !== 'string' || typeof data !== 'string' || !allowedTypes.has(mimeType)) {
    return res.status(400).json({ message: 'Fournissez un bon valide et un justificatif PDF, JPEG ou PNG.' });
  }
  const extension = fileName.toLowerCase().split('.').pop();
  const validExtensions: Record<string, string[]> = {
    'application/pdf': ['pdf'],
    'image/jpeg': ['jpg', 'jpeg'],
    'image/png': ['png'],
  };
  if (!validExtensions[mimeType].includes(extension || '')) {
    return res.status(400).json({ message: 'L’extension du fichier ne correspond pas à son format.' });
  }

  const base64 = data.replace(/^data:[^,]+;base64,/, '');
  if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    return res.status(400).json({ message: 'Le fichier transmis est invalide.' });
  }
  const document = Buffer.from(base64, 'base64');
  if (document.length === 0 || document.length > 8 * 1024 * 1024 || document.toString('base64') !== base64) {
    return res.status(400).json({ message: 'Le justificatif doit peser au maximum 8 Mo.' });
  }

  const isValidFile = mimeType === 'application/pdf'
    ? document.subarray(0, 5).toString('ascii') === '%PDF-'
    : mimeType === 'image/png'
      ? document.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : document.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (!isValidFile) {
    return res.status(400).json({ message: 'Le contenu du fichier ne correspond pas à son format.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [bonRows] = await connection.execute(
      "SELECT id, id_agent, id_adherent, montant, statut FROM bons WHERE id = ? FOR UPDATE",
      [bonId]
    );
    const bon = Array.isArray(bonRows) ? bonRows[0] as {
      id: number;
      id_agent: number;
      id_adherent: number;
      montant: number | string;
      statut: string;
    } | undefined : undefined;

    if (!bon || !['bon_disponible', 'valide'].includes(bon.statut)) {
      await connection.rollback();
      return res.status(409).json({ message: 'Le bon doit être disponible et non encore remboursé avant le dépôt du justificatif.' });
    }

    const [remboursementRows] = await connection.execute(
      'SELECT id FROM remboursements WHERE id_bon = ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
      [bonId]
    );
    const remboursementId = Array.isArray(remboursementRows)
      ? (remboursementRows[0] as { id?: number } | undefined)?.id
      : undefined;

    if (remboursementId) {
      await connection.execute(`
        UPDATE remboursements
        SET document_basv = ?, document_nom = ?, document_mime = ?, statut = 'pret_a_rembourser',
            montant = ?, date_remboursement = CURRENT_DATE()
        WHERE id = ?
      `, [document.toString('base64'), fileName.slice(0, 255), mimeType, Number(bon.montant), remboursementId]);
    } else {
      await connection.execute(`
        INSERT INTO remboursements
          (id_bon, id_agent, id_adherent, montant, date_remboursement, statut, document_basv, document_nom, document_mime)
        VALUES (?, ?, ?, ?, CURRENT_DATE(), 'pret_a_rembourser', ?, ?, ?)
      `, [bon.id, bon.id_agent, bon.id_adherent, Number(bon.montant), document.toString('base64'), fileName.slice(0, 255), mimeType]);
    }

    await connection.commit();
    return res.json({ message: 'Justificatif transmis à l’agent pour le remboursement.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

router.get('/bons/:bonId/document', async (req, res) => {
  const user = (req as any).user;
  const bonId = Number(req.params.bonId);
  const isAgent = user?.role === 'agent';
  const [rows] = await pool.execute(`
    SELECT r.document_basv, r.document_nom, r.document_mime
    FROM remboursements r
    INNER JOIN bons b ON b.id = r.id_bon
    WHERE b.id = ? AND b.statut IN ('valide', 'bon_disponible', 'paye')
      AND r.document_basv IS NOT NULL
      ${isAgent ? 'AND b.id_agent = ?' : ''}
    ORDER BY r.id DESC
    LIMIT 1
  `, isAgent ? [bonId, Number(user.idAgent || -1)] : [bonId]) as [Array<{
    document_basv: string;
    document_nom: string;
    document_mime: string;
  }>, unknown];

  const document = rows[0];
  if (!document) {
    return res.status(404).json({ message: 'Justificatif non trouvé.' });
  }

  const safeName = String(document.document_nom || 'justificatif').replace(/[\r\n"\\/]/g, '_');
  res.setHeader('Content-Type', document.document_mime);
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.send(Buffer.from(document.document_basv, 'base64'));
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

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(`
      SELECT r.id, r.id_bon, r.statut, (r.document_basv IS NOT NULL) AS has_document, b.id_agent
      FROM remboursements r
      INNER JOIN bons b ON b.id = r.id_bon
      WHERE r.id = ?
      FOR UPDATE
    `, [Number(req.params.id)]);
    const reimbursement = Array.isArray(rows) ? rows[0] as {
      id: number;
      id_bon: number;
      statut: string;
      has_document: boolean | number;
      id_agent: number;
    } | undefined : undefined;

    if (!reimbursement || Number(reimbursement.id_agent) !== Number(user.idAgent || -1)) {
      await connection.rollback();
      return res.status(404).json({ message: 'Remboursement non trouvé.' });
    }
    if (!reimbursement.has_document) {
      await connection.rollback();
      return res.status(409).json({ message: 'Le BASV doit d’abord transmettre le justificatif de remboursement.' });
    }
    if (reimbursement.statut !== 'pret_a_rembourser') {
      await connection.rollback();
      return res.status(409).json({ message: 'Ce remboursement n’est pas en attente de confirmation.' });
    }

    await connection.execute(
      "UPDATE remboursements SET statut = 'paye', date_remboursement = CURRENT_DATE() WHERE id = ? AND statut = 'pret_a_rembourser'",
      [reimbursement.id]
    );
    await connection.execute(
      "UPDATE bons SET statut = 'paye' WHERE id = ? AND statut IN ('bon_disponible', 'valide')",
      [reimbursement.id_bon]
    );
    await connection.commit();
    return res.json({ message: 'Remboursement confirmé.' });
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
  if (statut === 'paye' && (req as any).user?.role !== 'admin') {
    return res.status(403).json({ message: 'Seule la confirmation de l’agent concerné peut enregistrer le remboursement effectué.' });
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
  if (payload.statut === 'paye' && (req as any).user?.role !== 'admin') {
    return res.status(403).json({ message: 'Seule la confirmation de l’agent concerné peut enregistrer le remboursement effectué.' });
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
  if (payload.statut === 'paye' && (req as any).user?.role !== 'admin') {
    return res.status(403).json({ message: 'Seule la confirmation de l’agent concerné peut enregistrer le remboursement effectué.' });
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
