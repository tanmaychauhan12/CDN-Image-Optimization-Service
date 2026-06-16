const fs = require('fs');
const path = require('path');
const { createSign } = require('crypto');
const { CloudFrontClient, CreateInvalidationCommand } = require('@aws-sdk/client-cloudfront');
const logger = require('../utils/logger');

const AWS_REGION = process.env.AWS_REGION || 'ap-south-1';
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN || 'mock-cf-distribution.cloudfront.net';
const CLOUDFRONT_KEY_PAIR_ID = process.env.CLOUDFRONT_KEY_PAIR_ID || 'mock-key-pair-id';
const CLOUDFRONT_DISTRIBUTION_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID || 'mock-distribution-id';

// Startup cached private key variable
let privateKey = '';
try {
  const keyPath = process.env.CLOUDFRONT_PRIVATE_KEY_PATH || './keys/cloudfront-private-key.pem';
  const resolvedPath = path.resolve(process.cwd(), keyPath);
  if (fs.existsSync(resolvedPath)) {
    privateKey = fs.readFileSync(resolvedPath, 'utf8');
    logger.info('CloudFront private key loaded successfully at startup.');
  } else {
    logger.warn(`CloudFront private key file not found at startup: ${resolvedPath}. Falling back to mock key.`);
    privateKey = 'mock-private-key-data';
  }
} catch (err) {
  logger.error(`Failed to load CloudFront private key at startup: ${err.message}`);
  privateKey = 'mock-private-key-data';
}

// Initialize AWS CloudFront Client
const cfClient = new CloudFrontClient({
  region: AWS_REGION,
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
});

/**
 * Base64 URL custom encoder as specified in requirements.
 * Replaces: + with -, = with _, / with ~
 * @param {string} str Input string
 * @returns {string} Custom base64Url encoded string
 */
function customBase64UrlEncode(str) {
  const base64 = Buffer.isBuffer(str) ? str.toString('base64') : Buffer.from(str).toString('base64');
  return base64
    .replace(/\+/g, '-')
    .replace(/=/g, '_')
    .replace(/\//g, '~');
}

/**
 * Generates a signed CloudFront URL for a given S3 Key.
 * Supports custom policy (with IP restriction) and canned policy.
 * @param {string} s3Key Key of the target object
 * @param {object} options Expiry limit and IP restriction parameters
 * @returns {{url: string, expiresAt: string}} Signed URL and expiry ISO string
 */
function generateSignedUrl(s3Key, options = {}) {
  const opts = { expiresIn: 3600, ipAddress: null, ...options };
  const domain = CLOUDFRONT_DOMAIN.replace(/\/$/, '');
  const cleanKey = s3Key.replace(/^\//, '');
  const resourceUrl = `https://${domain}/${cleanKey}`;
  
  const expiryTimestamp = Math.floor((Date.now() + (opts.expiresIn * 1000)) / 1000);
  const expiresAt = new Date(expiryTimestamp * 1000).toISOString();

  let finalUrl = '';

  if (opts.ipAddress) {
    // Use CUSTOM POLICY (allows IP restriction)
    const formattedIp = opts.ipAddress.includes('/') ? opts.ipAddress : `${opts.ipAddress}/32`;
    
    const policy = {
      Statement: [{
        Resource: resourceUrl,
        Condition: {
          DateLessThan: { 'AWS:EpochTime': expiryTimestamp },
          IpAddress: { 'AWS:SourceIp': formattedIp }
        }
      }]
    };

    const policyString = JSON.stringify(policy);
    const encodedPolicy = customBase64UrlEncode(policyString);

    let encodedSignature = '';
    try {
      const signer = createSign('RSA-SHA1');
      signer.update(policyString);
      const signature = signer.sign(privateKey);
      encodedSignature = customBase64UrlEncode(signature);
    } catch (err) {
      logger.warn(`Signature generation failed: ${err.message}. Using mock signature.`);
      encodedSignature = 'mock-custom-policy-signature';
    }

    finalUrl = `${resourceUrl}?Policy=${encodedPolicy}&Signature=${encodedSignature}&Key-Pair-Id=${CLOUDFRONT_KEY_PAIR_ID}`;
  } else {
    // Use CANNED POLICY (simpler)
    const toSign = `Expires=${expiryTimestamp}`;

    let encodedSignature = '';
    try {
      const signer = createSign('RSA-SHA1');
      signer.update(toSign);
      const signature = signer.sign(privateKey);
      encodedSignature = customBase64UrlEncode(signature);
    } catch (err) {
      logger.warn(`Signature generation failed: ${err.message}. Using mock signature.`);
      encodedSignature = 'mock-canned-policy-signature';
    }

    finalUrl = `${resourceUrl}?Expires=${expiryTimestamp}&Signature=${encodedSignature}&Key-Pair-Id=${CLOUDFRONT_KEY_PAIR_ID}`;
  }

  return { url: finalUrl, expiresAt };
}

/**
 * Creates a CloudFront invalidation for the specified paths.
 * @param {Array<string>} paths Array of CDN path globs/filenames to invalidate
 * @returns {Promise<string>} Invalidation ID
 */
async function invalidatePaths(paths) {
  logger.info(`Creating CloudFront invalidation for ${paths.length} paths...`);

  const command = new CreateInvalidationCommand({
    DistributionId: CLOUDFRONT_DISTRIBUTION_ID,
    InvalidationBatch: {
      Paths: {
        Quantity: paths.length,
        Items: paths,
      },
      CallerReference: Date.now().toString(),
    },
  });

  try {
    const response = await cfClient.send(command);
    const invalidationId = response.Invalidation?.Id;
    logger.info(`Successfully created invalidation. Invalidation ID: ${invalidationId}`);
    return invalidationId;
  } catch (error) {
    logger.error(`Failed to create CloudFront invalidation: ${error.message}`);
    throw error;
  }
}

/**
 * Generates signed URLs for all variants of an image record.
 * @param {object} imageRecord Full record from DynamoDB containing variants
 * @param {object} options Expiration and IP restrictions options
 * @returns {object} Response object with variants signed URLs
 */
function generateVariantSignedUrls(imageRecord, options = {}) {
  const { imageId, variants } = imageRecord;
  
  const signedVariants = {};
  if (variants && Array.isArray(variants)) {
    variants.forEach((v) => {
      signedVariants[v.variantName] = generateSignedUrl(v.s3Key, options);
    });
  } else if (variants && typeof variants === 'object') {
    Object.keys(variants).forEach((variantKey) => {
      const v = variants[variantKey];
      signedVariants[variantKey] = generateSignedUrl(v.s3Key, options);
    });
  }

  return {
    imageId,
    variants: signedVariants,
  };
}

// Keeping legacy support for getCdnUrl if used in S3 services
function getCdnUrl(fileKey) {
  const domain = CLOUDFRONT_DOMAIN.replace(/\/$/, '');
  const cleanKey = fileKey.replace(/^\//, '');
  return `https://${domain}/${cleanKey}`;
}

module.exports = {
  generateSignedUrl,
  invalidatePaths,
  generateVariantSignedUrls,
  getCdnUrl,
};
