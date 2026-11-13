const { spawn } = require('node:child_process');
const path = require('node:path');
let running = null;
function stopPython(){if(running){if(process.platform==='win32')spawn('taskkill',['/pid',String(running.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else running.kill();}}
async function runPython(file, platform = process.platform, executable, onOutput=()=>{}) {
  if (!file || path.extname(file).toLowerCase() !== '.py') throw Error('Save the document as a .py file before running it.');
  if(running)throw Error('A Python script is already running. Stop it before starting another.');
  const commands = executable ? [[executable,['-u',file]]] : platform === 'win32' ? [['py', ['-3','-u', file]], ['python', ['-u',file]]] : [['python3', ['-u',file]], ['python', ['-u',file]]];
  for (const [command, args] of commands) {
    const result = await new Promise(resolve => {
      const child = spawn(command, args, { cwd: path.dirname(file), windowsHide: true }); let output = '', failed = false; running=child;
      const add = data => { const text=data.toString(); output += text; onOutput(text); if (output.length > 1000000) output = output.slice(-1000000); };
      child.stdout.on('data', add); child.stderr.on('data', add);
      child.on('error', error => { failed = true; running=null; resolve({ output: error.message, code: null, missing: error.code === 'ENOENT' }); });
      child.on('close', code => { if(running===child)running=null; if (!failed) resolve({ output, code, missing: false }); });
    });
    if (!result.missing) return { output: result.output, code: result.code };
  }
  return { output: 'Python was not found. Install Python 3 and make it available on PATH.', code: null };
}
module.exports = { runPython, stopPython };
