# Cost Katana Backend 🥷

> **AI-powered cost intelligence that learns, predicts, and optimizes.**

The backend powering Cost Katana—featuring intelligent monitoring, personalized coaching, predictive analytics, and seamless integrations.

---

## 🚀 Get Started in 5 Minutes

### Step 1: Clone & Install

```bash
git clone https://github.com/cost-katana/costkatana-backend.git
cd costkatana-backend
npm install
```

### Step 2: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
# Database
MONGODB_URI=mongodb://localhost:27017/cost-katana

# Security
JWT_SECRET=your-super-secure-jwt-secret-key-min-32-chars
ENCRYPTION_KEY=your-32-char-encryption-key-here!!

# AI Providers (at least one required)
OPENAI_API_KEY=sk-...           # For GPT models
GEMINI_API_KEY=...              # For Gemini models
AWS_ACCESS_KEY_ID=...           # For Claude via Bedrock
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
```

### Step 3: Run

```bash
npm run build
npm run dev
```

Server starts at `http://localhost:8000` ✅

---

## 📖 What Makes This Special

### 🧠 AI Intelligence Engine

| Feature | Description |
|---------|-------------|
| **User Profiling** | Automatically learns usage patterns |
| **Predictive Analytics** | Forecasts spending and limit hits |
| **Personalized Coaching** | Tailored recommendations per user |
| **Pattern Recognition** | Detects inefficient usage automatically |

### 🔗 Seamless Integrations

| Integration | Description |
|-------------|-------------|
| **ChatGPT Custom GPT** | Direct tips inside ChatGPT |
| **Magic Link Onboarding** | 1-click zero-friction setup |
| **Multi-Provider Support** | OpenAI, Gemini, Claude, Bedrock |
| **Smart Routing** | Auto-selects optimal provider |

### 📊 Real-Time Analytics

| Feature | Description |
|---------|-------------|
| **Live Dashboards** | Usage monitoring with AI insights |
| **Cost Reports** | AI-generated savings opportunities |
| **Efficiency Scoring** | AI-calculated scores with improvements |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Cost Katana Backend                        │
├─────────────────┬─────────────────┬─────────────────────────┤
│   🤖 AI Layer   │  🌐 API Layer   │     📊 Data Layer       │
├─────────────────┼─────────────────┼─────────────────────────┤
│ • AWS Bedrock   │ • Express.js    │ • MongoDB               │
│ • OpenAI SDK    │ • REST APIs     │ • Redis Cache           │
│ • Gemini SDK    │ • WebSockets    │ • Usage Analytics       │
│ • Forecasting   │ • Rate Limiting │ • User Profiles         │
└─────────────────┴─────────────────┴─────────────────────────┘
```

---

## 🔑 Environment Setup

### Required Variables

```bash
# Database
MONGODB_URI=mongodb://localhost:27017/cost-katana

# Security
JWT_SECRET=your-super-secure-jwt-secret-key-min-32-chars
ENCRYPTION_KEY=your-32-char-encryption-key-here!!

# Frontend
FRONTEND_URL=http://localhost:3000
```

### AI Provider Keys

> ⚠️ **You must provide your own API keys.** Cost Katana does not include OpenAI or Google keys.

```bash
# OpenAI (for GPT models)
OPENAI_API_KEY=sk-...

# Google (for Gemini models)
GEMINI_API_KEY=...

# AWS Bedrock (for Claude, Nova)
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
AWS_BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0
```

### Email (Optional)

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-specific-password
```

---

## 🛣️ API Endpoints

### AI Intelligence

```http
POST /api/monitoring/analyze           # Trigger AI analysis
GET  /api/monitoring/status            # Usage status & predictions
GET  /api/monitoring/recommendations   # Personalized recommendations
```

### ChatGPT Integration

```http
POST /api/chatgpt/action               # Custom GPT actions
GET  /api/chatgpt/health               # Health check
```

### Magic Link Onboarding

```http
POST /api/onboarding/generate-magic-link   # Generate link
GET  /api/onboarding/verify/:token         # Verify & complete
```

### Core Features

```http
POST /api/usage/track                  # Track usage with AI analysis
GET  /api/projects                     # Projects with AI insights
GET  /api/analytics/intelligent        # AI-powered analytics
```

### Telemetry & Observability

```http
GET  /api/telemetry                    # Query telemetry data
GET  /api/telemetry/traces/:id         # Full trace details
GET  /api/telemetry/metrics            # Aggregated metrics
GET  /api/telemetry/dashboard          # Dashboard data
GET  /api/telemetry/dependencies       # Service dependency map
GET  /api/telemetry/health             # System health
```

---

## 📊 OpenTelemetry Integration

### Quick Setup

```bash
# Install collector
npm run otel:install

# Configure in .env
OTEL_SERVICE_NAME=cost-katana-api
OTLP_HTTP_TRACES_URL=http://localhost:4318/v1/traces
OTLP_HTTP_METRICS_URL=http://localhost:4318/v1/metrics

# Start collector
npm run otel:run

# Verify
npm run telemetry:verify
```

### Vendor Integrations

**Grafana Cloud:**
```bash
OTLP_HTTP_TRACES_URL=https://otlp-gateway.grafana.net/otlp/v1/traces
OTEL_EXPORTER_OTLP_HEADERS={"Authorization":"Basic base64_credentials"}
```

**Datadog:**
```bash
OTLP_HTTP_TRACES_URL=https://trace.agent.datadoghq.com:4318/v1/traces
OTEL_EXPORTER_OTLP_HEADERS={"DD-API-KEY":"your_api_key"}
```

**New Relic:**
```bash
OTLP_HTTP_TRACES_URL=https://otlp.nr-data.net:4318/v1/traces
OTEL_EXPORTER_OTLP_HEADERS={"Api-Key":"your_license_key"}
```

### What You Get

- **Request Tracing** — End-to-end visibility (API → DB → AI → Response)
- **Cost Attribution** — Exact cost per request, model, and user
- **Performance Metrics** — RPM, latency percentiles, error rates
- **Service Dependencies** — Auto-generated dependency maps

---

## 🛠️ Development

### Scripts

```bash
npm run dev          # Development server with hot reload
npm run build        # Build TypeScript
npm start            # Production server
npm test             # Run tests
npm run lint         # Check code style
npm run lint:fix     # Fix code style
```

### Project Structure

```
src/
├── services/
│   ├── intelligentMonitoring.service.ts   # AI monitoring
│   ├── aiRouter.service.ts                # Provider routing
│   ├── providers/                         # Native SDKs
│   │   ├── openai.provider.ts
│   │   ├── gemini.provider.ts
│   │   └── base.provider.ts
│   ├── bedrock.service.ts                 # AWS Bedrock
│   └── email.service.ts                   # AI-enhanced emails
├── controllers/
│   ├── chatgpt.controller.ts              # ChatGPT integration
│   ├── onboarding.controller.ts           # Magic links
│   └── monitoring.controller.ts           # AI monitoring
├── models/
│   ├── User.ts
│   ├── Usage.ts
│   └── Project.ts
├── routes/
│   └── monitoring.routes.ts
└── utils/
    ├── cronJobs.ts
    └── logger.ts
```

---

## 🚨 Alert System

| Threshold | Description |
|-----------|-------------|
| **50%** | Early warning with optimization tips |
| **80%** | Detailed analysis with cost-saving recommendations |
| **90%** | Urgent notification with immediate alternatives |
| **Predictive** | AI forecasts problems before they occur |

---

## 🐳 Docker Deployment

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

```bash
# Production environment
NODE_ENV=production
MONGODB_URI=mongodb://your-production-db
FRONTEND_URL=https://costkatana.com
```

---

## 🔒 Security

| Feature | Description |
|---------|-------------|
| **JWT + Refresh Tokens** | Secure session management |
| **Role-Based Access** | Different features per user type |
| **API Key Encryption** | Secure storage of user keys |
| **Rate Limiting** | Prevents abuse |
| **Data Minimization** | Only necessary data sent to AI |
| **Audit Logging** | Comprehensive interaction logs |

---

## 🧪 Testing

```bash
# Test AI monitoring
curl -X POST "http://localhost:8000/api/monitoring/analyze" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId": "your-user-id"}'

# Test ChatGPT integration
curl -X POST "http://localhost:8000/api/chatgpt/action" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "track_usage",
    "conversation_data": {
      "prompt": "Help me debug this React component",
      "response": "Here is how to debug...",
      "model": "gpt-4"
    }
  }'

# Test magic link
curl -X POST "http://localhost:8000/api/onboarding/generate-magic-link" \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "name": "Test User"}'
```

---

## 🔗 Google Integration

Cost Katana integrates with Google Workspace using **non-sensitive OAuth scopes only**, avoiding the need for expensive CASA security assessments.

### OAuth Scopes Used

```typescript
// Non-sensitive scopes (No CASA required)
const SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/drive.file'  // Access only to files created by or selected via picker
];
```

### What You Can Do

| Feature | Description | Status |
|---------|-------------|--------|
| **File Picker** | Select any Docs/Sheets from Drive | ✅ Available |
| **Create Documents** | Create new Google Docs | ✅ Available |
| **Create Spreadsheets** | Create new Google Sheets | ✅ Available |
| **Export Cost Data** | Export to new Sheets | ✅ Available |
| **Access Selected Files** | Read/write files selected via picker | ✅ Available |
| **Chat Integration** | Use @docs and @sheets mentions | ✅ Available |

### Setup

1. **Create Google OAuth 2.0 Credentials**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing
   - Enable Google Drive API
   - Create OAuth 2.0 credentials
   - Add authorized redirect URIs

2. **Configure Environment Variables**:

```bash
# Google OAuth
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth/callback/google

# Google API (for File Picker)
GOOGLE_API_KEY=your-google-api-key
```

3. **Configure Authorized Origins** (for Picker):
   - Add `http://localhost:3000` to Authorized JavaScript origins
   - Add `http://localhost:8000` to Authorized JavaScript origins

### API Endpoints

```typescript
// OAuth Flow
POST   /api/oauth/initiate/google          // Start OAuth flow
GET    /api/oauth/callback/google          // OAuth callback
POST   /api/oauth/refresh                  // Refresh access token

// File Picker
GET    /api/google/picker/token            // Get picker token
POST   /api/google/picker/cache-selection  // Cache selected files
GET    /api/google/accessible-files        // List accessible files

// Documents & Sheets
POST   /api/google/docs/create             // Create new Doc
POST   /api/google/sheets/create           // Create new Sheet
GET    /api/google/docs/list               // List accessible Docs
GET    /api/google/sheets/list             // List accessible Sheets

// Export
POST   /api/google/export/cost-data        // Export cost data to Sheets
POST   /api/google/export/cost-report      // Create cost report in Docs
```

### Frontend Integration

```typescript
import { useGooglePicker } from '@/hooks/useGooglePicker';

// In your component
const { openPicker, selectedFiles } = useGooglePicker({
  viewType: 'DOCS',  // or 'SPREADSHEETS', 'DOCS_IMAGES_AND_VIDEOS'
  multiselect: true,
  callback: (data) => {
    console.log('Files selected:', data.docs);
  }
});

// Open picker
<button onClick={() => openPicker(connectionId)}>
  Select Files from Drive
</button>
```

### File Access Model

With `drive.file` scope, the app can only access:
1. **Files created by the app** (e.g., exported cost reports)
2. **Files explicitly selected by user via File Picker**

This ensures maximum privacy while providing full functionality.

### No CASA Assessment Needed

By using only non-sensitive scopes, Cost Katana avoids:
- ✅ $15,000 - $75,000+ CASA assessment fees
- ✅ Lengthy security review process
- ✅ Complex compliance requirements
- ✅ Annual re-assessments

---

## 📞 Support

| Channel | Link |
|---------|------|
| **Email** | support@costkatana.com |
| **GitHub Issues** | [github.com/cost-katana/costkatana-backend/issues](https://github.com/cost-katana/costkatana-backend/issues) |
| **Discord** | [discord.gg/D8nDArmKbY](https://discord.gg/D8nDArmKbY) |

---

## 📄 License

MIT © Cost Katana

---

<div align="center">

**Transform your AI cost management with intelligent coaching** 🥷

</div>
