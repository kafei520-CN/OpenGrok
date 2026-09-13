const fs = require('node:fs');
const path = require('node:path');

/** Drop optional Chromium GPU shader blobs the chat UI does not need. */
const DROP = ['dxcompiler.dll', 'dxil.dll', 'vk_swiftshader.dll', 'vk_swiftshader_icd.json'];

module.exports = async function afterPack(context) {
  const dir = context.appOutDir;
  for (const name of DROP) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
};
