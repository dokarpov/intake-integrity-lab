import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const approved=readFileSync(new URL('../demo/integrity.html',import.meta.url),'utf8');
const story=readFileSync(new URL('../demo/scroll-story.html',import.meta.url),'utf8');
const style=x=>x.match(/<style>([\s\S]*?)<\/style>/)?.[1]||'';

test('story inherits approved visual CSS byte-for-byte before isolated scene extensions',()=>{
 const base=style(approved),next=style(story);
 assert.ok(base.length>4000);
 assert.equal(next.slice(0,base.length),base);
 assert.match(next,/background:#fff/);
 assert.doesNotMatch(next,/(#df552a|#ff5f00|purple|pink|green)/i);
});
test('illustrations have no fake buttons or live-data submission',()=>{
 assert.match(story,/illustrative story/i);
 assert.match(story,/fictional data/i);
 const segment=story.slice(story.indexOf('<section id="story"'),story.indexOf('<section class="story-after"'));
 assert.doesNotMatch(segment,/<(?:button|input|iframe|textarea|select)\b/i);
 assert.doesNotMatch(story,/\bfetch\s*\(/);
 assert.match(story,/prefers-reduced-motion/);
 assert.match(story,/window\.addEventListener\('scroll'/);
 assert.match(story,/overflow:hidden/);
});
test('single document scroll, fixed aspect device, no wheel interception or nested scroll',()=>{
 assert.match(story,/position:sticky/);
 assert.match(story, /\.story-scroll\{height:345svh/);
 assert.match(story, /\.story-phone\{display:block/);
 assert.match(story, /\.story-desktop\{display:none/);
 assert.match(story,/section\.getBoundingClientRect\(\)/);
 assert.doesNotMatch(story, /addEventListener\(['"]wheel['"]/);
 assert.doesNotMatch(story,/overflow-y:\s*(?:auto|scroll)/);
});
