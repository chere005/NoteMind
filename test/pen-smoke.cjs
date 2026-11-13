const { buildSync } = require('esbuild'); const path = require('path');
buildSync({entryPoints:['src/tablet/shared/penEvents.ts'],bundle:true,platform:'node',format:'cjs',outfile:'dist/pen-events-test.cjs'});
const {createSynth} = require(path.resolve('dist/pen-events-test.cjs'));
const assert = require('node:assert/strict'); const synth=createSynth();
const sample={t:1,x:0.5,y:0.5,p:0.7,inRange:true,tip:true,lower:false,upper:false,eraser:false};
const first=synth.step(sample); assert(first.some(e=>e.type==='pointerdown' && e.pressure===0.7));
const last=synth.step({...sample,tip:false,inRange:false}); assert(last.some(e=>e.type==='pointerup'));
console.log('Native pen event conversion passed');

