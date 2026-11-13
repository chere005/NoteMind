const {test} = require('node:test');
const assert = require('node:assert/strict');
const {buildSync} = require('esbuild');
const path = require('node:path');
const out = path.join(require('node:os').tmpdir(), 'notemind-selection-test.cjs');
buildSync({entryPoints:[path.join(__dirname,'../src/tablet/renderer/selection.js')],bundle:true,platform:'node',format:'cjs',outfile:out});
const {outsideSelection} = require(out);
test('erase keeps crossing and outside strokes',()=>{const inside={points:[{x:.4,y:.4},{x:.5,y:.5}]},crossing={points:[{x:.4,y:.4},{x:.9,y:.9}]},outside={points:[{x:0,y:0}]}; assert.deepEqual(outsideSelection([inside,crossing,outside],{x:.3,y:.3,width:.3,height:.3}),[crossing,outside]);});
