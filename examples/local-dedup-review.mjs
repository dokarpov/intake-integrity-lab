import { processSalesIntake, DEDUP_MODE } from '../src/pipeline.js';
import { ReviewQueue } from '../src/review-queue.js';
import { DecisionHistory } from '../src/decision-history.js';
import candidates from '../fixtures/candidates.json' with { type: 'json' };

const queue = new ReviewQueue();
const history = new DecisionHistory();

const result = processSalesIntake({
  primaryContact: { name: 'Alex Morgan', phone: '5550000101' },
  parties: [
    { role: 'authorized_representative', name: 'Alex Morgan' },
    { role: 'beneficiary', name: 'A Different Person' }
  ],
  source: { channel: 'office', location: 'Northport' },
  consents: { privacy: true, dataProcessing: true }
}, { dedupMode: DEDUP_MODE.LOCAL, candidates, reviewQueue: queue, history });

console.log(JSON.stringify({ result, openReview: queue.list(), history: history.events }, null, 2));
