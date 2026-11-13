const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('packaging finds the package manifest above a CommonJS module marker',()=>{
 const {root,pkg}=require('../scripts/package-root.cjs')('image-size');assert.equal(pkg.name,'image-size');assert.equal(pkg.version,'2.1.0');assert.equal(path.basename(root),'image-size');assert.ok(fs.existsSync(path.join(root,'dist/cjs/index.js')));assert.ok(pkg.exports['.'].require);
});
