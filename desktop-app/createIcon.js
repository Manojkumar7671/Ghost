import fs from 'fs';
import path from 'path';

// 1x1 transparent/cyan PNG buffer
const base64Png = 'iVBORw0KGgoAAAANSU56NTAKAAAAEAAAAAEAAAAIAQAAACaYq6UAAAAFGGVQI1j/z0D9/wP+B/4D/gP+A/4D/gP+A/4D/gP+A/4AAAAASUVORK5CYII=';
const buffer = Buffer.from('89504e470d0a1a0a0000000d4948445200000010000000100806000000fff31fec00000019494441543811c6020000000020a4bf85250000000000000000000000010000050000011a00a26d0000000049454e44ae426082', 'hex');

fs.writeFileSync(path.join(process.cwd(), 'desktop-app', 'icon.png'), buffer);
console.log('Created desktop-app/icon.png');
