import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoInactiveAt, repoWeight } from './gt-repo-config.ts';

test('repoWeight: reads camelCase config.emissionShare (current upstream shape)', () => {
  assert.equal(repoWeight({ config: { emissionShare: 0.10127 } }), 0.10127);
});

test('repoWeight: still reads snake_case config.emission_share (legacy/master_repositories shape)', () => {
  assert.equal(repoWeight({ config: { emission_share: 0.0501 } }), 0.0501);
});

test('repoWeight: snake_case wins when both shapes are present (matches existing main behavior)', () => {
  assert.equal(repoWeight({ config: { emission_share: 1, emissionShare: 99 } }), 1);
});

test('repoWeight: falls back through config.weight and top-level variants', () => {
  assert.equal(repoWeight({ config: { weight: 5 } }), 5);
  assert.equal(repoWeight({ emission_share: 7 }), 7);
  assert.equal(repoWeight({ emissionShare: 9 }), 9);
  assert.equal(repoWeight({ weight: 11 }), 11);
});

test('repoWeight: missing or non-numeric coerces to 0', () => {
  assert.equal(repoWeight({}), 0);
  assert.equal(repoWeight({ config: {} }), 0);
  assert.equal(repoWeight({ config: { emissionShare: 'not a number' } }), 0);
});

test('repoInactiveAt: returns null when no inactive signal is present', () => {
  assert.equal(repoInactiveAt({ config: { emissionShare: 0.1 } }), null);
  assert.equal(repoInactiveAt({}), null);
});

test('repoInactiveAt: surfaces config.inactive_at and config.inactiveAt timestamps', () => {
  assert.equal(repoInactiveAt({ config: { inactive_at: '2026-04-06T00:00:00Z' } }), '2026-04-06T00:00:00Z');
  assert.equal(repoInactiveAt({ config: { inactiveAt: '2026-04-18T00:00:00Z' } }), '2026-04-18T00:00:00Z');
});

test('repoInactiveAt: snake_case eligibility_mode === false marks ineligible (pre-existing main behavior)', () => {
  assert.equal(repoInactiveAt({ config: { eligibility_mode: false } }), 'ineligible');
  assert.equal(repoInactiveAt({ eligibility_mode: false }), 'ineligible');
});

test('repoInactiveAt: camelCase eligibilityMode === false also marks ineligible (this PR adds this)', () => {
  // Without this fallback a repo flagged ineligible via camelCase eligibilityMode
  // would still render as active. Mirrors how main already handles both casings
  // for emissionShare/emission_share and inactiveAt/inactive_at.
  assert.equal(repoInactiveAt({ config: { eligibilityMode: false } }), 'ineligible');
  assert.equal(repoInactiveAt({ eligibilityMode: false }), 'ineligible');
});

test('repoInactiveAt: when ineligible AND a real timestamp is present, the timestamp wins over the "ineligible" marker', () => {
  assert.equal(
    repoInactiveAt({ config: { eligibilityMode: false, inactive_at: '2026-04-06T00:00:00Z' } }),
    '2026-04-06T00:00:00Z',
  );
});

test('repoInactiveAt: eligibility_mode/eligibilityMode === true (active) does not mark inactive', () => {
  assert.equal(repoInactiveAt({ config: { eligibility_mode: true } }), null);
  assert.equal(repoInactiveAt({ config: { eligibilityMode: true } }), null);
});
