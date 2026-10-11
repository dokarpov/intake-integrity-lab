export class SlidingWindowRateLimiter{
  constructor({limit=120,windowMs=60_000,now=()=>Date.now(),maxKeys=50_000}={}){Object.assign(this,{limit,windowMs,now,maxKeys});this.hits=new Map()}
  check(key,{limit=this.limit,windowMs=this.windowMs}={}){
    const now=this.now(), cutoff=now-windowMs;let arr=(this.hits.get(key)||[]).filter(x=>x>cutoff);const allowed=arr.length<limit;
    if(allowed)arr.push(now);this.hits.set(key,arr);if(this.hits.size>this.maxKeys){for(const [k,v] of this.hits){if(!v.length||v.at(-1)<=cutoff)this.hits.delete(k);if(this.hits.size<=this.maxKeys)break}}
    const resetAt=(arr[0]||now)+windowMs;return{allowed,remaining:Math.max(0,limit-arr.length),resetAt,retryAfterMs:Math.max(0,resetAt-now)};
  }
}
