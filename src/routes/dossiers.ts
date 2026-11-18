import { Router } from 'express';
import { pool } from '../db/index.js';
import { generateAutoCode } from '../lib/codeGenerator.js';

const router = Router();

router.get('/', async (req, res) => {
  const user = (req as any).user;
  const isAgent = user?.role === 'agent';
  const where = isAgent ? 'WHERE b.id_agent = ?' : 'WHERE b.statut = ?';
  const params = isAgent ? [Number(user.idAgent || -1)] : ['dossier_agent'];
  const [rows] = await pool.execute(`
    SELECT b.*, a.matricule, ad.num_adherent,
           CONCAT(ad.nom, ' ', ad.prenoms) AS adherent_nom
    FROM bons b
    LEFT JOIN agents a ON a.id = b.id_agent
    LEFT JOIN adherents ad ON ad.id = b.id_adherent
    ${where}
    ORDER BY b.id DESC
  `, params);
  return res.json(rows);
});

router.post('/', async (req, res) => {
  const user = (req as any).user;
  if (user?.role !== 'agent' || !user.idAgent) {
    return res.status(403).json({ message: 'Seul un agent associé peut créer un dossier.' });
  }

  const { idAdherent, dateDossier } = req.body || {};
  if (!idAdherent || !dateDossier) {
    return res.status(400).json({ message: 'L’adhérent et la date du dossier sont requis.' });
  }

  const [adherentRows] = await pool.execute(
    'SELECT id FROM adherents WHERE id = ? AND id_agent = ?',
    [Number(idAdherent), Number(user.idAgent)]
  );
  if (!Array.isArray(adherentRows) || adherentRows.length === 0) {
    return res.status(403).json({ message: 'Cet adhérent ne vous appartient pas.' });
  }

  const numeroDossier = await generateAutoCode('bons', 'DOS');
  const [result] = await pool.execute(`
    INSERT INTO bons (numero_bon, id_agent, id_adherent, montant, date_bon, statut)
    VALUES (?, ?, ?, 0, ?, 'dossier_agent')
  `, [numeroDossier, Number(user.idAgent), Number(idAdherent), new Date(dateDossier).toISOString().slice(0, 10)]);

  return res.status(201).json({ message: 'Dossier créé et prêt à être complété.', data: result });
});

router.post('/:id/bordereau', async (req, res) => {
  const user = (req as any).user;
  if (!['admin', 'basv'].includes(user?.role)) {
    return res.status(403).json({ message: 'Seul le BASV peut monter le bordereau du dossier.' });
  }

  const dossierId = Number(req.params.id);
  const [dossierRows] = await pool.execute(`
    SELECT id, id_agent, id_adherent, date_bon, statut
    FROM bons
    WHERE id = ? AND statut = 'dossier_agent'
  `, [dossierId]);
  const dossier = Array.isArray(dossierRows) ? dossierRows[0] as { id: number; id_agent: number; id_adherent: number; date_bon: string; statut: string } | undefined : undefined;

  if (!dossier) {
    return res.status(404).json({ message: 'Dossier agent non trouvé ou déjà transformé.' });
  }

  const [totalRows] = await pool.execute('SELECT COALESCE(SUM(montant), 0) AS total FROM bon_actes WHERE id_bon = ?', [dossierId]);
  const total = Number((Array.isArray(totalRows) ? totalRows[0] as { total?: number | string } : { total: 0 }).total ?? 0);
  const numeroBordereau = await generateAutoCode('bordereaux', 'BORD');
  const [bordereauResult] = await pool.execute(`
    INSERT INTO bordereaux (numero_bordereau, libelle, id_agent, id_adherent, montant_total, date_bordereau, statut)
    VALUES (?, ?, ?, ?, ?, ?, 'medecin_a_traiter')
  `, [numeroBordereau, `Bordereau du dossier ${dossierId}`, dossier.id_agent, dossier.id_adherent, total, new Date().toISOString().slice(0, 10)]);
  const bordereauId = Number((bordereauResult as { insertId?: number }).insertId);

  await pool.execute(
    'UPDATE bons SET id_bordereau = ?, montant = ?, statut = ? WHERE id = ?',
    [bordereauId, total, 'medecin_a_traiter', dossierId]
  );

  return res.status(201).json({ message: 'Bordereau transmis au médecin conseil.', data: { id: bordereauId, numeroBordereau, montantTotal: total } });
});

router.delete('/:id', async (req, res) => {
  const user = (req as any).user;
  if (user?.role !== 'agent' || !user.idAgent) {
    return res.status(403).json({ message: 'Seul l’agent propriétaire peut supprimer ce dossier.' });
  }

  const dossierId = Number(req.params.id);
  const [dossierRows] = await pool.execute(
    `SELECT id FROM bons WHERE id = ? AND id_agent = ? AND statut = 'dossier_agent'`,
    [dossierId, Number(user.idAgent)]
  );

  if (!Array.isArray(dossierRows) || dossierRows.length === 0) {
    return res.status(403).json({ message: 'Ce dossier est introuvable, ne vous appartient pas ou a déjà été transmis.' });
  }

  await pool.execute('DELETE FROM bon_actes WHERE id_bon = ?', [dossierId]);
  await pool.execute('DELETE FROM bon_produits WHERE id_bon = ?', [dossierId]);
  await pool.execute('DELETE FROM bons WHERE id = ?', [dossierId]);

  return res.json({ message: 'Dossier supprimé' });
});

export default router;