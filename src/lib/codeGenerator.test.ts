import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAutoCode, resolveCodeColumn } from './codeGenerator.js';

test('buildAutoCode should generate a deterministic code with prefix and sequence', () => {
  assert.equal(buildAutoCode('AG', 1), 'AG-2026-0001');
  assert.equal(buildAutoCode('BON', 12), 'BON-2026-0012');
});

test('resolveCodeColumn should match the actual database identifier for each table', () => {
  assert.equal(resolveCodeColumn('produits'), 'code_produit');
  assert.equal(resolveCodeColumn('actes'), 'code_acte');
  assert.equal(resolveCodeColumn('agents'), 'matricule');
  assert.equal(resolveCodeColumn('adherents'), 'num_adherent');
  assert.equal(resolveCodeColumn('bons'), 'numero_bon');
  assert.equal(resolveCodeColumn('colleges'), 'code');
  assert.equal(resolveCodeColumn('corporations'), 'code');
});
