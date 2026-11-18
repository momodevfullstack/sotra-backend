import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { pool } from './db/index.js';
import agentsRoutes from './routes/agents.js';
import adherentsRoutes from './routes/adherents.js';
import bonsRoutes from './routes/bons.js';
import bordereauxRoutes from './routes/bordereaux.js';
import bonActesRoutes from './routes/bonActes.js';
import dossiersRoutes from './routes/dossiers.js';
import produitsRoutes from './routes/produits.js';
import actesRoutes from './routes/actes.js';
import remboursementsRoutes from './routes/remboursements.js';
import drbRoutes from './routes/drb.js';
import collegesRoutes from './routes/colleges.js';
import corporationsRoutes from './routes/corporations.js';
import etablissementsRoutes from './routes/etablissements.js';
import typeEtablissementsRoutes from './routes/typeEtablissements.js';
import tauxRoutes from './routes/taux.js';
import exclusionsRoutes from './routes/exclusions.js';
import dashboardRoutes from './routes/dashboard.js';
import authRoutes from './routes/auth.js';
import profilsRoutes from './routes/profils.js';
import utilisateursRoutes from './routes/utilisateurs.js';
import { decodeToken, rolePermissions, userHasPermission } from './lib/auth.js';

interface AuthenticatedRequest extends express.Request {
  user?: {
    id?: number;
    idAgent?: number | null;
    email?: string;
    role?: string;
    permissions?: string[];
  };
}

const app = express();

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
}));
app.options('*', cors());
app.use(express.json({ limit: '12mb' }));

app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true, message: 'Backend SOTRA opérationnel' });
});

app.use((req: AuthenticatedRequest, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = String(authHeader).startsWith('Bearer ') ? String(authHeader).replace('Bearer ', '') : undefined;

  if (token) {
    const decodedUser = decodeToken(token);
    if (decodedUser) {
      req.user = {
        ...decodedUser,
        permissions: decodedUser.role ? rolePermissions[decodedUser.role] ?? [] : [],
      };
    }
  }

  const publicPaths = ['/api/health', '/api/auth'];
  const isPublic = publicPaths.some((prefix) => req.path.startsWith(prefix));

  if (!isPublic && req.path !== '/' && !req.headers.authorization) {
    return res.status(401).json({ message: 'Token d’authentification requis.' });
  }

  if (!isPublic && req.user) {
    const routePermissions: Record<string, Record<string, string>> = {
      '/api/agents': { GET: 'agents:read', POST: 'agents:write', PUT: 'agents:write', PATCH: 'agents:write', DELETE: 'agents:write' },
      '/api/adherents': { GET: 'adherents:read', POST: 'adherents:write', PUT: 'adherents:write', PATCH: 'adherents:write', DELETE: 'adherents:write' },
      '/api/bons': { GET: 'bons:read', POST: 'bons:write', PUT: 'bons:write', PATCH: 'bons:write', DELETE: 'bons:delete' },
      '/api/dossiers': { GET: 'dossiers:read', POST: 'dossiers:write', DELETE: 'dossiers:write' },
      '/api/actes': { GET: 'actes:read', POST: 'actes:write', PUT: 'actes:write', PATCH: 'actes:write', DELETE: 'actes:write' },
      '/api/bordereaux': { GET: 'bordereaux:read', POST: 'bordereaux:write', PUT: 'bordereaux:write', PATCH: 'bordereaux:write', DELETE: 'bordereaux:write' },
      '/api/bon-actes': { GET: 'bordereaux:read', POST: 'dossiers:write', PUT: 'dossiers:write', PATCH: 'dossiers:write', DELETE: 'dossiers:write' },
      '/api/remboursements': { GET: 'remboursements:read', POST: 'remboursements:write', PUT: 'remboursements:write', PATCH: 'remboursements:write', DELETE: 'remboursements:write' },
      '/api/exclusions': { GET: 'exclusions:read', POST: 'exclusions:write', PUT: 'exclusions:write', PATCH: 'exclusions:write', DELETE: 'exclusions:write' },
      '/api/dashboard': { GET: 'dashboard:view', POST: 'dashboard:view', PUT: 'dashboard:view', PATCH: 'dashboard:view', DELETE: 'dashboard:view' },
      '/api/profils': { GET: 'dashboard:view', POST: 'dashboard:view', PUT: 'dashboard:view', PATCH: 'dashboard:view', DELETE: 'dashboard:view' },
      '/api/utilisateurs': { GET: 'dashboard:view', POST: 'dashboard:view', PUT: 'dashboard:view', PATCH: 'dashboard:view', DELETE: 'dashboard:view' },
    };

    const routeKey = Object.keys(routePermissions).find((prefix) => req.path.startsWith(prefix));
    const requiredPermission = req.path.includes('/medical-review')
      ? 'medecin:review'
      : req.path.includes('/dg-approve')
        ? 'bons:approve'
        : req.path.includes('/confirm')
          ? 'remboursements:confirm'
          : routeKey ? routePermissions[routeKey][req.method] : null;

    if (requiredPermission && !userHasPermission(req.user, requiredPermission)) {
      return res.status(403).json({ message: 'Accès interdit pour ce profil.' });
    }
  }

  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/profils', profilsRoutes);
app.use('/api/utilisateurs', utilisateursRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/adherents', adherentsRoutes);
app.use('/api/bons', bonsRoutes);
app.use('/api/dossiers', dossiersRoutes);
app.use('/api/bordereaux', bordereauxRoutes);
app.use('/api/bon-actes', bonActesRoutes);
app.use('/api/produits', produitsRoutes);
app.use('/api/actes', actesRoutes);
app.use('/api/remboursements', remboursementsRoutes);
app.use('/api/drb', drbRoutes);
app.use('/api/colleges', collegesRoutes);
app.use('/api/corporations', corporationsRoutes);
app.use('/api/etablissements', etablissementsRoutes);
app.use('/api/type-etablissements', typeEtablissementsRoutes);
app.use('/api/taux', tauxRoutes);
app.use('/api/exclusions', exclusionsRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    return next(error);
  }

  console.error('Erreur serveur non gérée:', error);

  const code = error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : '';
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST'].includes(code)) {
    return res.status(503).json({ ok: false, message: 'La base de données est temporairement indisponible.' });
  }

  return res.status(500).json({ message: 'Une erreur interne est survenue.' });
});

async function ensureColumn(tableName: string, columnName: string, definition: string) {
  const [rows] = await pool.execute(
    `
      SELECT COUNT(*) AS total
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
    `,
    [tableName, columnName]
  ) as [Array<{ total?: number | string }>, unknown];

  const hasColumn = Array.isArray(rows) && rows.length > 0 && Number(rows[0]?.total ?? 0) > 0;

  if (!hasColumn) {
    await pool.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

async function ensureForeignKey(tableName: string, columnName: string, referencedTable: string, referencedColumn: string) {
  const [rows] = await pool.execute(
    `
      SELECT COUNT(*) AS total
      FROM information_schema.key_column_usage
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
        AND referenced_table_name = ?
    `,
    [tableName, columnName, referencedTable]
  ) as [Array<{ total?: number | string }>, unknown];

  const hasForeignKey = Array.isArray(rows) && rows.length > 0 && Number(rows[0]?.total ?? 0) > 0;

  if (!hasForeignKey) {
    await pool.execute(
      `ALTER TABLE ${tableName} ADD CONSTRAINT fk_${tableName}_${columnName} FOREIGN KEY (${columnName}) REFERENCES ${referencedTable}(${referencedColumn})`
    );
  }
}

async function ensureCodeColumn(tableName: string) {
  await ensureColumn(tableName, 'code', 'VARCHAR(50) NULL');
}

async function ensureBordereauxTable() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS bordereaux (
      id INT AUTO_INCREMENT PRIMARY KEY,
      numero_bordereau VARCHAR(50) NOT NULL UNIQUE,
      libelle VARCHAR(150) NULL,
      etablissement VARCHAR(150) NULL,
      id_agent INT NULL,
      id_adherent INT NULL,
      montant_total DECIMAL(12, 2) NOT NULL DEFAULT 0,
      date_bordereau DATE NOT NULL,
      statut VARCHAR(50) NOT NULL DEFAULT 'en_attente',
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

async function ensureCollegeWorkflowSchema() {
  await ensureColumn('agents', 'id_college', 'INT NULL AFTER id');
  await ensureForeignKey('agents', 'id_college', 'colleges', 'id');
  await ensureColumn('bons', 'montant_base', 'DECIMAL(12, 2) NULL AFTER montant');
  await ensureColumn('bons', 'taux_couverture', 'DECIMAL(5, 2) NULL AFTER montant_base');
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS taux_college (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_college INT NOT NULL UNIQUE,
      taux_couverture DECIMAL(5, 2) NOT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_taux_college_college FOREIGN KEY (id_college) REFERENCES colleges(id)
    )
  `);

  const colleges = [
    { code: 'COLLEGE_1', label: 'Collège 1 (Cadres)', rate: 50 },
    { code: 'COLLEGE_2', label: 'Collège 2 (Maîtrise)', rate: 70 },
    { code: 'COLLEGE_3', label: 'Collège 3 (Exécution)', rate: 90 },
  ];

  for (const college of colleges) {
    await pool.execute(
      'INSERT INTO colleges (libelle, code) SELECT ?, ? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM colleges WHERE code = ?)',
      [college.label, college.code, college.code]
    );
    await pool.execute(`
      UPDATE agents a
      INNER JOIN colleges c ON c.code = ?
      SET a.id_college = c.id
      WHERE a.id_college IS NULL AND a.poste = ?
    `, [college.code, college.label]);
    await pool.execute(`
      INSERT IGNORE INTO taux_college (id_college, taux_couverture)
      SELECT id, ? FROM colleges WHERE code = ?
    `, [college.rate, college.code]);
  }
}

async function ensureReimbursementDocumentSchema() {
  await ensureColumn('remboursements', 'document_basv', 'MEDIUMTEXT NULL');
  await ensureColumn('remboursements', 'document_nom', 'VARCHAR(255) NULL');
  await ensureColumn('remboursements', 'document_mime', 'VARCHAR(100) NULL');
}

async function ensureDatabaseSchema() {
  await ensureBordereauxTable();
  await ensureColumn('bons', 'id_bordereau', 'INT NULL AFTER numero_bon');
  await ensureForeignKey('bons', 'id_bordereau', 'bordereaux', 'id');
  await ensureColumn('utilisateurs', 'id_agent', 'INT NULL AFTER id_profil');
  await ensureForeignKey('utilisateurs', 'id_agent', 'agents', 'id');
  await ensureColumn('taux', 'id_drb', 'INT NULL AFTER id_type_etablissement');
  await ensureForeignKey('taux', 'id_drb', 'drb', 'id');
  await ensureColumn('exclusions', 'id_acte', 'INT NULL AFTER id_produit');
  await ensureForeignKey('exclusions', 'id_acte', 'actes', 'id');
    await pool.execute(`
      UPDATE bons b
      INNER JOIN bordereaux br ON br.id = b.id_bordereau
      SET b.id_bordereau = NULL
      WHERE b.statut = 'dossier_agent'
        AND br.numero_bordereau LIKE 'DOS-%'
        AND br.libelle = 'Bordereau migré'
    `);
    await pool.execute(`
      DELETE FROM bordereaux
      WHERE numero_bordereau LIKE 'DOS-%'
        AND libelle = 'Bordereau migré'
    `);
  await pool.execute(`
    INSERT INTO bordereaux (numero_bordereau, libelle, id_agent, id_adherent, montant_total, date_bordereau, statut)
    SELECT b.numero_bon, 'Bordereau migré', b.id_agent, b.id_adherent, b.montant, b.date_bon, b.statut
    FROM bons b
    LEFT JOIN bordereaux br ON br.numero_bordereau = b.numero_bon
      WHERE br.id IS NULL
          AND b.statut <> 'dossier_agent'
          AND b.numero_bon NOT LIKE 'DOS-%'
  `);
  await pool.execute(`
    UPDATE bons b
    INNER JOIN bordereaux br ON br.numero_bordereau = b.numero_bon
    SET b.id_bordereau = br.id
    WHERE b.id_bordereau IS NULL
  `);
  await ensureColumn('adherents', 'id_agent', 'INT NULL AFTER num_adherent');
  await ensureForeignKey('adherents', 'id_agent', 'agents', 'id');
  await Promise.all([
    ensureCodeColumn('type_etablissement'),
    ensureCodeColumn('colleges'),
    ensureCodeColumn('corporations'),
    ensureCodeColumn('drb'),
  ]);
  await ensureCollegeWorkflowSchema();
  await ensureReimbursementDocumentSchema();
}

ensureDatabaseSchema()
  .then(() => {
    app.listen(env.PORT, () => {
      console.log(`Serveur backend démarré sur http://localhost:${env.PORT}`);
    });
  })
  .catch((error) => {
    console.error('Erreur de vérification du schéma:', error);
    process.exitCode = 1;
  });
