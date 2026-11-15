// Render the suite-style SVG into the master PNG and Windows icon sizes.
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
app.dock?.hide();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(root, 'assets/logo.svg')).toString('base64');
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await window.loadURL('about:blank');
    const png = await window.webContents.executeJavaScript(`(async () => {
      const image = new Image();
      image.src = ${JSON.stringify('data:image/svg+xml;base64,')} + ${JSON.stringify(svg)};
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1024;
      canvas.getContext('2d').drawImage(image, 0, 0, 1024, 1024);
      return canvas.toDataURL('image/png');
    })()`);
    const source = nativeImage.createFromDataURL(png);
    if (source.isEmpty()) throw Error('The NoteMind logo could not be loaded.');
    fs.writeFileSync(path.join(root, 'src/icon.png'), source.toPNG());
    const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
    const images = sizes.map(size => source.resize({ width: size, height: size, quality: 'best' }).toPNG());
    const header = Buffer.alloc(6 + 16 * sizes.length);
    header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    sizes.forEach((size, i) => {
      const at = 6 + i * 16;
      header[at] = header[at + 1] = size === 256 ? 0 : size;
      header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
      header.writeUInt32LE(images[i].length, at + 8); header.writeUInt32LE(offset, at + 12);
      offset += images[i].length;
    });
    fs.writeFileSync(path.join(root, 'src/icon.ico'), Buffer.concat([header, ...images]));
  } finally {
    window.destroy();
  }
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
