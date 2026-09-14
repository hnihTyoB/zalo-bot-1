const fs = require('fs');
const path = require('path');

module.exports = (req, res) => {
  try {
    const filePath = path.join(process.cwd(), 'public', 'stk.jpg');
    if (fs.existsSync(filePath)) {
      const imgBuffer = fs.readFileSync(filePath);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.status(200).send(imgBuffer);
    }
  } catch (e) {
    console.error('Error serving stk.jpg:', e.message);
  }

  return res.status(404).send('Image not found');
};
