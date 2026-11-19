import { boolean, date, decimal, int, mediumtext, mysqlTable, serial, text, timestamp, varchar } from 'drizzle-orm/mysql-core';

export const profils = mysqlTable('profils', {
  id: serial('id').primaryKey(),
  nom: varchar('nom', { length: 100 }).notNull().unique(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  role: varchar('role', { length: 50 }).notNull(),
  description: text('description'),
  permissions: text('permissions').notNull().default(''),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const utilisateurs = mysqlTable('utilisateurs', {
  id: serial('id').primaryKey(),
  nom: varchar('nom', { length: 100 }).notNull(),
  prenoms: varchar('prenoms', { length: 150 }),
  email: varchar('email', { length: 150 }).notNull().unique(),
  password: varchar('password', { length: 255 }).notNull(),
  idProfil: int('id_profil').notNull(),
  idAgent: int('id_agent'),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const agents = mysqlTable('agents', {
  id: serial('id').primaryKey(),
  idCollege: int('id_college'),
  matricule: varchar('matricule', { length: 50 }).notNull().unique(),
  nom: varchar('nom', { length: 100 }).notNull(),
  prenoms: varchar('prenoms', { length: 150 }).notNull(),
  email: varchar('email', { length: 100 }),
  telephone: varchar('telephone', { length: 30 }),
  poste: varchar('poste', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const adherents = mysqlTable('adherents', {
  id: serial('id').primaryKey(),
  numAdherent: varchar('num_adherent', { length: 50 }).notNull().unique(),
  idAgent: int('id_agent').notNull(),
  nom: varchar('nom', { length: 100 }).notNull(),
  prenoms: varchar('prenoms', { length: 150 }).notNull(),
  dateNaissance: date('date_naissance'),
  telephone: varchar('telephone', { length: 30 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const bordereaux = mysqlTable('bordereaux', {
  id: serial('id').primaryKey(),
  numeroBordereau: varchar('numero_bordereau', { length: 50 }).notNull().unique(),
  libelle: varchar('libelle', { length: 150 }),
  etablissement: varchar('etablissement', { length: 150 }),
  idAgent: int('id_agent'),
  idAdherent: int('id_adherent'),
  montantTotal: decimal('montant_total', { precision: 12, scale: 2 }).notNull().default('0'),
  dateBordereau: date('date_bordereau').notNull(),
  statut: varchar('statut', { length: 50 }).notNull().default('en_attente'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const bons = mysqlTable('bons', {
  id: serial('id').primaryKey(),
  numeroBon: varchar('numero_bon', { length: 50 }).notNull().unique(),
  idBordereau: int('id_bordereau'),
  idAgent: int('id_agent').notNull(),
  idAdherent: int('id_adherent').notNull(),
  montantTotal: decimal('montant_total', { precision: 12, scale: 2 }).notNull().default('0'),
  montantBase: decimal('montant_base', { precision: 12, scale: 2 }),
  tauxCouverture: decimal('taux_couverture', { precision: 5, scale: 2 }),
  basvValidatedBy: int('basv_validated_by'),
  basvValidatorName: varchar('basv_validator_name', { length: 255 }),
  basvValidatedAt: timestamp('basv_validated_at'),
  dgValidatedBy: int('dg_validated_by'),
  dgValidatorName: varchar('dg_validator_name', { length: 255 }),
  dgValidatedAt: timestamp('dg_validated_at'),
  dateBon: date('date_bon').notNull(),
  statut: varchar('statut', { length: 50 }).notNull().default('en_attente'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const produits = mysqlTable('produits', {
  id: serial('id').primaryKey(),
  codeProduit: varchar('code_produit', { length: 50 }).notNull().unique(),
  libelle: varchar('libelle', { length: 150 }).notNull(),
  prixUnitaire: decimal('prix_unitaire', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const actes = mysqlTable('actes', {
  id: serial('id').primaryKey(),
  codeActe: varchar('code_acte', { length: 50 }).notNull().unique(),
  libelle: varchar('libelle', { length: 150 }).notNull(),
  montant: decimal('montant', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const bonProduits = mysqlTable('bon_produits', {
  id: serial('id').primaryKey(),
  idBon: int('id_bon').notNull(),
  idProduit: int('id_produit').notNull(),
  quantite: int('quantite').notNull().default(1),
  montant: decimal('montant', { precision: 12, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const bonActes = mysqlTable('bon_actes', {
  id: serial('id').primaryKey(),
  idBon: int('id_bon').notNull(),
  idActe: int('id_acte').notNull(),
  quantite: int('quantite').notNull().default(1),
  montant: decimal('montant', { precision: 12, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const taux = mysqlTable('taux', {
  id: serial('id').primaryKey(),
  idCollege: int('id_college').notNull(),
  idTypeEtablissement: int('id_type_etablissement').notNull(),
  idDrb: int('id_drb'),
  tauxCouverture: decimal('taux_couverture', { precision: 5, scale: 2 }).notNull(),
});

export const tauxCollege = mysqlTable('taux_college', {
  id: serial('id').primaryKey(),
  idCollege: int('id_college').notNull().unique(),
  tauxCouverture: decimal('taux_couverture', { precision: 5, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const remboursements = mysqlTable('remboursements', {
  id: serial('id').primaryKey(),
  idBon: int('id_bon').notNull(),
  idAgent: int('id_agent').notNull(),
  idAdherent: int('id_adherent').notNull(),
  montant: decimal('montant', { precision: 12, scale: 2 }).notNull(),
  dateRemboursement: date('date_remboursement').notNull(),
  statut: varchar('statut', { length: 50 }).notNull().default('en_attente'),
  documentBasv: mediumtext('document_basv'),
  documentNom: varchar('document_nom', { length: 255 }),
  documentMime: varchar('document_mime', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const recusBons = mysqlTable('recus_bons', {
  id: serial('id').primaryKey(),
  idBon: int('id_bon').notNull().unique(),
  contenu: mediumtext('contenu').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const recusConfirmationPaiement = mysqlTable('recus_confirmation_paiement', {
  id: serial('id').primaryKey(),
  idRemboursement: int('id_remboursement').notNull().unique(),
  contenu: mediumtext('contenu').notNull(),
  envoyePar: int('envoye_par'),
  nomEnvoyeur: varchar('nom_envoyeur', { length: 255 }),
  envoyeLe: timestamp('envoye_le'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
