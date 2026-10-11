import test from 'node:test';
import assert from 'node:assert/strict';
import { processSalesIntake, DEDUP_MODE } from '../src/pipeline.js';
import { ROUTE } from '../src/model.js';

// Dependency-free property-style test: generate many variations and verify invariants.
function rng(seed) {
  let x = seed >>> 0;
  return () => ((x = (1664525 * x + 1013904223) >>> 0) / 2 ** 32);
}

const pick = (r, values) => values[Math.floor(r() * values.length)];

test('500 generated no-dedup intakes never route to review/error when mandatory gates pass', () => {
  const r = rng(2262026);
  for (let i = 0; i < 500; i++) {
    const input = {
      primaryContact: {
        name: `Contact ${i}`,
        phone: `+34 6${String(Math.floor(r() * 1e8)).padStart(8, '0')}`,
        email: r() > .4 ? `person${i}@example.test` : undefined,
        company: r() > .5 ? `Company ${Math.floor(r() * 30)}` : undefined
      },
      source: { channel: pick(r, ['website', 'office', 'phone', 'partner', 'event']) },
      sales: { productCode: pick(r, ['A', 'B', 'PRO', undefined]) },
      consents: { privacy: true, dataProcessing: true, marketing: r() > .5 }
    };
    const result = processSalesIntake(input, { dedupMode: DEDUP_MODE.OFF });
    assert.equal(result.ok, true);
    assert.equal(result.deliverable, true);
    assert.equal(result.resolution.route, ROUTE.NEW);
  }
});

test('generated invalid mandatory consent states always fail before delivery', () => {
  const r = rng(42);
  for (let i = 0; i < 200; i++) {
    const privacy = r() > .5;
    const dataProcessing = r() > .5;
    if (privacy && dataProcessing) continue;
    const result = processSalesIntake({
      primaryContact: { name: `Contact ${i}`, phone: '+34 600 123 456' },
      source: { channel: 'website' },
      consents: { privacy, dataProcessing, marketing: r() > .5 }
    }, { dedupMode: DEDUP_MODE.OFF });
    assert.equal(result.ok, false);
  }
});
