# 🖼️ CDN Image Optimization Service

> Upload images once. Get them resized, compressed, and delivered globally in milliseconds — with signed URLs and zero public S3 exposure.

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![AWS S3](https://img.shields.io/badge/AWS-S3-FF9900?style=flat-square&logo=amazons3&logoColor=white)](https://aws.amazon.com/s3/)
[![CloudFront](https://img.shields.io/badge/AWS-CloudFront-FF9900?style=flat-square&logo=amazonaws&logoColor=white)](https://aws.amazon.com/cloudfront/)
[![Sharp](https://img.shields.io/badge/Sharp-libvips-99CC00?style=flat-square)](https://sharp.pixelplumbing.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

---

## 📋 Table of Contents

- [What It Does](#-what-it-does)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Features](#-features)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [AWS Setup](#-aws-setup)
- [API Reference](#-api-reference)
- [Image Variants](#-image-variants)
- [Security Model](#-security-model)
- [How Cache Works](#-how-cache-works)
- [Processing Pipeline](#-processing-pipeline)
- [Running Tests](#-running-tests)
- [Deployment](#-deployment)
- [Cost Estimate](#-cost-estimate)

---

## 🚀 What It Does

A production-grade image optimization service that:

1. **Accepts** raw image uploads (`JPEG`, `PNG`, `WebP`, `AVIF`, `GIF`, `TIFF`, `BMP`) via a secure REST API
2. **Validates** files using magic byte inspection — not just the file extension
3. **Processes** uploads through a Sharp/libvips pipeline, generating 6 optimized variants in parallel
4. **Stores** all variants in a private AWS S3 bucket — never publicly accessible
5. **Serves** them globally via CloudFront (600+ edge PoPs) with short-lived RSA-signed URLs
6. **Indexes** metadata in DynamoDB for fast lookups, pagination, and ownership checks

The client never touches S3 directly. Every read goes through CloudFront. Every write goes through the API.

---

## 🏗️ Architecture

```
Client
  │
  ├─── POST /upload (JWT Bearer token)
  │         │
  │    Express + Multer (memory stream)
  │         │
  │    Pre-flight validator
  │    (magic bytes, size, dimensions)
  │         │
  │    Sharp / libvips pipeline
  │         │
  │    ┌────┴──────────────────────────────┐
  │    │  thumb │ small │ medium │ large   │
  │    │    og  │      original            │
  │    └────┬──────────────────────────────┘
  │         │ parallel PutObject
  │    AWS S3 (private bucket)
  │         │
  │    DynamoDB (metadata index)
  │         │
  └─── 201 { imageId, signedUrls }
  
  │
  ├─── GET /images/:id/urls
  │         │
  │    DynamoDB lookup (ownership check)
  │         │
  │    CloudFront signed URL (RSA-2048)
  │         │
  └─── 200 { signedUrls: { thumb, medium, large... } }

  │
  └─── Client fetches signed URL
             │
        CloudFront Edge (~600 PoPs)
             │ MISS
        S3 via OAC ──→ cached at edge
             │ HIT (sub-10ms)
        Served from nearest PoP
             │
        Lambda@Edge (optional)
        on-demand transform / format negotiation
```

---

## 🛠️ Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Runtime | Node.js 18+ | Non-blocking I/O perfect for streaming |
| Framework | Express.js | Minimal, battle-tested routing |
| File upload | Multer (memoryStorage) | Streams directly into Sharp, no disk writes |
| Image processing | Sharp + libvips | 4–5× faster than ImageMagick, streaming pipeline |
| Auth | JSON Web Tokens (JWT) | Stateless, scalable auth |
| Storage | AWS S3 (private) | Durable, cheap, versioned object store |
| CDN | AWS CloudFront | 600+ PoPs, signed URL support, OAC |
| Metadata | AWS DynamoDB | Single-digit ms reads, pay-per-request |
| Cache | Redis (ioredis) | Rate limiting sliding window |
| Validation | Joi | Schema validation for query params |
| Logging | Winston | Structured JSON logs |
| Testing | Jest + Supertest | Unit + integration coverage |

---

## ✨ Features

- **Magic byte validation** — detects spoofed files at the byte level, not the extension
- **6 image variants** generated per upload (thumb, small, medium, large, og, original)
- **WebP + AVIF output** — modern formats, 25–50% smaller than JPEG
- **EXIF stripping** — removes GPS, camera metadata, timestamps automatically
- **Parallel S3 uploads** — all variants uploaded simultaneously using AWS SDK v3 multipart
- **CloudFront signed URLs** — RSA-2048, time-limited, optional IP-bound
- **Origin Access Control (OAC)** — S3 bucket is fully private, only CloudFront can read
- **Paginated image listing** — cursor-based pagination via DynamoDB GSI
- **Rate limiting** — Redis sliding window counter per user
- **Ownership enforcement** — users can only access and delete their own images
- **Clean deletion** — removes all S3 variants + CloudFront invalidation + DynamoDB record
- **Health endpoint** — checks S3 connectivity, suitable for ALB/ECS health checks

---

## 📁 Project Structure

```
cdn-image-service/
├── src/
│   ├── routes/
│   │   ├── upload.js          # POST /upload
│   │   ├── images.js          # GET/DELETE /images
│   │   └── health.js          # GET /health
│   ├── middleware/
│   │   ├── auth.js            # JWT verification
│   │   ├── rateLimit.js       # Redis sliding window
│   │   └── errorHandler.js    # Centralized error responses
│   ├── services/
│   │   ├── sharpService.js    # Image processing pipeline
│   │   ├── s3Service.js       # S3 upload / delete / presign
│   │   ├── cloudFrontService.js # Signed URL generation + invalidation
│   │   └── metadataService.js # DynamoDB CRUD
│   ├── validators/
│   │   └── imageValidator.js  # Magic bytes + dimension checks
│   ├── utils/
│   │   ├── logger.js          # Winston logger
│   │   └── generateId.js      # Prefixed UUID generator
│   └── app.js                 # Express app (no listen)
├── tests/
│   ├── unit/
│   │   └── imageValidator.test.js
│   └── integration/
│       └── upload.test.js
├── keys/
│   └── .gitkeep               # CloudFront RSA private key goes here
├── server.js                  # Entry point
├── .env.example
├── .gitignore
└── package.json
```

---

## 🏁 Getting Started

### Prerequisites

- Node.js 18+
- An AWS account with S3, CloudFront, DynamoDB access
- Redis (local via Docker or managed)

### Installation

```bash
# Clone the repo
git clone https://github.com/your-username/cdn-image-service.git
cd cdn-image-service

# Install dependencies
npm install

# Copy env file and fill in your values
cp .env.example .env

# Add your CloudFront private key
# (see AWS Setup → Step 4 below)
openssl genrsa -out keys/cloudfront-private-key.pem 2048

# Start development server
npm run dev
```

### Quick test upload

```bash
curl -X POST http://localhost:3000/api/v1/upload \
  -H "Authorization: Bearer <your-jwt>" \
  -F "image=@/path/to/photo.jpg"
```

---

## 🔧 Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `JWT_SECRET` | Secret for signing/verifying JWTs | `super-secret-key` |
| `AWS_REGION` | AWS region for all services | `ap-south-1` |
| `AWS_ACCESS_KEY_ID` | IAM user access key | `AKIA...` |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret key | `wJalr...` |
| `S3_BUCKET_NAME` | Private S3 bucket name | `my-cdn-images` |
| `CLOUDFRONT_DOMAIN` | CloudFront distribution domain | `d1abc.cloudfront.net` |
| `CLOUDFRONT_DISTRIBUTION_ID` | Distribution ID for invalidations | `E1ABCDEF...` |
| `CLOUDFRONT_KEY_PAIR_ID` | Key pair ID for signed URLs | `KPAX1234...` |
| `CLOUDFRONT_PRIVATE_KEY_PATH` | Path to RSA private key file | `./keys/cloudfront-private-key.pem` |
| `DYNAMODB_TABLE_NAME` | DynamoDB table name | `cdn-image-service` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |

---

## ☁️ AWS Setup

### Step 1 — S3 Bucket

```bash
# Create private bucket (replace region and name)
aws s3api create-bucket \
  --bucket my-cdn-images \
  --region ap-south-1 \
  --create-bucket-configuration LocationConstraint=ap-south-1

# Block ALL public access
aws s3api put-public-access-block \
  --bucket my-cdn-images \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket my-cdn-images \
  --versioning-configuration Status=Enabled
```

### Step 2 — DynamoDB Table

```bash
aws dynamodb create-table \
  --table-name cdn-image-service \
  --attribute-definitions \
    AttributeName=imageId,AttributeType=S \
    AttributeName=ownerId,AttributeType=S \
    AttributeName=createdAt,AttributeType=S \
  --key-schema \
    AttributeName=imageId,KeyType=HASH \
    AttributeName=ownerId,KeyType=RANGE \
  --global-secondary-indexes '[{
    "IndexName": "ownerId-createdAt-index",
    "KeySchema": [
      {"AttributeName":"ownerId","KeyType":"HASH"},
      {"AttributeName":"createdAt","KeyType":"RANGE"}
    ],
    "Projection": {"ProjectionType":"ALL"}
  }]' \
  --billing-mode PAY_PER_REQUEST \
  --region ap-south-1
```

### Step 3 — CloudFront Distribution

Create a distribution in the AWS Console with:
- **Origin**: your S3 bucket
- **Origin Access**: Origin Access Control (OAC) — not OAI
- **Viewer protocol policy**: Redirect HTTP to HTTPS
- **Cache policy**: Managed-CachingOptimized
- **Restrict viewer access**: Yes (signed URLs required)

After creation, copy the **Distribution ID** and **Domain** to your `.env`.

### Step 4 — CloudFront RSA Key Pair

```bash
# Generate private key
openssl genrsa -out keys/cloudfront-private-key.pem 2048

# Extract public key
openssl rsa -pubout \
  -in keys/cloudfront-private-key.pem \
  -out keys/cloudfront-public-key.pem

# Upload public key to CloudFront in AWS Console:
# CloudFront → Key management → Public keys → Add public key
# Paste the content of cloudfront-public-key.pem
# Note the Key Pair ID → add to CLOUDFRONT_KEY_PAIR_ID in .env
```

> ⚠️ **Never commit `cloudfront-private-key.pem` to git.** The `.gitignore` excludes the `keys/` directory.

### Step 5 — IAM Permissions

Your IAM user needs these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject", "s3:GetObject",
        "s3:DeleteObject", "s3:ListBucket",
        "s3:HeadBucket"
      ],
      "Resource": [
        "arn:aws:s3:::my-cdn-images",
        "arn:aws:s3:::my-cdn-images/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem", "dynamodb:GetItem",
        "dynamodb:DeleteItem", "dynamodb:Query"
      ],
      "Resource": [
        "arn:aws:dynamodb:ap-south-1:*:table/cdn-image-service",
        "arn:aws:dynamodb:ap-south-1:*:table/cdn-image-service/index/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["cloudfront:CreateInvalidation"],
      "Resource": "arn:aws:cloudfront::*:distribution/*"
    }
  ]
}
```

---

## 📡 API Reference

### Authentication

All endpoints require a JWT Bearer token in the `Authorization` header:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

### `POST /api/v1/upload`

Upload an image. Returns signed URLs for all generated variants.

**Request**
```
Content-Type: multipart/form-data
Body field: image (the image file)
Max size: 50MB
```

**Response `201`**
```json
{
  "imageId": "img_3f2a1b4c...",
  "ownerId": "user_123",
  "variants": [
    {
      "variantName": "thumb",
      "s3Key": "user_123/img_3f2a1b4c/thumb.webp",
      "width": 150,
      "height": 150,
      "format": "webp",
      "sizeBytes": 4821
    }
  ],
  "message": "Upload successful"
}
```

**Errors**

| Status | Code | Reason |
|--------|------|--------|
| 400 | `NO_FILE` | No file in request |
| 400 | `FILE_TOO_LARGE` | Exceeds 50MB limit |
| 400 | `INVALID_FORMAT` | Unrecognised magic bytes |
| 400 | `MIME_MISMATCH` | Declared type ≠ detected type |
| 401 | — | Missing or invalid JWT |
| 429 | — | Rate limit exceeded |

---

### `GET /api/v1/images/:imageId/urls`

Get fresh signed CloudFront URLs for all variants of an image.

**Query Parameters**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `expiresIn` | integer | `3600` | URL lifetime in seconds (300–86400) |
| `ip` | string | — | Bind URL to a specific IPv4 address |

**Response `200`**
```json
{
  "imageId": "img_3f2a1b4c...",
  "ownerId": "user_123",
  "signedUrls": {
    "thumb":    { "url": "https://d1abc.cloudfront.net/...", "expiresAt": "2024-01-15T11:00:00Z" },
    "small":    { "url": "https://d1abc.cloudfront.net/...", "expiresAt": "2024-01-15T11:00:00Z" },
    "medium":   { "url": "https://d1abc.cloudfront.net/...", "expiresAt": "2024-01-15T11:00:00Z" },
    "large":    { "url": "https://d1abc.cloudfront.net/...", "expiresAt": "2024-01-15T11:00:00Z" },
    "og":       { "url": "https://d1abc.cloudfront.net/...", "expiresAt": "2024-01-15T11:00:00Z" },
    "original": { "url": "https://d1abc.cloudfront.net/...", "expiresAt": "2024-01-15T11:00:00Z" }
  }
}
```

---

### `GET /api/v1/images`

List all images owned by the authenticated user (paginated).

**Query Parameters**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | `20` | Items per page (max 100) |
| `nextKey` | string | — | Cursor from previous response |

**Response `200`**
```json
{
  "images": [ { "imageId": "...", "createdAt": "...", "totalVariants": 6 } ],
  "nextKey": "eyJpbWFnZUlkIjoi...",
  "count": 20
}
```

---

### `DELETE /api/v1/images/:imageId`

Delete an image and all its variants. Removes from S3, invalidates CloudFront cache, and deletes DynamoDB record.

**Response `200`**
```json
{
  "deleted": true,
  "imageId": "img_3f2a1b4c...",
  "message": "Image and all variants deleted"
}
```

---

### `GET /api/v1/health`

Service health check.

**Response `200`**
```json
{ "status": "ok", "timestamp": "2024-01-15T10:00:00Z", "services": { "s3": "ok" } }
```

**Response `503`** (S3 unreachable)
```json
{ "status": "degraded", "services": { "s3": "error" } }
```

---

## 🖼️ Image Variants

Every upload automatically generates these 6 variants:

| Variant | Dimensions | Format | Cache TTL | Use Case |
|---------|-----------|--------|-----------|----------|
| `thumb` | 150×150px (cover crop) | WebP | 30 days | Grid thumbnails, avatars |
| `small` | 400px wide | WebP | 30 days | Mobile feeds |
| `medium` | 800px wide | WebP | 30 days | Standard web display |
| `large` | 1600px wide | WebP | 30 days | Retina / hi-DPI screens |
| `og` | 1200×630px (cover crop) | JPEG | 7 days | Open Graph / Twitter cards |
| `original` | Original dimensions | AVIF | 90 days | Full-res downloads |

All variants are processed in **parallel** in a single libvips pipeline pass. Source pixels are read exactly once regardless of how many variants are generated.

---

## 🔒 Security Model

### Why the client never gets S3 access

```
Client ──→ CloudFront signed URL (RSA-2048, time-limited)
                │
         CloudFront (validates signature at edge)
                │
         S3 via OAC (only CloudFront service principal allowed)
                │
         Private S3 bucket (no public access, no presigned S3 URLs)
```

- **S3 bucket**: All public access blocked. No bucket policy grants public read.
- **OAC (Origin Access Control)**: Only the specific CloudFront distribution can call `s3:GetObject`.
- **Signed URLs**: Signed with your RSA-2048 private key. CloudFront validates with the registered public key. Expiry is baked into the signature — cannot be tampered.
- **IP binding (optional)**: Signed URLs can include an `IpAddress` condition. The URL only works from that IP — protects against URL sharing/theft.
- **JWT auth**: All API endpoints require a valid JWT. Expired, tampered, or missing tokens get a 401.
- **Ownership enforcement**: `getImageRecord(imageId, ownerId)` verifies the requesting user owns the image before returning URLs or allowing deletion.

### Signed URL internals

A CloudFront custom policy looks like:

```json
{
  "Statement": [{
    "Resource": "https://d1abc.cloudfront.net/user_123/img_abc/*",
    "Condition": {
      "DateLessThan": { "AWS:EpochTime": 1718500000 },
      "IpAddress": { "AWS:SourceIp": "203.0.113.5/32" }
    }
  }]
}
```

This is `base64url`-encoded then signed with RSA-SHA1 (CloudFront's algorithm requirement). The private key never leaves the API server.

---

## ⚡ How Cache Works

### Normal flow (cache HIT)

```
Client → CloudFront edge (nearest PoP) → cached response → ~5-10ms
```

### Cache MISS flow

```
Client → CloudFront → S3 (origin fetch) → CloudFront caches → client
```

### Cache invalidation strategies

**Strategy 1 — Key versioning (preferred, zero cost)**

Each upload version gets a new key: `user_123/img_abc/v2/medium.webp`  
Old signed URLs expire naturally. No CloudFront API calls needed.

**Strategy 2 — CloudFront invalidation (fallback)**

```bash
# Invalidates all variants for one image
aws cloudfront create-invalidation \
  --distribution-id E1ABCDEF \
  --paths "/user_123/img_abc/*"
```

Propagates to all 600+ PoPs within ~60 seconds. Free for the first 1,000 paths/month.

---

## ⚙️ Processing Pipeline

```
Buffer (from Multer memory storage)
    │
    ├─── magic byte validation (first 12 bytes only)
    │
    ├─── Sharp metadata read (width, height, format, colorSpace)
    │
    └─── libvips parallel pipeline:
         │
         ├── thumb  → resize(150,150,cover) → strip EXIF → .webp({quality:80})
         ├── small  → resize(400,null,inside) → strip EXIF → .webp({quality:82})
         ├── medium → resize(800,null,inside) → strip EXIF → .webp({quality:85})
         ├── large  → resize(1600,null,inside) → strip EXIF → .webp({quality:87})
         ├── og     → resize(1200,630,cover) → strip EXIF → .jpeg({quality:90})
         └── original → strip EXIF → .avif({quality:78, effort:4})
                │
         All → parallel S3 PutObject (AWS SDK v3 multipart Upload)
                │
         DynamoDB PutItem (metadata record)
```

**Resize algorithms:**
- `cover` — crops to exact dimensions (used for thumb, og)
- `inside` — scales proportionally within the box, no crop (used for small/medium/large)
- `withoutEnlargement: true` — never upscales a small source image

---

## 🧪 Running Tests

```bash
# All tests
npm test

# Unit tests only (no AWS needed)
npm run test:unit

# Integration tests (mocks AWS)
npm run test:integration

# With coverage report
npm run test:coverage

# Watch mode during development
npm run test:watch
```

The test suite mocks all AWS services (`S3`, `DynamoDB`, `CloudFront`) — no real AWS credentials needed to run tests.

---

## 🚢 Deployment

### Option A — AWS App Runner (recommended for simplicity)

```bash
# Build and push Docker image
docker build -t cdn-image-service .
docker tag cdn-image-service:latest <account>.dkr.ecr.ap-south-1.amazonaws.com/cdn-image-service:latest
docker push <account>.dkr.ecr.ap-south-1.amazonaws.com/cdn-image-service:latest

# Create App Runner service via AWS Console
# Point to the ECR image, set environment variables, configure auto-scaling
```

### Option B — EC2 + ALB

```bash
# On EC2 instance
git clone https://github.com/your-username/cdn-image-service.git
cd cdn-image-service
npm ci --production
pm2 start server.js --name cdn-image-service
pm2 save
```

Set up an Application Load Balancer pointing to port 3000. Use the ALB health check at `GET /api/v1/health`.

### Docker

```bash
docker build -t cdn-image-service .
docker run -p 3000:3000 --env-file .env cdn-image-service
```

---

## 💰 Cost Estimate

Based on: 10GB storage, 100GB egress/month, 1M CloudFront requests/month

| Service | Usage | Est. Cost/month |
|---------|-------|----------------|
| S3 Storage | 10GB | ~$0.23 |
| S3 PUT requests | ~100K uploads × 6 variants | ~$0.30 |
| CloudFront requests | 1M | ~$0.75 |
| CloudFront egress | 100GB | ~$8.50 |
| DynamoDB | Pay-per-request, ~1M reads | ~$0.25 |
| **Total** | | **~$10/month** |

Costs scale linearly. At 1TB storage + 10TB egress.
---


---

<p align="center">Built with Node.js · Sharp · AWS S3 · CloudFront · DynamoDB</p>
