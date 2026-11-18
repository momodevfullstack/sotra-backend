import { pool } from '../db/index.js';

const codeColumnsByTable: Record<string, string> = {
  agents: 'matricule',
  adherents: 'num_adherent',
  bons: 'numero_bon',
  bordereaux: 'numero_bordereau',
  produits: 'code_produit',
  actes: 'code_acte',
  colleges: 'code',
  corporations: 'code',
  drb: 'code',
  type_etablissement: 'code',
  typeEtablissements: 'code',
};

export function resolveCodeColumn(tableName: string): string {
  return codeColumnsByTable[tableName] ?? 'code';
}

export function buildAutoCode(prefix: string, sequence: number, year = new Date().getFullYear()): string {
  return `${prefix.toUpperCase()}-${year}-${String(sequence).padStart(4, '0')}`;
}

export async function generateAutoCode(tableName: string, prefix: string, year = new Date().getFullYear()): Promise<string> {
  const [rows] = await pool.execute(`SELECT COUNT(*) AS total FROM ${tableName}`);
  const total = Array.isArray(rows) ? Number((rows[0] as { total?: number | string } | undefined)?.total ?? 0) : 0;
  const codeColumn = resolveCodeColumn(tableName);

  let sequence = total + 1;
  while (sequence < total + 100000) {
    const candidate = buildAutoCode(prefix, sequence, year);
    const [existingRows] = await pool.execute(`SELECT id FROM ${tableName} WHERE ${codeColumn} = ?`, [candidate]);
    if (!Array.isArray(existingRows) || existingRows.length === 0) {
      return candidate;
    }
    sequence += 1;
  }

  throw new Error(`Impossible de générer un code libre pour ${tableName}.`);
}
