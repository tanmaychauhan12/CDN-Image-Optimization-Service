# CDN Image Optimization Service - Deployment Guide

This document provides a comprehensive blueprint for configuring, deploying, and estimating the cost of the CDN Image Optimization Service in production.

---

## 1. AWS Prerequisites Checklist & Commands

### A. IAM Permissions Needed
To run the service, your IAM User or EC2/App Runner Execution Role requires a policy with the following permissions:
*   **S3**: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket`, `s3:HeadBucket`
*   **DynamoDB**: `dynamodb:PutItem`, `dynamodb:GetItem`, `dynamodb:DeleteItem`, `dynamodb:Query`
*   **CloudFront**: `cloudfront:CreateInvalidation`

### B. S3 Bucket Creation
Create the S3 bucket where optimized image variants will be stored. Replace `cdn-image-service-bucket` with your globally unique bucket name.

```bash
# Create the S3 Bucket (Region default is ap-south-1, adjust as necessary)
aws s3api create-bucket \
  --bucket cdn-image-service-bucket \
  --region ap-south-1 \
  --create-bucket-configuration LocationConstraint=ap-south-1

# Block all direct public access (traffic should only flow through CloudFront OAC/OAI)
aws s3api put-public-access-block \
  --bucket cdn-image-service-bucket \
  --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

### C. DynamoDB Table Configuration (Schema)
Create the DynamoDB table with `imageId` as the Partition Key, `ownerId` as the Sort Key, and a Global Secondary Index (GSI) named `ownerId-createdAt-index` to support listing user images sorted by creation date.

```bash
aws dynamodb create-table \
  --table-name cdn-image-service-metadata \
  --attribute-definitions \
      AttributeName=imageId,AttributeType=S \
      AttributeName=ownerId,AttributeType=S \
      AttributeName=createdAt,AttributeType=S \
  --key-schema \
      AttributeName=imageId,KeyType=HASH \
      AttributeName=ownerId,KeyType=RANGE \
  --global-secondary-indexes \
      "[
        {
          \"IndexName\": \"ownerId-createdAt-index\",
          \"KeySchema\": [
            {\"AttributeName\": \"ownerId\", \"KeyType\": \"HASH\"},
            {\"AttributeName\": \"createdAt\", \"KeyType\": \"RANGE\"}
          ],
          \"Projection\": {
            \"ProjectionType\": \"ALL\"
          },
          \"ProvisionedThroughput\": {
            \"ReadCapacityUnits\": 5,
            \"WriteCapacityUnits\": 5
          }
        }
      ]" \
  --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5
```

### D. CloudFront Key Pair & Key Group Setup
CloudFront signed URLs require an RSA key pair.
1.  **Generate RSA private and public keys locally**:
    ```bash
    # Generate private key (2048-bit RSA)
    openssl genrsa -out cloudfront-private-key.pem 2048

    # Extract the public key in PEM format
    openssl rsa -pubout -in cloudfront-private-key.pem -out cloudfront-public-key.pem
    ```
2.  **Upload to AWS CloudFront**:
    *   Go to **AWS Console** -> **CloudFront** -> **Public Keys** -> **Create public key**.
    *   Paste the contents of `cloudfront-public-key.pem`.
    *   Record the generated **Key ID** (e.g., `K12345ABCDE678`).
3.  **Add Key to a Key Group**:
    *   Go to **Key Groups** -> **Create key group**.
    *   Select the public key uploaded in Step 2, and create the group. Use this group to restrict viewer access in your CloudFront Cache Behavior.

---

## 2. Environment Variables Reference Table

| Variable Name | Required? | Example Value | Description | Where to Find / How to Generate |
| :--- | :---: | :--- | :--- | :--- |
| `PORT` | No | `5000` | Port the Express server listens on. Defaults to `5000`. | User choice. |
| `NODE_ENV` | No | `production` | Deployment environment context. | Set to `production` or `development`. |
| `JWT_SECRET` | **Yes** | `super-secret-key-phrase` | Secret phrase used to sign and verify JSON Web Tokens. | Generate a strong cryptographic phrase. |
| `AWS_REGION` | **Yes** | `ap-south-1` | AWS deployment region. | e.g. `ap-south-1`, `us-east-1`. |
| `AWS_ACCESS_KEY_ID` | Cond. | `AKIAIOSFODNN7EXAMPLE` | IAM access credential. (Omit if using IAM roles). | IAM Management Console -> Users -> Security credentials. |
| `AWS_SECRET_ACCESS_KEY`| Cond. | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`| IAM secret credential. (Omit if using IAM roles). | IAM Management Console -> Users -> Security credentials. |
| `S3_BUCKET_NAME` | **Yes** | `cdn-image-service-bucket` | Target S3 bucket for variant uploads. | Name chosen during S3 bucket creation. |
| `DYNAMODB_TABLE_NAME` | **Yes** | `cdn-image-service-metadata`| Target DynamoDB table name. | Name chosen during DynamoDB creation. |
| `CLOUDFRONT_DOMAIN` | **Yes** | `d111111abcdef8.cloudfront.net`| CloudFront CDN domain name. | CloudFront Console -> Distributions list. |
| `CLOUDFRONT_KEY_PAIR_ID`| **Yes** | `K12345ABCDE678` | ID of the uploaded CloudFront public key. | CloudFront Console -> Public Keys list. |
| `CLOUDFRONT_DISTRIBUTION_ID`| **Yes** | `EDFDV2651EXAMPLE` | Distribution ID to target for path cache invalidations. | CloudFront Console -> Distributions list. |
| `CLOUDFRONT_PRIVATE_KEY_PATH`| **Yes** | `./keys/cloudfront-private-key.pem`| Path to the local CloudFront RSA private key file. | Key file generated via `openssl`. |
| `REDIS_URL` | No | `redis://localhost:6379` | Connection URI for the rate limit backing store. | Redis cluster endpoint or local URI. |

---

## 3. Local Development Startup Sequence

Follow these steps to configure and run the service locally:

1.  **Clone the Repository and Install Dependencies**:
    ```bash
    npm install
    ```
2.  **Configure Environment**:
    *   Copy the `.env.example` file to create your own configuration file:
        ```bash
        cp .env.example .env
        ```
    *   Edit `.env` to supply valid AWS credentials, table names, and JWT secret.
3.  **Configure Security Keys**:
    *   Place the generated CloudFront private key file (`cloudfront-private-key.pem`) inside the `./keys/` directory. Ensure the path matches the `CLOUDFRONT_PRIVATE_KEY_PATH` environment variable.
4.  **Launch Local Redis (Optional)**:
    *   If using Redis for rate limiting, ensure it is running (e.g. `docker run -d -p 6379:6379 redis:alpine`). If omitted, the rate limiter falls back to memory-based limiting.
5.  **Run Development Server**:
    ```bash
    npm run dev
    ```
6.  **Run Tests**:
    ```bash
    npm test
    ```

---

## 4. Production Deployment Notes

For a production deployment, containerizing the application and utilizing AWS managed hosting is recommended:

### Containerization (Dockerfile Suggestion)
Create a `Dockerfile` at the project root:
```dockerfile
FROM node:20-alpine
WORKDIR /usr/src/app
# Sharp requires C++ build dependencies on some architectures
RUN apk add --no-cache python3 make g++ gcc
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 5000
CMD ["node", "server.js"]
```

### Hosting Architecture Options

#### Option A: AWS App Runner (Recommended)
*   **Benefits**: Fully managed container runner, automatic TLS certificates via ACM, scale-to-zero capability, and built-in load balancing.
*   **Deployment Flow**:
    1.  Push your container image to **AWS Elastic Container Registry (ECR)**.
    2.  Create a new App Runner service sourcing the ECR image.
    3.  Assign an **IAM Instance Role** with permissions to access the S3 bucket and DynamoDB table.
    4.  Configure environment variables directly in the App Runner Service dashboard.
    5.  Set the health check path to `/api/v1/health`.

#### Option B: AWS Elastic Container Service (ECS) Fargate behind Application Load Balancer (ALB)
*   **Benefits**: Advanced routing configurations, VPC networking, cross-service integration, and auto-scaling.
*   **Deployment Flow**:
    1.  Configure an ALB inside a public subnet, terminating HTTPS using ACM certificates.
    2.  Set up an ECS cluster using Fargate in private subnets.
    3.  Mount Fargate tasks behind the ALB target group pointing to the container's EXPOSE port (`5000`).
    4.  Verify tasks have IAM Execution and Task Roles configured for AWS API integrations.

---

## 5. Estimate of Monthly AWS Costs

Estimated cost layout for:
*   **Storage**: `10 GB`
*   **Egress (Data Transfer Out)**: `100 GB/month`
*   **Requests**: `1 Million CloudFront requests/month`

### Scenario A: Within AWS Free Tier (New Account)
AWS offers generous Free Tiers that cover this scale completely.

| Service | Usage Metric | Free Tier Allowance | Monthly Cost |
| :--- | :--- | :--- | :--- |
| **AWS CloudFront** | 100 GB Egress, 1M Requests | 1 TB Egress/mo, 10M requests/mo (Always Free) | **$0.00** |
| **Amazon S3** | 10 GB Storage, ~200k API operations | 5 GB Standard Storage/mo (12 Months Free) | **$0.12** (Storage > 5GB) |
| **Amazon DynamoDB**| 10 GB Storage, ~1M Read/Write Ops | 25 GB Storage, 25 WCU/RCU Provisioned (Always Free) | **$0.00** |
| **Total** | | | **$0.12 / month** |

### Scenario B: Standard AWS Pricing (No Free Tier)
Assuming pricing in the `ap-south-1` (Mumbai) region:

1.  **Amazon S3 Standard Storage**:
    *   Storage: 10 GB × $0.023/GB = **$0.23**
    *   API Operations (assuming 10k uploads/month = 60k PUT requests): 60,000 × $0.005/1000 = **$0.30**
    *   *Subtotal S3*: **$0.53**
2.  **AWS CloudFront**:
    *   Data Transfer Out (Egress to Internet): 100 GB × $0.085/GB = **$8.50**
    *   Request Costs: 1,000,000 requests × $0.009/10,000 = **$0.90**
    *   *Subtotal CloudFront*: **$9.40**
3.  **Amazon DynamoDB (On-Demand Capacity)**:
    *   Storage: 10 GB (First 25 GB is free under Always Free, otherwise $0.25/GB) = **$0.00**
    *   Write Requests: ~60k WRUs = **$0.08**
    *   Read Requests: ~1M RRUs = **$0.25**
    *   *Subtotal DynamoDB*: **$0.33**
4.  **AWS CloudFront Invalidation Charges**:
    *   First 1,000 paths submitted for invalidation per month are free. Assuming fewer than 1,000 image deletions/month = **$0.00**

### Total Monthly Estimate (Outside Free Tier): **~$10.26 / month**
