import { createHash } from 'node:crypto';

function h(value) { return createHash('sha256').update(Buffer.from(String(value), 'utf8')).digest('hex'); }
function pair(a, b) { return h(`${a}:${b}`); }

export function merkleRoot(leaves = []) {
  if (!leaves.length) return null;
  let level = leaves.map(x => h(`leaf:${x}`));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(pair(level[i], level[i + 1] ?? level[i]));
    level = next;
  }
  return level[0];
}

export function merkleProof(leaves, index) {
  if (index < 0 || index >= leaves.length) throw new Error('merkle_index_out_of_range');
  let idx = index;
  let level = leaves.map(x => h(`leaf:${x}`));
  const proof = [];
  while (level.length > 1) {
    const siblingIndex = idx ^ 1;
    const sibling = level[siblingIndex] ?? level[idx];
    proof.push({ side: idx % 2 === 0 ? 'right' : 'left', hash: sibling });
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(pair(level[i], level[i + 1] ?? level[i]));
    idx = Math.floor(idx / 2);
    level = next;
  }
  return { leaf: leaves[index], index, proof, root: level[0] };
}

export function verifyMerkleProof({ leaf, proof, root }) {
  let current = h(`leaf:${leaf}`);
  for (const step of proof) current = step.side === 'left' ? pair(step.hash, current) : pair(current, step.hash);
  return current === root;
}
