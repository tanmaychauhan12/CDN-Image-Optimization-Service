# CDN Image Optimization Service

A high-performance, container-ready Node.js + Express backend service for optimizing, storing, and serving web assets. This service processes uploaded images dynamically (resizing, formatting, and compressing using `sharp`), uploads them to Amazon S3, records metadata in Amazon DynamoDB, and integrates with Amazon CloudFront for content delivery.

## Key Features

- **Dynamic Image Optimization**: Resize, convert formats (WebP, AVIF, PNG, JPEG), and compress quality on-the-fly using `sharp`.
- **Cloud Storage Integration**: Store optimized images securely in Amazon S3.
- **CDN Signed URLs**: Generate pre-signed CloudFront URLs for secure access to private assets.
- **Metadata Management**: Index and query image metadata (dimensions, sizes, MIME types, processing durations) in DynamoDB.
- **API Security**: Secure upload and fetch actions using JWT authentication.
- **Robust Infrastructure**: Production-ready logging with Winston, validation using Joi, error handling middleware, and rate-limiting.

---

## Directory Structure

```
cdn-image-service/
├── keys/
│   └── .gitkeep        # Store CloudFront RSA private key here
├── src/
│   ├── routes/
│   │   ├── health.js   # Health check endpoints
│   │   ├── upload.js   # File uploading logic
│   │   └── images.js   # Retrieve image metadata / signed URLs
│   ├── middleware/
│   │   ├── auth.js     # JWT token validation
│   │   ├── rateLimit.js# Rate limiting configuration (supports Redis)
│   │   └── errorHandler.js # Global error handling middleware
│   ├── services/
│   │   ├── sharpService.js      # Image processing engine
│   │   ├── s3Service.js         # Amazon S3 operations wrapper
│   │   ├── cloudFrontService.js # CloudFront signed URL generator
│   │   └── metadataService.js   # DynamoDB queries & operations
│   ├── validators/
│   │   └── imageValidator.js    # Joi schema definitions
│   ├── utils/
│   │   ├── logger.js            # Structured logger (Winston)
│   │   └── generateId.js        # UUID generator wrapper
│   └── app.js          # Express app configuration & initialization
├── tests/
│   ├── unit/           # Unit tests
│   └── integration/    # Integration tests
├── .env.example        # Environment variables template
├── .gitignore          # Git exclusion rules
├── package.json        # Node.js dependencies and scripts
├── server.js           # Server runner/entry point
└── README.md           # Documentation
```

---

## Getting Started

### Prerequisites

- Node.js (version 18 or higher recommended)
- npm or yarn
- A running Redis server (for rate limiting, optional, defaults to memory store)
- AWS Account with S3 bucket, DynamoDB Table, and CloudFront distribution set up

### Installation

1. Clone or navigate to the repository directory.
2. Install dependencies:
   ```bash
   npm install
   ```

### Configuration

Create a `.env` file in the root directory and populate it with your configuration (based on `.env.example`):

```env
PORT=3000
JWT_SECRET=your_jwt_secret_key_here
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
S3_BUCKET_NAME=your_s3_bucket_name
CLOUDFRONT_DOMAIN=your_cloudfront_distribution_domain
CLOUDFRONT_KEY_PAIR_ID=your_cloudfront_key_pair_id
CLOUDFRONT_PRIVATE_KEY_PATH=./keys/cloudfront-private-key.pem
DYNAMODB_TABLE_NAME=cdn-image-service
REDIS_URL=redis://localhost:6379
```

> **Note**: Place your CloudFront RSA private key in `keys/cloudfront-private-key.pem`.

### Running the Application

- **Development Mode** (with hot reloading via nodemon):
  ```bash
  npm run dev
  ```
- **Production Mode**:
  ```bash
  npm start
  ```

---

## Running Tests

We use Jest and Supertest for testing.

- Run all tests:
  ```bash
  npm test
  ```

---

## API Endpoints

All APIs are prefixed with `/api/v1`.

### 1. Health Checks
- `GET /api/v1/health` - Check health status of the application and integrations.

### 2. Upload Image
- `POST /api/v1/upload` - Upload an image file.
  - **Headers**: `Authorization: Bearer <token>`
  - **Body (form-data)**:
    - `image`: The file to upload.
    - `width` (optional): Width to resize to.
    - `height` (optional): Height to resize to.
    - `format` (optional): Target format (webp, png, jpeg, avif).
    - `quality` (optional): Output quality (1-100).

### 3. Retrieve Image Details & URLs
- `GET /api/v1/images/:id` - Fetch image metadata.
- `GET /api/v1/images/:id/url` - Generate an optimized image S3 pre-signed URL or CloudFront signed URL.
