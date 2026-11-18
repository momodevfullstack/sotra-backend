import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agents, profils, utilisateurs } from '../db/schema.js';
import { sendUserWelcomeEmail } from '../lib/mailer.js';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

const router = Router();

function isDuplicateEmailError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ER_DUP_ENTRY');
}

function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

router.get('/', async (_req, res) => {
  const rows = await db.select({
    id: utilisateurs.id,
    nom: utilisateurs.nom,
    prenoms: utilisateurs.prenoms,
    email: utilisateurs.email,
    matricule: agents.matricule,
    idProfil: utilisateurs.idProfil,
    idAgent: utilisateurs.idAgent,
    isActive: utilisateurs.isActive,
    lastLoginAt: utilisateurs.lastLoginAt,
    createdAt: utilisateurs.createdAt,
    updatedAt: utilisateurs.updatedAt,
  }).from(utilisateurs)
    .leftJoin(agents, eq(utilisateurs.idAgent, agents.id))
    .orderBy(utilisateurs.id);
  return res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const rows = await db.select({
    id: utilisateurs.id,
    nom: utilisateurs.nom,
    prenoms: utilisateurs.prenoms,
    email: utilisateurs.email,
    matricule: agents.matricule,
    idProfil: utilisateurs.idProfil,
    idAgent: utilisateurs.idAgent,
    isActive: utilisateurs.isActive,
    lastLoginAt: utilisateurs.lastLoginAt,
    createdAt: utilisateurs.createdAt,
    updatedAt: utilisateurs.updatedAt,
  }).from(utilisateurs)
    .leftJoin(agents, eq(utilisateurs.idAgent, agents.id))
    .where(eq(utilisateurs.id, Number(id)));

  if (!rows.length) {
    return res.status(404).json({ message: 'Utilisateur non trouvé' });
  }

  return res.json(rows[0]);
});

router.head('/', (_req, res) => {
  res.status(200).end();
});

router.options('/', (_req, res) => {
  res.header('Allow', 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD');
  res.status(204).end();
});

router.post('/', async (req, res) => {
  const { nom, prenoms, email, password, idProfil, idAgent, isActive } = req.body || {};

  if (!nom || !email || !idProfil) {
    return res.status(400).json({ message: 'nom, email et idProfil sont requis' });
  }

  const normalizedEmail = normalizeEmail(email);

  if (!isValidEmail(normalizedEmail)) {
    return res.status(400).json({ message: 'Veuillez renseigner une adresse e-mail valide.' });
  }

  const existingUsers = await db.select({ id: utilisateurs.id }).from(utilisateurs).where(eq(utilisateurs.email, normalizedEmail));

  if (existingUsers.length) {
    return res.status(409).json({ message: 'Cette adresse e-mail est déjà utilisée.' });
  }

  const temporaryPassword = password || randomBytes(6).toString('base64url');
  const passwordHash = await bcrypt.hash(temporaryPassword, 12);
  const [profileRows] = await db.select({ nom: profils.nom, role: profils.role }).from(profils).where(eq(profils.id, Number(idProfil)));

  if (!profileRows) {
    return res.status(400).json({ message: 'Le profil sélectionné est introuvable.' });
  }
  if (profileRows.role !== 'admin' && !idAgent) {
    return res.status(400).json({ message: 'Associez un agent à cet utilisateur pour lui permettre de se connecter avec son matricule.' });
  }

  try {
    const [created] = await db.insert(utilisateurs).values({
      nom,
      prenoms: prenoms || '',
      email: normalizedEmail,
      password: passwordHash,
      idProfil: Number(idProfil),
      idAgent: idAgent ? Number(idAgent) : null,
      isActive: isActive !== undefined ? Boolean(isActive) : true,
    });

    const emailSent = await sendUserWelcomeEmail({
      email: normalizedEmail,
      nom,
      prenoms,
      profil: profileRows?.nom || profileRows?.role || 'Utilisateur',
      temporaryPassword,
    });

    return res.status(201).json({
      message: emailSent ? 'Utilisateur créé et e-mail envoyé' : 'Utilisateur créé. SMTP non configuré, e-mail non envoyé',
      emailSent,
      data: created,
    });
  } catch (error) {
    if (isDuplicateEmailError(error)) {
      return res.status(409).json({ message: 'Cette adresse e-mail est déjà utilisée.' });
    }
    console.error('User creation failed:', error);
    return res.status(500).json({ message: 'Impossible de créer l’utilisateur.' });
  }
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const payload = req.body || {};

  try {
    const [currentUser] = await db.select({
      idProfil: utilisateurs.idProfil,
      idAgent: utilisateurs.idAgent,
    }).from(utilisateurs).where(eq(utilisateurs.id, Number(id)));
    if (!currentUser) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    const idProfil = payload.idProfil !== undefined ? Number(payload.idProfil) : currentUser.idProfil;
    const idAgent = payload.idAgent !== undefined ? payload.idAgent : currentUser.idAgent;
    const [profile] = await db.select({ role: profils.role }).from(profils).where(eq(profils.id, idProfil));
    if (!profile) {
      return res.status(400).json({ message: 'Le profil sélectionné est introuvable.' });
    }
    if (profile.role !== 'admin' && !idAgent) {
      return res.status(400).json({ message: 'Associez un agent à cet utilisateur pour lui permettre de se connecter avec son matricule.' });
    }

    const updatePayload = {
      ...payload,
      email: payload.email ? normalizeEmail(payload.email) : undefined,
      password: payload.password ? await bcrypt.hash(String(payload.password), 12) : undefined,
      idAgent: payload.idAgent !== undefined ? (payload.idAgent ? Number(payload.idAgent) : null) : undefined,
      updatedAt: new Date(),
    };
    await db.update(utilisateurs).set({
      ...updatePayload,
    }).where(eq(utilisateurs.id, Number(id)));
  } catch (error) {
    if (isDuplicateEmailError(error)) {
      return res.status(409).json({ message: 'Cette adresse e-mail est déjà utilisée.' });
    }
    throw error;
  }

  return res.json({ message: 'Utilisateur mis à jour' });
});

router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const payload = req.body || {};

  if (!payload || Object.keys(payload).length === 0) {
    return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
  }

  try {
    const [currentUser] = await db.select({
      idProfil: utilisateurs.idProfil,
      idAgent: utilisateurs.idAgent,
    }).from(utilisateurs).where(eq(utilisateurs.id, Number(id)));
    if (!currentUser) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    const idProfil = payload.idProfil !== undefined ? Number(payload.idProfil) : currentUser.idProfil;
    const idAgent = payload.idAgent !== undefined ? payload.idAgent : currentUser.idAgent;
    const [profile] = await db.select({ role: profils.role }).from(profils).where(eq(profils.id, idProfil));
    if (!profile) {
      return res.status(400).json({ message: 'Le profil sélectionné est introuvable.' });
    }
    if (profile.role !== 'admin' && !idAgent) {
      return res.status(400).json({ message: 'Associez un agent à cet utilisateur pour lui permettre de se connecter avec son matricule.' });
    }

    const updatePayload = {
      ...payload,
      email: payload.email ? normalizeEmail(payload.email) : undefined,
      password: payload.password ? await bcrypt.hash(String(payload.password), 12) : undefined,
      idAgent: payload.idAgent !== undefined ? (payload.idAgent ? Number(payload.idAgent) : null) : undefined,
      updatedAt: new Date(),
    };
    await db.update(utilisateurs).set({
      ...updatePayload,
    }).where(eq(utilisateurs.id, Number(id)));
  } catch (error) {
    if (isDuplicateEmailError(error)) {
      return res.status(409).json({ message: 'Cette adresse e-mail est déjà utilisée.' });
    }
    throw error;
  }

  return res.json({ message: 'Utilisateur partiellement mis à jour' });
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  await db.delete(utilisateurs).where(eq(utilisateurs.id, Number(id)));
  return res.json({ message: 'Utilisateur supprimé' });
});

export default router;
