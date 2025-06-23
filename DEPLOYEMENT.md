# AI Cost Optimizer Backend - Deployment Guide

## Production Deployment Options

### 1. AWS EC2 Deployment

#### Prerequisites

- AWS Account
- EC2 instance (t3.medium or larger recommended)
- MongoDB Atlas or self-hosted MongoDB
- Domain name (optional)

#### Steps

1. **Launch EC2 Instance**

```bash
# Choose Ubuntu 22.04 LTS
# Security group: Open ports 22 (SSH), 80 (HTTP), 443 (HTTPS), 3000 (API)
```

2. **Connect to Instance**

```bash
ssh -i your-key.pem ubuntu@your-ec2-ip
```

3. **Install Dependencies**

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2
sudo npm install -g pm2

# Install Nginx
sudo apt install nginx -y

# Install Git
sudo apt install git -y
```

4. **Clone and Setup Application**

```bash
# Clone repository
git clone https://github.com/your-org/ai-cost-optimizer-backend.git
cd ai-cost-optimizer-backend

# Install dependencies
npm install

# Build application
npm run build

# Setup environment
cp .env.example .env
nano .env  # Edit with production values
```

5. **Configure PM2**

```bash
# Create ecosystem file
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'ai-cost-optimizer',
    script: './dist/server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true
  }]
}
EOF

# Start application
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

6. **Configure Nginx**

```bash
sudo nano /etc/nginx/sites-available/ai-cost-optimizer

# Add configuration:
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Enable site
sudo ln -s /etc/nginx/sites-available/ai-cost-optimizer /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

7. **Setup SSL with Let's Encrypt**

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d your-domain.com
```

### 2. AWS ECS Deployment

#### Prerequisites

- AWS Account
- ECR repository
- ECS cluster
- Application Load Balancer

#### Steps

1. **Build and Push Docker Image**

```bash
# Build image
docker build -t ai-cost-optimizer .

# Tag for ECR
docker tag ai-cost-optimizer:latest YOUR_ECR_URI/ai-cost-optimizer:latest

# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin YOUR_ECR_URI

# Push image
docker push YOUR_ECR_URI/ai-cost-optimizer:latest
```

2. **Create Task Definition**

```json
{
  "family": "ai-cost-optimizer",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "ai-cost-optimizer",
      "image": "YOUR_ECR_URI/ai-cost-optimizer:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        }
      ],
      "secrets": [
        {
          "name": "MONGODB_URI",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:mongodb-uri"
        },
        {
          "name": "JWT_SECRET",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:jwt-secret"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/ai-cost-optimizer",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

3. **Create ECS Service**

```bash
aws ecs create-service \
  --cluster your-cluster \
  --service-name ai-cost-optimizer \
  --task-definition ai-cost-optimizer:1 \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=ai-cost-optimizer,containerPort=3000"
```

### 3. Kubernetes Deployment

#### Prerequisites

- Kubernetes cluster (EKS, GKE, AKS, or self-hosted)
- kubectl configured
- Helm (optional)

#### Deployment Files

1. **Create Namespace**

```yaml
# namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: ai-cost-optimizer
```

2. **Create ConfigMap**

```yaml
# configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: ai-cost-optimizer-config
  namespace: ai-cost-optimizer
data:
  NODE_ENV: "production"
  PORT: "3000"
```

3. **Create Secret**

```yaml
# secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: ai-cost-optimizer-secrets
  namespace: ai-cost-optimizer
type: Opaque
stringData:
  MONGODB_URI: "mongodb://..."
  JWT_SECRET: "your-secret"
  AWS_ACCESS_KEY_ID: "your-key"
  AWS_SECRET_ACCESS_KEY: "your-secret"
```

4. **Create Deployment**

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-cost-optimizer
  namespace: ai-cost-optimizer
spec:
  replicas: 3
  selector:
    matchLabels:
      app: ai-cost-optimizer
  template:
    metadata:
      labels:
        app: ai-cost-optimizer
    spec:
      containers:
      - name: ai-cost-optimizer
        image: your-registry/ai-cost-optimizer:latest
        ports:
        - containerPort: 3000
        envFrom:
        - configMapRef:
            name: ai-cost-optimizer-config
        - secretRef:
            name: ai-cost-optimizer-secrets
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /api/health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
```

5. **Create Service**

```yaml
# service.yaml
apiVersion: v1
kind: Service
metadata:
  name: ai-cost-optimizer-service
  namespace: ai-cost-optimizer
spec:
  selector:
    app: ai-cost-optimizer
  ports:
    - protocol: TCP
      port: 80
      targetPort: 3000
  type: LoadBalancer
```

6. **Deploy to Kubernetes**

```bash
kubectl apply -f namespace.yaml
kubectl apply -f configmap.yaml
kubectl apply -f secret.yaml
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
```

## Environment Variables

### Required for Production

```env
# Server
NODE_ENV=production
PORT=3000

# Database
MONGODB_URI_PROD=mongodb+srv://...

# Security
JWT_SECRET=<strong-random-string>
JWT_REFRESH_SECRET=<another-strong-random-string>
ENCRYPTION_KEY=<32-character-key>

# AWS
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<your-key>
AWS_SECRET_ACCESS_KEY=<your-secret>

# Email
GMAIL_CLIENT_ID=<oauth-client-id>
GMAIL_CLIENT_SECRET=<oauth-client-secret>
GMAIL_REFRESH_TOKEN=<oauth-refresh-token>

# CORS
CORS_ORIGIN=https://your-frontend-domain.com
```

## Database Setup

### MongoDB Atlas

1. Create cluster at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Configure network access (whitelist IPs)
3. Create database user
4. Get connection string
5. Update MONGODB_URI_PROD in environment

### Self-hosted MongoDB

1. Install MongoDB on server
2. Enable authentication
3. Create database and user:

```javascript
use ai-cost-optimizer
db.createUser({
  user: "appuser",
  pwd: "strong-password",
  roles: [{role: "readWrite", db: "ai-cost-optimizer"}]
})
```

4. Enable replication for production

## Monitoring

### CloudWatch (AWS)

Automatic with AWS deployment. Metrics sent include:

- API usage by service/model
- Error rates
- Response times

### Prometheus + Grafana

1. Add metrics endpoint:

```typescript
// Add to app.ts
import promClient from 'prom-client';

app.get('/metrics', (req, res) => {
  res.set('Content-Type', promClient.register.contentType);
  res.end(promClient.register.metrics());
});
```

2. Configure Prometheus scraping
3. Create Grafana dashboards

## Security Best Practices

1. **Use Environment Variables**
   - Never commit secrets
   - Use secret management services

2. **Enable HTTPS**
   - Use SSL certificates
   - Redirect HTTP to HTTPS

3. **Configure CORS**
   - Restrict to known domains
   - Don't use wildcard in production

4. **Rate Limiting**
   - Already configured in app
   - Adjust limits based on usage

5. **Regular Updates**
   - Keep dependencies updated
   - Security patches

6. **Backup Strategy**
   - Regular MongoDB backups
   - Store in different region

## Scaling Considerations

1. **Horizontal Scaling**
   - Use PM2 cluster mode
   - Multiple ECS tasks
   - Kubernetes replicas

2. **Database Scaling**
   - MongoDB replica sets
   - Read replicas for analytics
   - Consider sharding for large scale

3. **Caching**
   - Redis for session storage
   - Cache analytics results
   - API response caching

4. **CDN**
   - CloudFront for static assets
   - API caching where appropriate

## Troubleshooting

### Common Issues

1. **Connection Timeouts**
   - Check security groups
   - Verify MongoDB whitelist
   - Check network connectivity

2. **High Memory Usage**
   - Monitor with PM2/CloudWatch
   - Adjust Node.js heap size
   - Check for memory leaks

3. **Slow Queries**
   - Check MongoDB indexes
   - Enable query profiling
   - Optimize aggregation pipelines

### Logs

- Application logs: `/logs` directory
- PM2 logs: `pm2 logs`
- Docker logs: `docker logs <container>`
- Kubernetes logs: `kubectl logs <pod>`

## Maintenance

### Regular Tasks

1. **Weekly**
   - Check error logs
   - Monitor disk usage
   - Review metrics

2. **Monthly**
   - Update dependencies
   - Review security alerts
   - Optimize database

3. **Quarterly**
   - Performance review
   - Cost optimization
   - Disaster recovery test
