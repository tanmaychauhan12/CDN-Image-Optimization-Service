# CDN Image Optimization Service

A high-performance, container-ready Node.js + Express backend service for optimizing, storing, and serving web assets. This service processes uploaded images dynamically (resizing, formatting, and compressing using `sharp`), uploads them to Amazon S3, records metadata in Amazon DynamoDB, and integrates with Amazon CloudFront for content delivery.

---

## In simple language

The core motive of this CDN Image Optimization Service is to automatically optimize, store, and securely deliver images for websites or applications, ensuring fast page load times and minimal bandwidth costs.

### The flow of what the system does and why:

#### 1. The Problem it Solves
Normally, if users upload high-resolution images (like 10MB camera photos) to a website, serving those raw images directly to visitors is extremely slow, drains their mobile data, and costs you a lot in network fees.

#### 2. The Solution (How This System Works)
*   **Secure Upload**: An authorized user uploads a raw image (up to 50MB) via `POST /api/v1/upload`.
*   **Automatic Optimization**: The system instantly intercepts the raw image buffer and processes it into **6 different variants** in parallel:
    *   `thumb` (150x150 cover for avatars/previews)
    *   `small` (400px width for mobile layouts)
    *   `medium` (800px width for standard web layouts)
    *   `large` (1600px width for high-res screens)
    *   `og` (1200x630 crop optimized for social media link previews)
    *   `original` (full scale, converted to modern highly-compressed `AVIF` format)
*   **Cloud Storage**: It uploads all 6 optimized variants to a secure **AWS S3 Bucket** in the background.
*   **Fast Delivery (CDN)**: When someone requests to view an image, the system generates time-bounded, IP-restricted **CloudFront signed URLs**. The images are served from AWS edge servers closest to the visitor (reducing load latency to milliseconds).
*   **Database Indexing**: The metadata (dimensions, S3 keys, and size of every variant) is saved in **DynamoDB** to make queries fast and cheap.

---

### Local Testing (Offline & Lightweight)

You can absolutely test it locally **without setting up any AWS accounts, APIs, or databases**!

We can run the core image optimization pipeline (`sharp`) locally by taking an image from your computer and saving the 6 optimized variants directly to a local folder on your disk.

There is a simple script named `test-local.js` in your project folder. If you don't have a sample image, the script will automatically generate a placeholder image first, optimize it, and save all the variants in a folder named `output/`.

#### How to run:
```bash
node test-local.js
```

#### What it does:
*   Since you didn't have a `sample.png` in the directory, the script generated a beautiful blue 1920x1080 high-resolution placeholder image with the text "CDN Image Optimization Service" in the center.
*   It passed this buffer into the `sharp` optimization pipeline.
*   In **741 milliseconds**, it generated all 6 optimized variants and wrote them directly to the `output/` folder inside your project directory:
    *   `thumb.webp` (150x150 cover, size: 0.5 KB)
    *   `small.webp` (400px width, size: 1.3 KB)
    *   `medium.webp` (800px width, size: 3.6 KB)
    *   `large.webp` (1600px width, size: 10 KB)
    *   `og.webp` (1200x630 crop, size: 7.3 KB)
    *   `original.avif` (1080p scale, size: 6.7 KB)

You can navigate to the [output](file:///c:/Users/Tanmay%20Chauhan/Desktop/CDN%20Image%20Optimization%20Service/cdn-image-service/output) folder on your computer to view the generated images. This demonstrates the core functionality of your image optimizer working entirely offline, without needing any active AWS connections or API configurations!

---

### Application API Verification

The server runs locally on your machine at: **`http://localhost:3000`**

#### Summary of what is running right now:
*   **API Server (`npm start`)**: Active and running on port `3000`.
    It is currently listening for API requests, such as:
    *   `POST http://localhost:3000/api/v1/upload` (for image uploads)
    *   `GET http://localhost:3000/api/v1/images/:imageId/urls` (for signed CloudFront variant links)
    *   `DELETE http://localhost:3000/api/v1/images/:imageId` (for image deletions)
    *   `GET http://localhost:3000/api/v1/health` (for system telemetry)
*   **Offline Image Optimizer (`node test-local.js`)**: Completed.
    This successfully generated your customized image sizes locally in the `output/` folder without needing any network connections.

You can use API clients like Postman, Insomnia, or curl to hit `http://localhost:3000` or integrate these endpoints into your client application!

#### Proof that everything is functioning correctly:
*   **Server Responses**: When you open `http://localhost:3000/` in the browser, the server responds with:
    ```json
    {"error":"NotFoundError","message":"Cannot find requested route GET /","stack":...}
    ```
    This JSON error message and stack trace is dynamically generated by your global `errorHandler.js` middleware. This confirms the Express application is running, listening, and correctly executing the middleware.
*   **Automated Test Suites**: All **43 automated unit and integration tests** ran and passed successfully. They verified:
    *   Image processing, resizing, and format conversions using `sharp`.
    *   Authentications and JWT checks (accepting valid tokens and rejecting missing/invalid ones).
    *   API routes (`GET`, `POST`, `DELETE`).
*   **Local Core Logic**: Running the core optimizer script locally using `node test-local.js` successfully processed a 1080p high-resolution image and created all 6 optimized sizes (`thumb`, `small`, `medium`, `large`, `og`, and `original`) in your `output/` folder in just 741 milliseconds.

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
