import test from 'node:test';
import assert from 'node:assert/strict';
import { SlidingWindowRateLimiter } from '../src/service/http/rate-limit.js';

test('distinct fresh keys cannot grow beyond configured capacity', () => {
  let clock=1_000_000;
  const limiter=new SlidingWindowRateLimiter({limit:2,windowMs:60_000,maxKeys:2,now:()=>clock});
  assert.equal(limiter.check('tenant:a').allowed,true);
  assert.equal(limiter.check('tenant:b').allowed,true);
  for(let i=0;i<1000;i++){
    const result=limiter.check('attacker:'+i);
    assert.equal(result.allowed,false);
    assert.equal(result.reason,'limiter_capacity_reached');
    assert.ok(result.retryAfterMs>0);
  }
  assert.equal(limiter.hits.size,2);
  // An existing identity is not unexpectedly evicted while active.
  assert.equal(limiter.check('tenant:a').allowed,true);
  assert.equal(limiter.check('tenant:a').allowed,false);
  assert.equal(limiter.hits.size,2);
  // Once the old window expires, capacity is reclaimed for a new identity.
  clock+=60_001;
  assert.equal(limiter.check('tenant:new').allowed,true);
  assert.ok(limiter.hits.size<=2);
});

test('ordinary sliding-window semantics remain unchanged',()=>{
  let clock=5_000;
  const limiter=new SlidingWindowRateLimiter({limit:2,windowMs:500,maxKeys:3,now:()=>clock});
  assert.equal(limiter.check('a').allowed,true);
  assert.equal(limiter.check('a').remaining,0);
  assert.equal(limiter.check('a').allowed,false);
  clock+=501;
  assert.equal(limiter.check('a').allowed,true);
});

test('invalid limits cannot silently create unbounded state',()=>{
  for(const maxKeys of [0,-1,1.2,NaN]){
    assert.throws(()=>new SlidingWindowRateLimiter({maxKeys}),TypeError);
  }
});
