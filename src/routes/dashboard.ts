import { Router } from 'express';
import { pool } from '../db/index.js';

const router = Router();

const monthLabels = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
const monthMap: Record<string, string> = {
  Jan: 'Jan',
  Feb: 'Fév',
  Mar: 'Mar',
  Apr: 'Avr',
  May: 'Mai',
  Jun: 'Juin',
  Jul: 'Juil',
  Aug: 'Aoû',
  Sep: 'Sep',
  Oct: 'Oct',
  Nov: 'Nov',
  Dec: 'Déc',
};

router.get('/summary', async (req, res) => {
  try {
    const user = (req as any).user;
    const isAgent = user?.role === 'agent';
    const queries = [
      pool.execute(isAgent ? 'SELECT COUNT(*) AS total FROM agents WHERE id = ?' : 'SELECT COUNT(*) AS total FROM agents', isAgent && user.idAgent ? [Number(user.idAgent)] : isAgent ? [-1] : []),
      pool.execute(isAgent ? 'SELECT COUNT(*) AS total FROM adherents WHERE id_agent = ?' : 'SELECT COUNT(*) AS total FROM adherents', isAgent && user.idAgent ? [Number(user.idAgent)] : isAgent ? [-1] : []),
      pool.execute(isAgent ? 'SELECT COUNT(*) AS total FROM bons WHERE id_agent = ?' : 'SELECT COUNT(*) AS total FROM bons', isAgent && user.idAgent ? [Number(user.idAgent)] : isAgent ? [-1] : []),
      pool.execute(isAgent ? 'SELECT COUNT(*) AS total FROM bordereaux WHERE id_agent = ?' : 'SELECT COUNT(*) AS total FROM bordereaux', isAgent && user.idAgent ? [Number(user.idAgent)] : isAgent ? [-1] : []),
      pool.execute(isAgent ? 'SELECT COUNT(*) AS total FROM remboursements r INNER JOIN bons b ON b.id = r.id_bon WHERE b.id_agent = ?' : 'SELECT COUNT(*) AS total FROM remboursements', isAgent && user.idAgent ? [Number(user.idAgent)] : isAgent ? [-1] : []),
      pool.execute(isAgent ? "SELECT COUNT(*) AS total FROM remboursements r INNER JOIN bons b ON b.id = r.id_bon WHERE b.id_agent = ? AND LOWER(r.statut) IN ('en_attente', 'attente')" : "SELECT COUNT(*) AS total FROM remboursements WHERE LOWER(statut) IN ('en_attente', 'attente')", isAgent && user.idAgent ? [Number(user.idAgent)] : isAgent ? [-1] : []),
      pool.execute(isAgent ? "SELECT COUNT(*) AS total FROM remboursements r INNER JOIN bons b ON b.id = r.id_bon WHERE b.id_agent = ? AND LOWER(r.statut) IN ('valide', 'validé')" : "SELECT COUNT(*) AS total FROM remboursements WHERE LOWER(statut) IN ('valide', 'validé')", isAgent && user.idAgent ? [Number(user.idAgent)] : isAgent ? [-1] : []),
      pool.execute(isAgent ? "SELECT COUNT(*) AS total FROM remboursements r INNER JOIN bons b ON b.id = r.id_bon WHERE b.id_agent = ? AND LOWER(r.statut) IN ('rejete', 'rejeté')" : "SELECT COUNT(*) AS total FROM remboursements WHERE LOWER(statut) IN ('rejete', 'rejeté')", isAgent && user.idAgent ? [Number(user.idAgent)] : isAgent ? [-1] : []),
      pool.execute("SELECT COUNT(*) AS total FROM bordereaux WHERE LOWER(statut) IN ('valide', 'validé')"),
      pool.execute(`SELECT COUNT(DISTINCT ba.id) AS total FROM bon_actes ba INNER JOIN bons b ON b.id = ba.id_bon INNER JOIN exclusions e ON e.id_adherent = b.id_adherent AND e.id_acte = ba.id_acte AND e.statut = 'active'`),
      pool.execute("SELECT COUNT(*) AS total FROM bons WHERE LOWER(statut) IN ('valide', 'bon_disponible', 'paye')"),
      pool.execute("SELECT COUNT(*) AS total FROM bordereaux WHERE LOWER(statut) IN ('rejete', 'rejeté')"),
    ];

    const [agentsResult, adherentsResult, bonsResult, bordereauxResult, remboursementsResult, pendingResult, validatedResult, rejectedResult, medicalPendingResult, excludedActsResult, establishedBonsResult, medicalRejectedResult] = await Promise.all(queries);

    const asTotal = (value: unknown): number => {
      const row = Array.isArray(value) ? value[0] : null;
      const total = row && typeof row === 'object' && 'total' in row ? Number((row as { total?: number | string }).total ?? 0) : 0;
      return Number.isFinite(total) ? total : 0;
    };

    const agents = asTotal(agentsResult[0]);
    const adherents = asTotal(adherentsResult[0]);
    const bons = asTotal(bonsResult[0]);
    const bordereaux = asTotal(bordereauxResult[0]);
    const remboursements = asTotal(remboursementsResult[0]);

    return res.json({
      agents,
      adherents,
      bons,
      bordereaux,
      remboursements,
      remboursementsEnAttente: asTotal(pendingResult[0]),
      remboursementsValides: asTotal(validatedResult[0]),
      remboursementsRejetes: asTotal(rejectedResult[0]),
      bordereauxAAnalyser: asTotal(medicalPendingResult[0]),
      actesExclus: asTotal(excludedActsResult[0]),
      bonsEtablis: asTotal(establishedBonsResult[0]),
      rejetsMedicaux: asTotal(medicalRejectedResult[0]),
    });
  } catch (error) {
    console.error('Dashboard summary failed:', error);
    return res.status(500).json({ message: 'Impossible de charger le résumé du tableau de bord.' });
  }
});

router.get('/activity', async (req, res) => {
  try {
    const user = (req as any).user;
    const isAgent = user?.role === 'agent';
    const [bonsRows] = await pool.execute(`
      SELECT MONTH(date_bon) AS month_number,
             COUNT(*) AS total
      FROM bons
      WHERE date_bon IS NOT NULL
      ${isAgent ? 'AND id_agent = ?' : ''}
      GROUP BY YEAR(date_bon), MONTH(date_bon)
      ORDER BY YEAR(date_bon), MONTH(date_bon)
      LIMIT 12
    `, isAgent && user.idAgent ? [Number(user.idAgent)] : isAgent ? [-1] : []) as [Array<{ month_number: number; total: number }>, any];

    const [remboursementsRows] = await pool.execute(`
      SELECT MONTH(date_remboursement) AS month_number,
             COUNT(*) AS total
      FROM remboursements
      WHERE date_remboursement IS NOT NULL
      ${isAgent ? 'AND id_bon IN (SELECT id FROM bons WHERE id_agent = ?)' : ''}
      GROUP BY YEAR(date_remboursement), MONTH(date_remboursement)
      ORDER BY YEAR(date_remboursement), MONTH(date_remboursement)
      LIMIT 12
    `, isAgent && user.idAgent ? [Number(user.idAgent)] : isAgent ? [-1] : []) as [Array<{ month_number: number; total: number }>, any];

    const bonsMap = new Map<string, number>();
    for (const row of bonsRows) {
      const label = monthLabels[(Number(row.month_number) - 1 + 12) % 12];
      bonsMap.set(label, Number(row.total ?? 0));
    }

    const remboursementsMap = new Map<string, number>();
    for (const row of remboursementsRows) {
      const label = monthLabels[(Number(row.month_number) - 1 + 12) % 12];
      remboursementsMap.set(label, Number(row.total ?? 0));
    }

    const activity = monthLabels.map((label) => ({
      name: label,
      bons: bonsMap.get(label) ?? 0,
      remboursements: remboursementsMap.get(label) ?? 0,
    }));

    return res.json(activity);
  } catch (error) {
    console.error('Dashboard activity failed:', error);
    return res.status(500).json({ message: 'Impossible de charger l’activité mensuelle.' });
  }
});

router.get('/recent-bons', async (req, res) => {
  try {
    const user = (req as any).user;
    const isAgent = user?.role === 'agent';
    const [rows] = await pool.execute(`
      SELECT b.id,
             b.numero_bon AS numeroBon,
             b.date_bon AS dateBon,
             b.montant AS montant,
             b.statut,
             a.nom AS agentNom,
             a.prenoms AS agentPrenoms,
             ad.nom AS adherentNom,
             ad.prenoms AS adherentPrenoms
      FROM bons b
      LEFT JOIN agents a ON a.id = b.id_agent
      LEFT JOIN adherents ad ON ad.id = b.id_adherent
      ${isAgent ? "WHERE b.id_agent = ? AND b.statut IN ('valide', 'bon_disponible', 'paye')" : ''}
      ORDER BY b.id DESC
      LIMIT 5
    `, isAgent && user.idAgent ? [Number(user.idAgent)] : isAgent ? [-1] : []) as [Array<any>, any];

    const recentBons = (rows || []).map((row) => ({
      id: Number(row.id),
      numeroBon: row.numeroBon,
      dateBon: row.dateBon,
      montant: Number(row.montant ?? 0),
      statut: row.statut,
      agent: row.agentNom && row.agentPrenoms ? `${row.agentNom} ${row.agentPrenoms}`.trim() : 'Agent inconnu',
      adherent: row.adherentNom && row.adherentPrenoms ? `${row.adherentNom} ${row.adherentPrenoms}`.trim() : 'Adhérent inconnu',
    }));

    return res.json(recentBons);
  } catch (error) {
    console.error('Recent bons failed:', error);
    return res.status(500).json({ message: 'Impossible de charger les bons récents.' });
  }
});

router.get('/notifications', async (req, res) => {
  try {
    const user = (req as any).user;
    const isAgent = user?.role === 'agent';
    const bonsScope = isAgent ? "WHERE id_agent = ? AND statut IN ('valide', 'bon_disponible', 'paye')" : '';
    const bordereauxScope = isAgent ? 'WHERE id_agent = ?' : '';
    const scopeParams = isAgent && user.idAgent ? [Number(user.idAgent)] : isAgent ? [-1] : [];
    const [bonsRows] = await pool.execute(`
      SELECT id, numero_bon AS numero, created_at AS createdAt
      FROM bons
      ${bonsScope}
      ORDER BY created_at DESC, id DESC
      LIMIT 10
    `, scopeParams) as [Array<{ id: number; numero: string; createdAt: string }>, any];

    const [bordereauxRows] = await pool.execute(`
      SELECT id, numero_bordereau AS numero, created_at AS createdAt
      FROM bordereaux
      ${bordereauxScope}
      ORDER BY created_at DESC, id DESC
      LIMIT 10
    `, scopeParams) as [Array<{ id: number; numero: string; createdAt: string }>, any];

    return res.json({
      bons: (bonsRows || []).map((row) => ({
        id: `bon-${row.id}`,
        type: 'bon',
        label: row.numero,
        createdAt: row.createdAt,
      })),
      bordereaux: (bordereauxRows || []).map((row) => ({
        id: `bordereau-${row.id}`,
        type: 'bordereau',
        label: row.numero,
        createdAt: row.createdAt,
      })),
    });
  } catch (error) {
    console.error('Dashboard notifications failed:', error);
    return res.status(500).json({ message: 'Impossible de charger les notifications.' });
  }
});

export default router;
