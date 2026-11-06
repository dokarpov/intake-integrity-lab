// Per-process reference limiter. Production still requires a distributed gateway limiter.
export class SlidingWindowRateLimiter {
  constructor({ limit=120, windowMs=60_000, now=()=>Date.now(), maxKeys=50_000 }={}) {
    if (!Number.isInteger(maxKeys) || maxKeys<1) throw new TypeError('maxKeys must be a positive integer');
    Object.assign(this,{limit,windowMs,now,maxKeys});
    this.hits=new Map();
  }

  check(key,{limit=this.limit,windowMs=this.windowMs}={}) {
    const now=this.now(),cutoff=now-windowMs;
    const existing=this.hits.get(key);

    // Never admit unbounded new identities: a flood of fresh keys should not
    // grow the process heap after maxKeys has been reached.
    if (!existing && this.hits.size >= this.maxKeys) {
      for (const [oldKey,hits] of this.hits) {
        if (hits.length===0 || hits.at(-1)<=cutoff) this.hits.delete(oldKey);
        if (this.hits.size<this.maxKeys) break;
      }
      if (this.hits.size >= this.maxKeys) {
        return { allowed:false, remaining:0,
          resetAt:now+windowMs, retryAfterMs:windowMs, reason:'limiter_capacity_reached' };
      }
    }

    const arr=(existing||[]).filter(timestamp=>timestamp>cutoff);
    const allowed=arr.length<limit;
    if (allowed) arr.push(now);
    this.hits.set(key,arr);
    const resetAt=(arr[0]||now)+windowMs;
    return { allowed, remaining:Math.max(0,limit-arr.length),
      resetAt, retryAfterMs:Math.max(0,resetAt-now) };
  }
}
