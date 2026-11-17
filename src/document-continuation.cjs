// Trusted service code may release source admission after making immutable spools.
const {AsyncLocalStorage}=require('node:async_hooks');
const scopes=new AsyncLocalStorage();
function withDocumentContinuation(control,run){return scopes.run(control,run);}
function releaseDocumentInputs(){const control=scopes.getStore();return control?control.release():false;}
module.exports={withDocumentContinuation,releaseDocumentInputs};
