# 🤖 Cost Katana Backend - AI-Powered Cost Intelligence

> **The world's first AI-powered cost optimization coach for AI usage** - featuring intelligent monitoring, personalized recommendations, predictive analytics, and seamless onboarding.

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://github.com/cost-katana/costkatana-backend)
[![Node Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![AI-Powered](https://img.shields.io/badge/AI--Powered-AWS%20Bedrock-orange.svg)](https://aws.amazon.com/bedrock/)

## 🌟 **Revolutionary AI-Powered Features**

### 🧬 **Intelligent Monitoring & Personalization**
- **🎯 AI User Profiling**: Automatically creates detailed user profiles based on usage patterns
- **📊 Predictive Analytics**: AI forecasts spending trends and prevents limit overruns  
- **🤖 Personalized Coaching**: Every recommendation tailored to user's technical level and cost sensitivity
- **🔮 Smart Forecasting**: Predicts when users will hit ChatGPT limits with confidence scores
- **💡 Context-Aware Tips**: Real-time optimization suggestions based on conversation content

### 🚀 **Seamless Integration Experience**
- **✨ Magic Link Onboarding**: Zero-friction 1-click setup for new users
- **🤖 ChatGPT Custom GPT**: Direct integration with personalized AI tips in ChatGPT
- **📧 AI-Enhanced Emails**: Personalized weekly digests with AI-generated insights
- **⚡ Real-Time Intelligence**: Background AI analysis with instant recommendations

### 🎯 **AI-Powered Cost Optimization**
- **🧠 Pattern Recognition**: AI identifies inefficient usage patterns automatically
- **💰 Smart Savings**: Personalized cost reduction strategies with predicted savings
- **🎨 Model Suggestions**: AI recommends optimal models based on use case analysis
- **📈 Efficiency Scoring**: AI-calculated efficiency scores with specific improvements

## 🏗️ **Architecture Overview**

```
┌─────────────────────────────────────────────────────────────────┐
│                    🚀 Cost Katana AI Backend                    │
├─────────────────┬─────────────────┬─────────────────────────────┤
│   🤖 AI Layer   │  🌐 API Layer   │     📊 Data Layer          │
├─────────────────┼─────────────────┼─────────────────────────────┤
│ • Bedrock AI    │ • Express.js    │ • MongoDB                   │
│ • Intelligence  │ • REST APIs     │ • Redis Cache               │
│ • Personalization│ • WebSockets   │ • Usage Analytics           │
│ • Forecasting   │ • Rate Limiting │ • User Profiles             │
└─────────────────┴─────────────────┴─────────────────────────────┘
```

## 🎯 **Core Features**

### 🤖 **AI Intelligence Engine**
- **AWS Bedrock Integration**: Powered by Claude 3.5 Sonnet for sophisticated analysis
- **Usage Pattern Analysis**: AI detects trends, inefficiencies, and optimization opportunities
- **Personalized Recommendations**: Every tip tailored to individual usage style and preferences
- **Predictive Monitoring**: Forecasts usage patterns and prevents costly surprises
- **Intelligent Coaching**: Proactive guidance that learns from user behavior

### 🔗 **Platform Integrations**
- **ChatGPT Custom GPT**: Direct integration with AI-powered tips in ChatGPT interface
- **Magic Link Onboarding**: Seamless user setup with automatic account creation
- **Real-Time API Tracking**: Automatic usage monitoring across all AI providers
- **Multi-Provider Support**: OpenAI, AWS Bedrock, Anthropic, Google AI, and more

### 📊 **Advanced Analytics**
- **Real-Time Dashboards**: Live usage monitoring with AI insights
- **Predictive Analytics**: ML-powered forecasting and trend analysis  
- **Cost Optimization Reports**: AI-generated savings opportunities
- **Usage Intelligence**: Deep insights into spending patterns and efficiency

### 🚨 **Proactive Monitoring**
- **Multi-Tier Alerts**: 50%, 80%, 90% usage thresholds with personalized messaging
- **Email Intelligence**: AI-enhanced weekly digests with actionable insights
- **Limit Predictions**: Advanced forecasting prevents unexpected limit hits
- **Smart Notifications**: Context-aware alerts with specific optimization advice

## 🚀 **Quick Start**

### Prerequisites
- **Node.js 18+** with npm
- **MongoDB 5.0+** database
- **AWS Account** with Bedrock access (for AI features)
- **Gmail Account** with OAuth2 credentials (for intelligent emails)

### Installation

```bash
# Clone the repository
git clone https://github.com/cost-katana/costkatana-backend.git
cd costkatana-backend

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration (see Environment Setup below)

# Build TypeScript
npm run build

# Start development server
npm run dev
```

The server will start at `http://localhost:8000` with AI intelligence features enabled.

## ⚙️ **Environment Setup**

### 🔑 **Required Environment Variables**

```bash
# 🤖 AI Intelligence (Required for AI features)
AWS_ACCESS_KEY_ID=your-bedrock-access-key
AWS_SECRET_ACCESS_KEY=your-bedrock-secret-key
AWS_REGION=us-east-1
AWS_BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0

# 🗄️ Database
MONGODB_URI=mongodb://localhost:27017/ai-cost-optimizer

# 🔐 Security
JWT_SECRET=your-super-secure-jwt-secret-key-min-32-chars
ENCRYPTION_KEY=your-32-char-encryption-key-here!!

# 📧 Intelligent Email System
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-specific-password

# 🌐 Frontend Integration
FRONTEND_URL=http://localhost:3000
```

### 🤖 **AWS Bedrock Setup**

1. **Enable Bedrock** in your AWS account (us-east-1 recommended)
2. **Request Model Access** to Claude 3.5 Sonnet in AWS Console
3. **Create IAM User** with Bedrock permissions:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "bedrock:InvokeModel",
           "bedrock:ListFoundationModels"
         ],
         "Resource": "*"
       }
     ]
   }
   ```

### 📧 **Email Configuration**

For Gmail integration:
1. Enable 2FA on your Google account
2. Generate app-specific password
3. Add credentials to `.env` file

## 🛠️ **Development**

### **Available Scripts**

```bash
npm run dev          # Start development server with hot reload
npm run build        # Build TypeScript to JavaScript  
npm start           # Start production server
npm test            # Run test suite
npm run lint        # Check code style
npm run lint:fix    # Fix code style issues
```

### **Project Structure**

```
src/
├── 🤖 services/
│   ├── intelligentMonitoring.service.ts  # AI-powered monitoring
│   ├── bedrock.service.ts                # AWS Bedrock integration
│   └── email.service.ts                  # AI-enhanced emails
├── 🎮 controllers/
│   ├── chatgpt.controller.ts            # ChatGPT integration
│   ├── onboarding.controller.ts         # Magic link onboarding  
│   └── monitoring.controller.ts         # AI monitoring endpoints
├── 🗄️ models/
│   ├── User.ts                          # Enhanced user model
│   ├── Usage.ts                         # Usage tracking
│   └── Project.ts                       # Project management
├── 🛣️ routes/
│   └── monitoring.routes.ts             # AI monitoring routes
└── 🔧 utils/
    ├── cronJobs.ts                      # Intelligent scheduling
    └── logger.ts                        # Advanced logging
```

## 🌐 **API Endpoints**

### 🤖 **AI Intelligence**
```http
POST /api/monitoring/analyze           # Trigger AI analysis for user
GET  /api/monitoring/status           # Get AI usage status & predictions  
GET  /api/monitoring/recommendations  # Get personalized AI recommendations
POST /api/monitoring/daily-monitoring # Admin: trigger daily AI monitoring
```

### 🔗 **ChatGPT Integration**  
```http
POST /api/chatgpt/action              # ChatGPT Custom GPT actions
GET  /api/chatgpt/health             # Health check with AI features
```

### ✨ **Magic Link Onboarding**
```http
POST /api/onboarding/generate-magic-link  # Generate magic onboarding link
GET  /api/onboarding/verify/:token        # Verify and complete onboarding
```

### 📊 **Core Features**
```http
POST /api/usage/track                 # Track AI usage with intelligent analysis
GET  /api/projects                   # Get projects with AI insights
GET  /api/analytics/intelligent      # Get AI-powered analytics
```

## 🎯 **AI-Powered User Experience**

### **Before (Traditional Cost Tracking)**
```
User: *Uses AI normally*
System: *Tracks usage silently*
User: *Hits limit unexpectedly*
User: "Why no warning?!" 😤
```

### **After (AI-Powered Intelligence)**
```
User: *Uses AI normally*
AI: *Analyzes patterns in real-time*
AI: "🤖 Based on your React debugging pattern, you're trending toward your limit in 8 days"
AI: *Sends personalized email with specific optimization tips*
User: *Gets context-aware tip after ChatGPT conversation*
AI: "💡 Your debugging style can save 23% tokens with this approach..."
User: *Follows AI coaching*  
AI: "🎉 Great! Your efficiency improved 15% this week"
```

## 🔧 **Production Deployment**

### **Docker Deployment**
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 8000
CMD ["node", "dist/server.js"]
```

### **Environment Configuration**
```bash
# Production environment variables
NODE_ENV=production
AWS_BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0
MONGODB_URI=mongodb://your-production-db
FRONTEND_URL=https://costkatana.com
```

### **Health Monitoring**
The system includes comprehensive health checks:
- AI service availability (AWS Bedrock)
- Database connectivity
- Email service status
- Cache performance
- API response times

## 🧪 **Testing**

### **Test the AI Features**
```bash
# Test AI-powered monitoring
curl -X POST "http://localhost:8000/api/monitoring/analyze" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId": "your-user-id"}'

# Test ChatGPT integration with AI tips
curl -X POST "http://localhost:8000/api/chatgpt/action" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "track_usage",
    "conversation_data": {
      "prompt": "Help me debug this React component",
      "response": "Here's how to debug...",
      "model": "gpt-4"
    }
  }'

# Test magic link onboarding
curl -X POST "http://localhost:8000/api/onboarding/generate-magic-link" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "name": "Test User"
  }'
```

## 🚨 **Monitoring & Alerts**

### **AI-Powered Alert System**
- **50% Usage Alert**: Early warning with personalized optimization tips
- **80% Monthly Alert**: Detailed analysis with cost-saving recommendations  
- **90% Daily Alert**: Urgent notification with immediate alternatives
- **Predictive Alerts**: AI forecasts problems before they occur

### **Email Intelligence**
- **Weekly AI Digests**: Personalized insights based on usage patterns
- **Real-Time Smart Tips**: Context-aware optimization advice
- **Efficiency Reports**: AI-calculated savings opportunities
- **Pattern Alerts**: Notification when inefficient patterns are detected

## 🤝 **Contributing**

We welcome contributions to enhance the AI-powered features!

1. Fork the repository
2. Create feature branch (`git checkout -b feature/ai-enhancement`)
3. Make your changes with comprehensive tests
4. Ensure AI features work with fallbacks
5. Submit pull request with detailed description

### **Development Guidelines**
- All AI features must have fallback strategies
- Maintain user privacy in AI analysis
- Follow TypeScript strict mode
- Write comprehensive tests for AI logic
- Document AI model dependencies

## 📊 **Performance & Scalability**

### **AI Processing Optimization**
- **Background Processing**: AI analysis runs asynchronously
- **Caching Strategy**: Intelligent caching of AI responses
- **Rate Limiting**: Protects AI services from overload
- **Fallback Logic**: Graceful degradation when AI is unavailable

### **Database Optimization**
- **Intelligent Indexing**: Optimized for AI query patterns
- **Usage Aggregation**: Efficient pattern analysis queries
- **Connection Pooling**: Handles concurrent AI processing
- **Sharding Support**: Scales with user growth

## 🔒 **Security & Privacy**

### **AI Data Protection**
- **Data Minimization**: Only necessary data sent to AI services
- **Encryption**: All AI requests encrypted in transit
- **Privacy Controls**: Users control AI analysis participation
- **Audit Logging**: Comprehensive AI interaction logging

### **Authentication & Authorization**
- **JWT with Refresh Tokens**: Secure session management
- **Role-Based Access**: Different AI features per user type
- **API Key Encryption**: Secure storage of user API keys
- **Rate Limiting**: Prevents abuse of AI endpoints

## 📈 **Roadmap**

### **Q1 2024 - Enhanced AI Features**
- [ ] Multi-language AI support
- [ ] Advanced user behavior prediction
- [ ] Integration with more AI platforms
- [ ] Enhanced personalization algorithms

### **Q2 2024 - Enterprise Features**  
- [ ] Team-based AI coaching
- [ ] Custom AI model integration
- [ ] Advanced compliance reporting
- [ ] White-label AI solutions

## 🔭 **Observability**

### **Enterprise-Grade OpenTelemetry Integration**

Cost Katana now includes **complete observability** with OpenTelemetry, transforming it into a fully observable platform with real-time insights into performance, costs, and system health.

#### 🚀 Quick Setup

```bash
# 1. Install OpenTelemetry Collector (one-time)
npm run otel:install

# 2. Configure telemetry in .env
OTEL_SERVICE_NAME=cost-katana-api
OTLP_HTTP_TRACES_URL=http://localhost:4318/v1/traces
OTLP_HTTP_METRICS_URL=http://localhost:4318/v1/metrics

# 3. Start the collector
npm run otel:run

# 4. Verify setup
npm run telemetry:verify
```

#### ✨ What's New

##### **Complete Request Tracing**
- Every API request traced end-to-end (API → Database → AI Provider → Response)
- Automatic correlation across all services with trace IDs
- Parent-child span relationships for nested operations
- Full timing breakdown showing exactly where time is spent

##### **AI/LLM Cost Tracking**
- **Exact cost attribution** per request, model, and user
- Token usage tracking (prompt vs completion)
- Cost breakdown by department/team
- Real-time cost anomaly detection
- Historical cost analysis stored in MongoDB

##### **Performance Metrics**
- Request rates (RPM) with real-time updates
- Latency percentiles (P50, P95, P99)
- Error rates and error categorization
- Service dependency mapping
- Slow query detection

##### **MongoDB Storage**
- All telemetry data persisted for historical analysis
- 30-day automatic retention (configurable)
- Rich querying capabilities
- Dashboard-ready aggregations

#### 📊 New API Endpoints

```typescript
GET /api/telemetry                    // Query all telemetry data
GET /api/telemetry/traces/:id         // Full trace details
GET /api/telemetry/metrics            // Aggregated metrics
GET /api/telemetry/dashboard          // Complete dashboard data
GET /api/telemetry/dependencies       // Service dependency map
GET /api/telemetry/health            // System health status
```

#### 🔧 Environment Variables

```bash
# Required
OTEL_SERVICE_NAME=cost-katana-api
OTLP_HTTP_TRACES_URL=http://localhost:4318/v1/traces
OTLP_HTTP_METRICS_URL=http://localhost:4318/v1/metrics

# Optional (Production)
OTEL_EXPORTER_OTLP_HEADERS={"Authorization":"Bearer TOKEN"}
OTEL_EXPORTER_OTLP_CERTIFICATE=base64_encoded_cert
OTEL_EXPORTER_OTLP_INSECURE=false
CK_CAPTURE_MODEL_TEXT=false          # Privacy: don't capture prompts
CK_TELEMETRY_REGION=us               # Regional compliance (us/eu/ap)
TELEMETRY_ENABLED=true               # Enable/disable telemetry
ENABLE_COLLECTOR_WATCHDOG=true       # Auto-restart on failure
```

#### 🎯 Deployment Modes

##### **Mode A: Direct to APM Vendor** (Recommended for Production)
```bash
# Grafana Cloud
OTLP_HTTP_TRACES_URL=https://otlp-gateway.grafana.net/otlp/v1/traces
OTEL_EXPORTER_OTLP_HEADERS={"Authorization":"Basic base64_credentials"}

# Datadog
OTLP_HTTP_TRACES_URL=https://trace.agent.datadoghq.com:4318/v1/traces
OTEL_EXPORTER_OTLP_HEADERS={"DD-API-KEY":"your_api_key"}

# New Relic
OTLP_HTTP_TRACES_URL=https://otlp.nr-data.net:4318/v1/traces
OTEL_EXPORTER_OTLP_HEADERS={"Api-Key":"your_license_key"}
```

##### **Mode B: Local Collector** (Development/Testing)
```bash
npm run otel:install  # Download collector binary
npm run otel:run     # Start collector
npm run otel:stop    # Stop collector
```

##### **Mode C: Docker Stack** (Optional Visualization)
```bash
# Tempo for traces
docker run -d -p 3200:3200 grafana/tempo

# Prometheus for metrics
docker run -d -p 9090:9090 prom/prometheus

# Grafana for dashboards
docker run -d -p 3000:3000 grafana/grafana
```

#### 📈 What You Get

##### **For Developers**
- 🔍 **Instant debugging** with trace IDs
- 📊 **Performance bottleneck identification**
- 💰 **Exact cost tracking** per operation
- 🚨 **Proactive error detection**

##### **For Business**
- 💵 **Cost optimization insights** with AI model recommendations
- 📈 **SLA monitoring** with real-time metrics
- 🔐 **Complete audit trails** for compliance
- 📊 **Department-level cost attribution**

##### **For Enterprise**
- 🌍 **Multi-region support** with data residency
- 🔒 **Privacy-first** with PII redaction
- 📡 **Vendor-agnostic** integration
- ⚡ **Scalable architecture** ready for growth

#### 🛠️ Useful Commands

```bash
# Telemetry management
npm run telemetry:verify    # Verify setup is working
npm run telemetry:validate  # Validate configuration
npm run telemetry:test      # Generate test telemetry

# Collector management
npm run otel:install        # Install collector
npm run otel:run           # Start collector
npm run otel:stop          # Stop collector
npm run otel:restart       # Restart collector
```

#### 📊 Sample Dashboard Data

```json
{
  "current": {
    "requests_per_minute": 145,
    "error_rate": 0.5,
    "avg_latency_ms": 234,
    "p95_latency_ms": 567
  },
  "costs": {
    "total_24h": 98.47,
    "by_model": {
      "gpt-4": 45.23,
      "claude-3": 32.18,
      "embeddings": 21.06
    }
  },
  "top_errors": [
    {
      "trace_id": "abc-123",
      "error": "Rate limit exceeded",
      "count": 5
    }
  ]
}
```

See [OBSERVABILITY.md](OBSERVABILITY.md) for complete documentation.

## 💬 **Support**

### **Get Help**
- 📧 **Email**: support@costkatana.com
- 🐛 **Issues**: [GitHub Issues](https://github.com/cost-katana/costkatana-backend/issues)

### **AI Feature Support**
For AI-specific issues:
- Check AWS Bedrock service status
- Verify model access permissions
- Review AI confidence thresholds
- Test with fallback scenarios

## 📄 **License**

MIT License - see [LICENSE](LICENSE) file for details.

---

<div align="center">

**🚀 Transform your AI cost management with intelligent, personalized coaching!**

[![GitHub Stars](https://img.shields.io/github/stars/cost-katana/costkatana-backend?style=social)](https://github.com/cost-katana/costkatana-backend)
</div>
