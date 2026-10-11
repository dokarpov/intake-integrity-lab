#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { ControlMonitor } from '../src/compliance/monitoring/control-monitor.js';

const input=process.argv[2];
if(!input){console.error('usage: node scripts/control-health.mjs control-state.json');process.exit(2)}
const state=JSON.parse(readFileSync(input,'utf8'));
const result=new ControlMonitor(state.policy||{}).evaluate(state);
console.log(JSON.stringify(result,null,2));
process.exit(result.ok?0:1);
