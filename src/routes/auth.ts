import { Router } from 'express';
import { authenticateUser, buildToken, decodeToken, rolePermissions } from '../lib/auth.js';
import { db } from '../db/index.js';
import { utilisateurs } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

const router = Router();

router.post('/login', async (req, res) => {
  const { identifier, email, password, role } = req.body || {};

  const user = await authenticateUser(String(identifier || email || ''), String(password || ''), role);

  if (!user) {
    return res.status(401).json({ message: 'Identifiants ou profil invalide.' });
  }

  const token = buildToken({ id: user.id, email: user.email, role: user.role, idAgent: user.idAgent });

  return res.json({
    message: 'Connexion réussie',
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      idAgent: user.idAgent,
      permissions: user.permissions,
    },
  });
});

router.get('/me', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = String(authHeader).startsWith('Bearer ') ? String(authHeader).replace('Bearer ', '') : undefined;
  const decoded = decodeToken(token);

  if (!decoded || !decoded.role) {
    return res.status(401).json({ message: 'Token invalide ou expiré.' });
  }

  const permissions = rolePermissions[decoded.role] ?? [];
  const user = { ...decoded, permissions };

  return res.json({ user });
});

router.get('/profile', async (req, res) => {
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ message: 'Session invalide.' });

  const rows = await db.select({
    id: utilisateurs.id,
    nom: utilisateurs.nom,
    prenoms: utilisateurs.prenoms,
    email: utilisateurs.email,
  }).from(utilisateurs).where(eq(utilisateurs.id, Number(userId)));

  if (!rows.length) return res.status(404).json({ message: 'Utilisateur non trouvé.' });
  return res.json(rows[0]);
});

router.patch('/profile', async (req, res) => {
  const userId = (req as any).user?.id;
  const { nom, prenoms, email, currentPassword, newPassword } = req.body || {};
  if (!userId || !nom || !email) {
    return res.status(400).json({ message: 'Le nom, les prénoms et l’e-mail sont requis.' });
  }

  const rows = await db.select().from(utilisateurs).where(eq(utilisateurs.id, Number(userId)));
  const currentUser = rows[0];
  if (!currentUser) return res.status(404).json({ message: 'Utilisateur non trouvé.' });

  const normalizedEmail = String(email).trim().toLowerCase();
  const updateData: any = { nom, prenoms: prenoms || '', email: normalizedEmail, updatedAt: new Date() };

  if (newPassword) {
    if (!currentPassword || !(await bcrypt.compare(String(currentPassword), currentUser.password))) {
      return res.status(400).json({ message: 'Ancien mot de passe incorrect.' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ message: 'Le nouveau mot de passe doit contenir au moins 8 caractères.' });
    }
    updateData.password = await bcrypt.hash(String(newPassword), 12);
  }

  try {
    await db.update(utilisateurs).set(updateData).where(eq(utilisateurs.id, Number(userId)));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Cette adresse e-mail est déjà utilisée.' });
    }
    throw error;
  }

  return res.json({ message: 'Profil mis à jour', name: `${nom} ${prenoms || ''}`.trim(), email: normalizedEmail });
});

export default router;
