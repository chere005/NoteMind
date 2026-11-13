/** Mac builds require a native Apple Silicon host and an arm64-only Electron runtime. */
function validateMacTarget(platform, hostArch, runtimeArch) {
  if (platform !== 'darwin') return;
  if (hostArch !== 'arm64' || (runtimeArch != null && runtimeArch.trim() !== 'arm64')) {
    throw new Error('macOS builds require Apple Silicon and an arm64-only Electron runtime.');
  }
}
module.exports = { validateMacTarget };
