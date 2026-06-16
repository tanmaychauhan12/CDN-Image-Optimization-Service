const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Configuration matching our sharpService.js
const VARIANT_CONFIG = {
  thumb:    { width: 150,  height: 150,  fit: 'cover',    quality: 80 },
  small:    { width: 400,  height: null, fit: 'inside',   quality: 82 },
  medium:   { width: 800,  height: null, fit: 'inside',   quality: 85 },
  large:    { width: 1600, height: null, fit: 'inside',   quality: 87 },
  og:       { width: 1200, height: 630,  fit: 'cover',    quality: 90 },
  original: { width: null, height: null, fit: 'inside',   quality: 88 }
};

async function runLocalTest() {
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  const samplePath = path.join(__dirname, 'sample.png');
  let inputBuffer;

  // 1. Generate a sample image if one doesn't exist
  if (!fs.existsSync(samplePath)) {
    console.log('No "sample.png" found. Generating a high-resolution placeholder image...');
    inputBuffer = await sharp({
      create: {
        width: 1920,
        height: 1080,
        channels: 4,
        background: { r: 41, g: 128, b: 185, alpha: 1 } // Beautiful blue color
      }
    })
    .composite([{
      input: Buffer.from('<svg><text x="50%" y="50%" font-family="sans-serif" font-size="60" fill="white" text-anchor="middle">CDN Image Optimization Service</text></svg>'),
      gravity: 'center'
    }])
    .png()
    .toBuffer();
    
    fs.writeFileSync(samplePath, inputBuffer);
    console.log(`Created sample input image: ${samplePath}`);
  } else {
    console.log(`Using existing sample image: ${samplePath}`);
    inputBuffer = fs.readFileSync(samplePath);
  }

  console.log(`Original Image Size: ${(inputBuffer.length / (1024 * 1024)).toFixed(2)} MB`);
  console.log('Optimizing and creating variants locally...\n');

  // 2. Process all variants in parallel
  const startTime = Date.now();
  const variantNames = Object.keys(VARIANT_CONFIG);

  await Promise.all(
    variantNames.map(async (name) => {
      const config = VARIANT_CONFIG[name];
      let pipeline = sharp(inputBuffer);

      // Apply resize config
      if (config.width || config.height) {
        pipeline = pipeline.resize(config.width, config.height, {
          fit: config.fit,
          withoutEnlargement: true
        });
      }

      // Convert format (original to AVIF, others to WebP)
      let ext = 'webp';
      if (name === 'original') {
        ext = 'avif';
        pipeline = pipeline.avif({ quality: Math.max(1, config.quality - 10) });
      } else {
        pipeline = pipeline.webp({ quality: config.quality });
      }

      const outputBuffer = await pipeline.toBuffer();
      const variantFilename = `${name}.${ext}`;
      const outputPath = path.join(outputDir, variantFilename);

      fs.writeFileSync(outputPath, outputBuffer);

      const sizeKB = (outputBuffer.length / 1024).toFixed(1);
      console.log(`[✓] Created variant: ${variantFilename.padEnd(15)} | Size: ${sizeKB.padStart(6)} KB`);
    })
  );

  const duration = Date.now() - startTime;
  console.log(`\nOptimization finished in ${duration}ms!`);
  console.log(`Open the folder to see the results: ${outputDir}`);
}

runLocalTest().catch(err => {
  console.error('Error running local test:', err);
});
