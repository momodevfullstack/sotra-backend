import { pool } from '../db/index.js';
import bcrypt from 'bcryptjs';

export type Role = 'admin' | 'agent' | 'basv' | 'dg' | 'medecin';

export const rolePermissions: Record<Role, string[]> = {
  admin: ['dashboard:view', 'agents:read', 'agents:write', 'adherents:read', 'adherents:write', 'bons:read', 'bons:write', 'bons:delete', 'bordereaux:read', 'bordereaux:write', 'dossiers:read', 'dossiers:write', 'actes:read', 'actes:write', 'remboursements:read', 'remboursements:write', 'exclusions:read', 'exclusions:write'],
  agent: ['dashboard:view', 'agents:read', 'adherents:read', 'adherents:write', 'bons:read', 'bordereaux:read', 'dossiers:read', 'dossiers:write', 'actes:read', 'actes:write', 'remboursements:read', 'remboursements:confirm'],
  basv: ['dashboard:view', 'adherents:read', 'adherents:write', 'bons:read', 'bordereaux:read', 'bordereaux:write', 'dossiers:read', 'dossiers:write', 'actes:read', 'remboursements:read', 'remboursements:write', 'exclusions:read', 'exclusions:write'],
  dg: ['dashboard:view', 'bons:read', 'bons:approve', 'bordereaux:read', 'bordereaux:write', 'remboursements:read'],
  medecin: ['dashboard:view', 'adherents:read', 'actes:read', 'bons:read', 'bons:write', 'bordereaux:read', 'medecin:review', 'exclusions:read', 'exclusions:write'],
};

const normalizePermissions = (value: string | null | undefined): string[] => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item)).filter(Boolean);
    }
  } catch {
    // ignore JSON parsing failure and fall back to comma-separated parsing
  }

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

export async function authenticateUser(identifier: string, password: string, role?: Role) {
  const normalizedIdentifier = String(identifier || '').trim();
  const normalizedPassword = String(password || '');

  if (!normalizedIdentifier || !normalizedPassword) {
    return null;
  }

  const roleFilter = role ? 'AND p.role = ?' : '';
  const parameters = [
    normalizedIdentifier.toUpperCase(),
    normalizedIdentifier.toLowerCase(),
    ...(role ? [role] : []),
  ];
  const [rows] = await pool.execute(
    `
      SELECT
        u.id,
        CONCAT(COALESCE(u.nom, ''), ' ', COALESCE(u.prenoms, '')) AS name,
        u.email,
        u.password,
        u.id_agent AS idAgent,
        a.matricule,
        p.role,
        p.permissions
      FROM utilisateurs u
      INNER JOIN profils p ON p.id = u.id_profil
      LEFT JOIN agents a ON a.id = u.id_agent
      WHERE (
          UPPER(a.matricule) = ?
          OR (p.role = 'admin' AND LOWER(u.email) = ?)
        )
        AND u.is_active = 1
        AND p.is_active = 1
        ${roleFilter}
    `,
    parameters
  ) as [Array<{ id: number; name: string; email: string; password: string; idAgent: number | null; matricule: string | null; role: string; permissions: string | null }>, unknown];

  for (const user of rows) {
    const isBcryptHash = /^\$2[aby]\$/.test(user.password);
    const passwordMatches = isBcryptHash
      ? await bcrypt.compare(normalizedPassword, user.password)
      : user.password === normalizedPassword;

    if (!passwordMatches) {
      continue;
    }

    if (!isBcryptHash) {
      const passwordHash = await bcrypt.hash(normalizedPassword, 12);
      await pool.execute('UPDATE utilisateurs SET password = ? WHERE id = ?', [passwordHash, user.id]);
    }

    return {
      id: user.id,
      name: user.name.trim() || user.email,
      email: user.email,
      idAgent: user.idAgent,
      role: user.role as Role,
      permissions: normalizePermissions(user.permissions) || rolePermissions[user.role as Role] || [],
    };
  }

  return null;
}

export function userHasPermission(user: { permissions?: string[] } | undefined, requiredPermission: string): boolean {
  if (!user) {
    return false;
  }

  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  return permissions.includes(requiredPermission);
}

export function buildToken(payload: { id: number; email: string; role: Role; idAgent?: number | null; name?: string }) {
  const tokenPayload = {
    ...payload,
    exp: Date.now() + 8 * 60 * 60 * 1000,
  };

  return `sotra.${Buffer.from(JSON.stringify(tokenPayload)).toString('base64url')}`;
}

export function decodeToken(token: string | undefined) {
  if (!token || !token.startsWith('sotra.')) {
    return null;
  }

  try {
    const raw = token.replace('sotra.', '');
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { id?: number; email?: string; role?: Role; idAgent?: number | null; name?: string; exp?: number };

    if (!parsed || !parsed.role || !parsed.email) {
      return null;
    }

    if (typeof parsed.exp === 'number' && parsed.exp < Date.now()) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function requireRole(allowedRoles: Role[]) {
  return (req: any, res: any, next: () => void) => {
    const user = req.user;

    if (!user || !allowedRoles.includes(user.role)) {
      return res.status(403).json({ message: 'Accès interdit pour ce profil.' });
    }

    return next();
  };
}
