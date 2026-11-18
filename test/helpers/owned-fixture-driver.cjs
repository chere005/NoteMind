// Change only the existing fixture-hash loop in a diagnostic driver derivative.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const anchor='for await(const chunk of fs.createReadStream(fixtureFile,{highWaterMark:196608}))digest.update(chunk);',sha=value=>createHash('sha256').update(value).digest('hex'),helper=path.join(__dirname,'fixture-owned-hash.cjs');
function deriveOwnedFixtureDriver(code,{canonicalSource=code,canonicalFile,extensionFile,wrapperFile,entryFile}={}){
 if(code.split(anchor).length!==2||canonicalSource.split(anchor).length!==2)throw Error('Original fixture-hash loop authority changed.');
 const replacement="const fixtureHashBefore=process.memoryUsage(),fixtureHashStart=performance.now(),fixtureHashReceipt=await require("+JSON.stringify(helper)+").hashFixtureOwned(fixtureFile,{digest,finalize:false});if(fixtureHashReceipt.bytes!==info.archiveBytes||!fixtureHashReceipt.fdClosed||!fixtureHashReceipt.scratchDetached||fixtureHashReceipt.scratchAllocations!==1)throw Error('Owned fixture hash preparation did not retire.');report.fixtureHashPreparation={scope:'HARNESS preparation only; unchanged canonical SHA verification follows',...globalThis.__notemindOwnedFixtureHashProof,...fixtureHashReceipt,expectedArchiveSHA:info.archiveSha256,wallMs:performance.now()-fixtureHashStart,before:fixtureHashBefore,after:process.memoryUsage()};";
 const derived=code.replace(anchor,replacement),files=[__filename,helper,canonicalFile,extensionFile,wrapperFile,entryFile].filter(Boolean),proof={canonicalDriverSHA:sha(canonicalSource),extendedDriverSHA:sha(code),derivedCodeSHA:sha(derived),files:Object.fromEntries(files.map(file=>[file,sha(fs.readFileSync(file))]))};
 return{code:derived,proof};
}
module.exports={deriveOwnedFixtureDriver,anchor};
