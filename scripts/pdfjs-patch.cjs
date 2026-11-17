// PDF.js 6.4.299 (Apache-2.0): preserve worker failures instead of resolving partial pages.
const fs=require('node:fs'),path=require('node:path');
const VERSION='6.4.299';
const original="        if (intentState.operatorList) {\n          intentState.operatorList.lastChunk = true;\n          for (const internalRenderTask of intentState.renderTasks) {\n            internalRenderTask.operatorListChanged();\n          }\n          this.#tryCleanup();\n        }\n        if (intentState.displayReadyCapability) {\n          intentState.displayReadyCapability.reject(reason);\n        } else if (intentState.opListReadCapability) {\n          intentState.opListReadCapability.reject(reason);\n        } else {\n          throw reason;\n        }";
const replacement="        // NoteMind: fail before notifying lastChunk, which otherwise resolves a\n        // partial/empty page when a bounded image or corrupt operator is rejected.\n        intentState.displayReadyCapability?.reject(reason);\n        intentState.opListReadCapability?.reject(reason);\n        if (intentState.operatorList) {\n          intentState.operatorList.lastChunk = true;\n          for (const internalRenderTask of [...intentState.renderTasks]) {\n            if (internalRenderTask.cancel) {\n              internalRenderTask.cancel(reason);\n            } else {\n              intentState.renderTasks.delete(internalRenderTask);\n            }\n          }\n          this.#tryCleanup();\n        }\n        if (!intentState.displayReadyCapability && !intentState.opListReadCapability) {\n          throw reason;\n        }";
function patch(source){
 if(source.includes(replacement))return source;
 if(source.split(original).length!==2)throw Error('PDF.js error propagation patch needs review for the installed version.');
 return source.replace(original,replacement);
}
function prepare({root=path.resolve(__dirname,'..'),dependency=path.dirname(require.resolve('pdfjs-dist/package.json'))}={}){
 const pkg=JSON.parse(fs.readFileSync(path.join(dependency,'package.json'),'utf8'));
 if(pkg.version!==VERSION)throw Error('Review the PDF.js error propagation patch before updating '+pkg.version+'.');
 const vendor=path.join(root,'src/vendor/pdfjs');fs.mkdirSync(vendor,{recursive:true});
 fs.writeFileSync(path.join(vendor,'pdf.mjs'),patch(fs.readFileSync(path.join(dependency,'build/pdf.mjs'),'utf8')));
 fs.copyFileSync(path.join(dependency,'build/pdf.worker.mjs'),path.join(vendor,'pdf.worker.mjs'));
}
module.exports={patch,prepare};
if(require.main===module)prepare();
