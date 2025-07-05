# AI Cost Optimizer Backend

A comprehensive TypeScript backend service for tracking, analyzing, and optimizing AI API usage costs across multiple providers.

## Features

- 🔐 **Authentication & Authorization**: JWT-based auth with refresh tokens
- 📊 **Usage Tracking**: Track API calls, tokens, and costs across providers
- 📈 **Advanced Analytics**: Real-time analytics with trends and predictions
- 🤖 **AI-Powered Optimization**: Uses AWS Bedrock for intelligent prompt optimization
- 📧 **Email Alerts**: Gmail integration for cost alerts and reports
- 📉 **Anomaly Detection**: Automatic detection of usage anomalies
- 🔄 **Real-time Metrics**: CloudWatch integration for monitoring
- 🎯 **Multi-Provider Support**: OpenAI, AWS Bedrock, Google AI, Anthropic, and more

## 🎯 Key Features

### 🧠 Proactive Intelligence & Quality Assurance (New!)

Transform your cost optimization with intelligent guidance:

- **🎯 Contextual Tips**: Real-time suggestions based on your usage patterns
  - Smart detection of optimization opportunities
  - Priority-based recommendations
  - Interactive actions to apply optimizations instantly

- **📊 Quality Scoring**: Ensure optimizations don't compromise output quality
  - AI-powered quality assessment
  - Before/after comparison
  - User feedback collection
  - Multi-criteria evaluation (accuracy, relevance, completeness)

- **🧙 Cost Audit Wizard**: Interactive step-by-step optimization guide
  - Analyzes your usage patterns
  - Identifies cost-saving opportunities
  - Configures optimizations automatically
  - Estimates potential savings

- **💡 Smart Recommendations**:
  - High token usage alerts (>4000 tokens)
  - Expensive model warnings
  - Unused feature notifications
  - Pattern-based suggestions

[Learn more about Proactive Intelligence →](docs/PROACTIVE_INTELLIGENCE.md)

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT with bcrypt
- **AI Services**: AWS Bedrock (Claude 3.5 Sonnet)
- **Email**: Gmail API with OAuth2
- **Monitoring**: AWS CloudWatch
- **Validation**: Zod
- **Core Package**: `ai-cost-tracker`

## Prerequisites

- Node.js 18+ and npm
- MongoDB 5.0+
- AWS Account with Bedrock access
- Gmail account with OAuth2 credentials
- AI Cost Optimizer Core package installed

## Installation

1. Clone the repository:
```bash
git clone https://github.com/your-org/ai-cost-optimizer-backend.git
cd ai-cost-optimizer-backend
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Install the core package:
```bash
npm install ai-cost-tracker@latest
```

## Configuration

### Environment Variables

Key environment variables to configure:

```env
# Server
PORT=3000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/ai-cost-optimizer

# JWT
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=7d

# AWS
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
AWS_BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0

# Gmail
GMAIL_CLIENT_ID=your-client-id
GMAIL_CLIENT_SECRET=your-client-secret
GMAIL_REFRESH_TOKEN=your-refresh-token
GMAIL_USER_EMAIL=your-email@gmail.com
```

### MongoDB Setup

Ensure MongoDB is running and accessible. The application will automatically create required indexes on startup.

### AWS Bedrock Setup

1. Enable Bedrock in your AWS account
2. Request access to Claude 3.5 Sonnet model
3. Create IAM credentials with Bedrock access

### Gmail OAuth Setup

1. Create a project in Google Cloud Console
2. Enable Gmail API
3. Create OAuth2 credentials
4. Get refresh token using OAuth playground

## Running the Application

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

### Testing

```bash
npm test
npm run test:watch
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout user
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password/:token` - Reset password
- `GET /api/auth/verify-email/:token` - Verify email

### Usage Tracking
- `POST /api/usage` - Track API usage
- `GET /api/usage` - Get usage history
- `GET /api/usage/stats` - Get usage statistics
- `GET /api/usage/anomalies` - Detect anomalies
- `GET /api/usage/export` - Export usage data

### Analytics
- `GET /api/analytics` - Get analytics data
- `POST /api/analytics/compare` - Compare periods
- `GET /api/analytics/insights` - Get AI insights
- `GET /api/analytics/dashboard` - Get dashboard data

### Optimization
- `POST /api/optimizations` - Create optimization
- `GET /api/optimizations` - List optimizations
- `POST /api/optimizations/:id/apply` - Apply optimization
- `POST /api/optimizations/:id/feedback` - Provide feedback
- `GET /api/optimizations/opportunities` - Analyze opportunities

### User Management
- `GET /api/users/profile` - Get user profile
- `PUT /api/users/profile` - Update profile
- `GET /api/users/api-keys` - List API keys
- `POST /api/users/api-keys` - Add API key
- `DELETE /api/users/api-keys/:service` - Remove API key
- `GET /api/users/alerts` - Get alerts
- `GET /api/users/subscription` - Get subscription info

## Architecture

### Directory Structure

```
src/
├── config/          # Configuration files
├── controllers/     # Request handlers
├── middleware/      # Express middleware
├── models/         # MongoDB models
├── routes/         # API routes
├── services/       # Business logic
├── types/          # TypeScript types
├── utils/          # Utility functions
├── app.ts          # Express app setup
└── server.ts       # Server entry point
```

### Key Services

1. **AuthService**: Handles authentication and authorization
2. **UsageService**: Tracks and manages API usage
3. **AnalyticsService**: Provides analytics and insights
4. **OptimizationService**: AI-powered prompt optimization
5. **BedrockService**: AWS Bedrock integration
6. **EmailService**: Gmail integration for notifications

## Security

- JWT tokens with refresh token rotation
- Password hashing with bcrypt
- Rate limiting on all endpoints
- Input validation and sanitization
- API key encryption at rest
- CORS protection
- Helmet.js for security headers

## Monitoring

The application integrates with AWS CloudWatch for:
- API latency tracking
- Error rate monitoring
- Custom metrics
- Usage patterns

## Error Handling

- Centralized error handling middleware
- Detailed error logging with Winston
- Client-friendly error responses
- Automatic error recovery

## Performance

- Database indexing for optimal queries
- Response compression
- Connection pooling
- Caching strategies
- Pagination on all list endpoints

## Deployment

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

### PM2

```bash
pm2 start dist/server.js --name ai-cost-optimizer
pm2 save
pm2 startup
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see LICENSE file for details

## Support

For support, email support@aicostoptimizer.com or create an issue in the repository.# ai-cost-optimizer-backend
