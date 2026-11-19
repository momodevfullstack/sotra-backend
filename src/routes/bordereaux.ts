import { Request, Response, Router } from 'express';
import { pool } from '../db/index.js';
import { generateAutoCode } from '../lib/codeGenerator.js';

const router = Router();

router.get('/', async (req, res) => {
  const user = (req as any).user;
  const scopeClause = user?.role === 'agent' ? (user.idAgent ? 'WHERE b.id_agent = ? OR bon.id_agent = ?' : 'WHERE 1 = 0') : '';
  const scopeParams = user?.role === 'agent' && user.idAgent ? [Number(user.idAgent), Number(user.idAgent)] : [];
  const [rows] = await pool.execute(`
    SELECT b.*, bon.id AS bon_id, COUNT(DISTINCT bon.id) AS nombre_bons
    FROM bordereaux b
    LEFT JOIN bons bon ON bon.id_bordereau = b.id
    ${scopeClause}
    GROUP BY b.id
    ORDER BY b.id DESC
  `, scopeParams);
  return res.json(rows);
});

router.get('/:id', async (req, res) => {
  const user = (req as any).user;
  const scopeClause = user?.role === 'agent' ? (user.idAgent ? 'AND (b.id_agent = ? OR bon.id_agent = ?)' : 'AND 1 = 0') : '';
  const scopeParams = user?.role === 'agent' && user.idAgent ? [Number(user.idAgent), Number(user.idAgent)] : [];
  const [rows] = await pool.execute(`
    SELECT b.*, bon.id AS bon_id
    FROM bordereaux b
    LEFT JOIN bons bon ON bon.id_bordereau = b.id
    WHERE b.id = ? ${scopeClause}
  `, [Number(req.params.id), ...scopeParams]);
  const result = Array.isArray(rows) ? rows : [];

  if (!result.length) {
    return res.status(404).json({ message: 'Bordereau non trouvé' });
  }

  return res.json(result[0]);
});

router.get('/:id/medical-review', async (req, res) => {
  if ((req as any).user?.role !== 'medecin') {
    return res.status(403).json({ message: 'Réservé au médecin conseil.' });
  }

  const bordereauId = Number(req.params.id);
  const [bordereauRows] = await pool.execute('SELECT * FROM bordereaux WHERE id = ? AND statut = ?', [bordereauId, 'medecin_a_traiter']);
  if (!Array.isArray(bordereauRows) || !bordereauRows.length) {
    return res.status(404).json({ message: 'Bordereau non disponible pour examen médical.' });
  }

  const bordereau = bordereauRows[0] as { id_adherent?: number };
  const [actesRows] = await pool.execute(`
    SELECT ba.*, a.libelle AS acte_libelle, a.code_acte,
           CASE WHEN e.id IS NULL THEN 0 ELSE 1 END AS excluded
    FROM bons b
    INNER JOIN bon_actes ba ON ba.id_bon = b.id
    INNER JOIN actes a ON a.id = ba.id_acte
    LEFT JOIN exclusions e ON e.id_adherent = b.id_adherent AND e.id_acte = ba.id_acte AND e.statut = 'active'
    WHERE b.id_bordereau = ?
    ORDER BY ba.id DESC
  `, [bordereauId]);

  return res.json({ bordereau, actes: actesRows });
});

router.post('/:id/medical-review', async (req, res) => {
  if ((req as any).user?.role !== 'medecin') {
    return res.status(403).json({ message: 'Réservé au médecin conseil.' });
  }
  if (req.body?.confirmed !== true) {
    return res.status(400).json({ message: 'La confirmation médicale est requise.' });
  }

  const bordereauId = Number(req.params.id);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [bordereauRows] = await connection.execute(
      'SELECT id FROM bordereaux WHERE id = ? AND statut = ? FOR UPDATE',
      [bordereauId, 'medecin_a_traiter']
    );
    if (!Array.isArray(bordereauRows) || !bordereauRows.length) {
      await connection.rollback();
      return res.status(409).json({ message: 'Ce bordereau n’est plus en attente de revue médicale.' });
    }

    const [excludedRows] = await connection.execute(`
      SELECT ba.id
      FROM bons b
      INNER JOIN bon_actes ba ON ba.id_bon = b.id
      INNER JOIN exclusions e ON e.id_adherent = b.id_adherent AND e.id_acte = ba.id_acte AND e.statut = 'active'
      WHERE b.id_bordereau = ?
    `, [bordereauId]);
    const excludedIds = Array.isArray(excludedRows)
      ? excludedRows.map((row) => Number((row as { id: number }).id))
      : [];
    if (excludedIds.length) {
      const placeholders = excludedIds.map(() => '?').join(', ');
      await connection.execute(`DELETE FROM bon_actes WHERE id IN (${placeholders})`, excludedIds);
    }

    const [totals] = await connection.execute(`
      SELECT b.id, COALESCE(SUM(ba.montant), 0) AS montant_base
      FROM bons b
      LEFT JOIN bon_actes ba ON ba.id_bon = b.id
      WHERE b.id_bordereau = ?
      GROUP BY b.id
    `, [bordereauId]);
    const bonTotals = Array.isArray(totals)
      ? totals as Array<{ id: number; montant_base: number | string }>
      : [];
    const montantBase = bonTotals.reduce((sum, bon) => sum + Number(bon.montant_base), 0);

    for (const bon of bonTotals) {
      await connection.execute(
        "UPDATE bons SET montant = ?, montant_base = ?, statut = 'medecin_termine' WHERE id = ?",
        [Number(bon.montant_base), Number(bon.montant_base), Number(bon.id)]
      );
    }
    await connection.execute(
      "UPDATE bordereaux SET montant_total = ?, statut = 'medecin_termine' WHERE id = ?",
      [montantBase, bordereauId]
    );
    await connection.commit();
    return res.json({ message: 'Revue médicale terminée. Le dossier est retourné au BASV.', excludedCount: excludedIds.length });
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
  const { numeroBordereau, libelle, etablissement, idAgent, idAdherent, montantTotal, dateBordereau, statut } = req.body || {};
  const user = (req as any).user;
  if (user?.role !== 'admin') {
    return res.status(403).json({ message: 'Les bordereaux doivent être créés à partir des dossiers agent par le BASV.' });
  }
  const generatedNumero = numeroBordereau || await generateAutoCode('bordereaux', 'BORD');

  if (!dateBordereau) {
    return res.status(400).json({ message: 'dateBordereau est requis' });
  }

  const [result] = await pool.execute(`
    INSERT INTO bordereaux (numero_bordereau, libelle, etablissement, id_agent, id_adherent, montant_total, date_bordereau, statut)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    generatedNumero,
    libelle || null,
    etablissement || null,
    user?.role === 'agent' ? Number(user.idAgent) : (idAgent ? Number(idAgent) : null),
    idAdherent ? Number(idAdherent) : null,
    Number(montantTotal ?? 0),
    new Date(dateBordereau).toISOString().slice(0, 10),
    statut || 'en_attente',
  ]);

  return res.status(201).json({ message: 'Bordereau créé', data: result });
});

const updateBordereau = async (req: Request, res: Response) => {
  const payload = req.body || {};
  const user = (req as any).user;
  if (payload.statut !== undefined) {
    return res.status(400).json({ message: 'Le statut du bordereau doit suivre le circuit de validation.' });
  }
  if (user?.role === 'agent') {
    const [ownedRows] = await pool.execute(`
      SELECT b.id
      FROM bordereaux b
      LEFT JOIN bons bon ON bon.id_bordereau = b.id
      WHERE b.id = ? AND (b.id_agent = ? OR bon.id_agent = ?)
    `, [Number(req.params.id), Number(user.idAgent || -1), Number(user.idAgent || -1)]);
    if (!Array.isArray(ownedRows) || ownedRows.length === 0) {
      return res.status(403).json({ message: 'Ce bordereau ne vous appartient pas.' });
    }
  }
  const fields: string[] = [];
  const values: any[] = [];

  const editableFields: Array<[string, string, (value: unknown) => unknown]> = [
    ['numeroBordereau', 'numero_bordereau', (value) => value],
    ['libelle', 'libelle', (value) => value || null],
    ['etablissement', 'etablissement', (value) => value || null],
    ['idAgent', 'id_agent', (value) => value ? Number(value) : null],
    ['idAdherent', 'id_adherent', (value) => value ? Number(value) : null],
    ['montantTotal', 'montant_total', (value) => Number(value)],
    ['statut', 'statut', (value) => value],
  ];

  for (const [key, column, transform] of editableFields) {
    if (payload[key] !== undefined) {
      fields.push(`${column} = ?`);
      values.push(transform(payload[key]));
    }
  }

  if (payload.dateBordereau !== undefined) {
    fields.push('date_bordereau = ?');
    values.push(new Date(payload.dateBordereau).toISOString().slice(0, 10));
  }

  if (!fields.length) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  values.push(Number(req.params.id));
  await pool.execute(`UPDATE bordereaux SET ${fields.join(', ')} WHERE id = ?`, values);

  return res.json({ message: 'Bordereau mis à jour' });
};

router.patch('/:id', updateBordereau);
router.put('/:id', updateBordereau);

router.post('/:id/office-approve', async (req, res) => {
  const user = (req as any).user;
  if (!['admin', 'basv'].includes(user?.role)) {
    return res.status(403).json({ message: 'Seul le BASV peut valider le retour médical et générer le bon.' });
  }

  const bordereauId = Number(req.params.id);
  const validatorId = Number(user.id);
  if (!Number.isInteger(validatorId) || validatorId <= 0) {
    return res.status(401).json({ message: 'Identité du BASV introuvable.' });
  }
  const validatorName = String(user.name || user.email || 'BASV').slice(0, 255);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(`
      SELECT br.id AS bordereau_id, br.statut AS bordereau_statut,
             b.id AS bon_id, b.id_agent, b.statut AS bon_statut,
             a.id_college, c.libelle AS college_libelle, tc.taux_couverture
      FROM bordereaux br
      INNER JOIN bons b ON b.id_bordereau = br.id
      INNER JOIN agents a ON a.id = b.id_agent
      LEFT JOIN colleges c ON c.id = a.id_college
      LEFT JOIN taux_college tc ON tc.id_college = a.id_college
      WHERE br.id = ?
      FOR UPDATE
    `, [bordereauId]);
    const entries = Array.isArray(rows) ? rows as Array<{
      bordereau_id: number;
      bordereau_statut: string;
      bon_id: number;
      bon_statut: string;
      id_college: number | null;
      college_libelle: string | null;
      taux_couverture: number | string | null;
    }> : [];

    if (!entries.length || entries.some((entry) => entry.bordereau_statut !== 'medecin_termine' || entry.bon_statut !== 'medecin_termine')) {
      await connection.rollback();
      return res.status(409).json({ message: 'Le bordereau doit d’abord être examiné et retourné par le médecin.' });
    }
    if (entries.length !== 1) {
      await connection.rollback();
      return res.status(409).json({ message: 'Ce bordereau doit contenir un seul dossier agent pour générer le bon.' });
    }

    const entry = entries[0];
    if (!entry.id_college || entry.taux_couverture === null) {
      await connection.rollback();
      return res.status(409).json({ message: 'Le collège de l’agent ou son taux de couverture SOTRA n’est pas configuré.' });
    }

    const [totalRows] = await connection.execute(
      'SELECT COALESCE(SUM(montant), 0) AS total FROM bon_actes WHERE id_bon = ?',
      [entry.bon_id]
    );
    const total = Number((totalRows as Array<{ total: number | string }>)[0]?.total ?? 0);
    const coverageRate = Number(entry.taux_couverture);
    const bonAmount = Math.round(total * coverageRate) / 100;
    const numeroBon = await generateAutoCode('bons', 'BON');

    await connection.execute(`
      UPDATE bons
      SET numero_bon = ?, montant_base = ?, taux_couverture = ?, montant = ?, statut = 'dg_a_valider',
          basv_validated_by = ?, basv_validator_name = ?, basv_validated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND statut = 'medecin_termine'
    `, [numeroBon, total, coverageRate, bonAmount, validatorId, validatorName, entry.bon_id]);
    await connection.execute(
      "UPDATE bordereaux SET statut = 'valide', montant_total = ? WHERE id = ? AND statut = 'medecin_termine'",
      [total, bordereauId]
    );
    await connection.commit();
    return res.json({
      message: 'Bordereau validé et bon généré.',
      bon: { numero: numeroBon, montantBase: total, tauxCouverture: coverageRate, montant: bonAmount, college: entry.college_libelle },
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

router.delete('/:id', async (req, res) => {
  const bordereauId = Number(req.params.id);
  const user = (req as any).user;
  if (user?.role === 'agent') {
    const [ownedRows] = await pool.execute(`
      SELECT b.id
      FROM bordereaux b
      LEFT JOIN bons bon ON bon.id_bordereau = b.id
      WHERE b.id = ? AND (b.id_agent = ? OR bon.id_agent = ?)
    `, [bordereauId, Number(user.idAgent || -1), Number(user.idAgent || -1)]);
    if (!Array.isArray(ownedRows) || ownedRows.length === 0) {
      return res.status(403).json({ message: 'Ce bordereau ne vous appartient pas.' });
    }
  }
  const [bonRows] = await pool.execute('SELECT id FROM bons WHERE id_bordereau = ?', [bordereauId]);
  const bonIds = Array.isArray(bonRows) ? bonRows.map((row) => Number((row as { id: number }).id)).filter(Boolean) : [];

  if (bonIds.length) {
    const placeholders = bonIds.map(() => '?').join(', ');
    await pool.execute(`DELETE FROM bon_actes WHERE id_bon IN (${placeholders})`, bonIds);
    await pool.execute(`DELETE FROM bon_produits WHERE id_bon IN (${placeholders})`, bonIds);
    await pool.execute(`DELETE FROM remboursements WHERE id_bon IN (${placeholders})`, bonIds);
    await pool.execute(`DELETE FROM bons WHERE id IN (${placeholders})`, bonIds);
  }

  await pool.execute('DELETE FROM bordereaux WHERE id = ?', [bordereauId]);
  return res.json({ message: 'Bordereau supprimé' });
});

export default router;
