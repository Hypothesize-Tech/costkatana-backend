# 🤖 Cost Katana API Documentation - AI Intelligence v2.0

> **Complete API reference for the world's first AI-powered cost optimization backend** - featuring intelligent monitoring, personalized recommendations, and seamless integrations.

## 📋 **Table of Contents**

1. [Overview](#overview)
2. [Authentication](#authentication)  
3. [AI Intelligence Endpoints](#ai-intelligence-endpoints)
4. [ChatGPT Integration](#chatgpt-integration)
5. [Magic Link Onboarding](#magic-link-onboarding)
6. [Usage Tracking](#usage-tracking)
7. [Analytics & Reporting](#analytics--reporting)
8. [Webhooks](#webhooks)
9. [Error Handling](#error-handling)
10. [Rate Limiting](#rate-limiting)

## 🌟 **Overview**

**Base URL**: `https://cost-katana-backend.store/api` (Production) | `http://localhost:8000/api` (Development)

**API Version**: v2.0 (AI-Powered Intelligence)

**Content Type**: `application/json`

**Key Features**:
- 🤖 **AI-Powered Personalization**: Every response includes personalized insights
- 🔮 **Predictive Analytics**: AI forecasting and trend analysis  
- ✨ **Magic Link Onboarding**: Zero-friction user setup
- 🎯 **Context-Aware Recommendations**: Tailored to user's specific usage patterns
- 📊 **Real-Time Intelligence**: Live AI analysis and recommendations

## 🔐 **Authentication**

### **JWT Authentication**
All protected endpoints require a valid JWT token in the Authorization header:

```http
Authorization: Bearer <jwt_token>
```

### **API Key Authentication** (for integrations)
Some endpoints support API key authentication for external integrations:

```http
X-API-Key: ck_user_<userId>_<random>
```

### **Authentication Endpoints**

#### **POST** `/auth/login` - User Login
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "refresh_token_here",
  "user": {
    "id": "user_id",
    "email": "user@example.com",
    "name": "User Name",
    "aiProfile": {
      "technicalLevel": "intermediate",
      "costSensitivity": "high",
      "preferredOptimizations": ["prompt_efficiency", "model_selection"]
    }
  }
}
```

#### **POST** `/auth/register` - User Registration
```json
{
  "email": "user@example.com",
  "password": "securepassword",
  "name": "User Name",
  "preferences": {
    "aiCoaching": true,
    "emailInsights": true,
    "useCase": "coding"
  }
}
```

## 🤖 **AI Intelligence Endpoints**

### **POST** `/monitoring/analyze` - Trigger AI Analysis
Initiates comprehensive AI analysis for a user's usage patterns.

**Headers:**
```http
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Request:**
```json
{
  "userId": "user_id_here",
  "analysisType": "comprehensive", // "quick" | "comprehensive" | "predictive"
  "includeRecommendations": true,
  "confidenceThreshold": 70
}
```

**Response:**
```json
{
  "success": true,
  "analysis": {
    "userId": "user_id",
    "analysisId": "analysis_123",
    "timestamp": "2024-01-15T10:30:00Z",
    "userProfile": {
      "profileType": "Technical content creator focused on React development",
      "usagePersonality": "Asks detailed technical questions, prefers step-by-step explanations",
      "technicalLevel": "advanced",
      "costSensitivity": "high",
      "optimizationStyle": "Values accuracy over cost, responds well to specific examples"
    },
    "usagePatterns": {
      "averageTokensPerRequest": 1250,
      "mostUsedModels": ["gpt-4", "gpt-3.5-turbo"],
      "peakUsageHours": [9, 14, 19],
      "commonTopics": ["coding", "debugging", "react"],
      "inefficiencyScore": 23,
      "aiInsights": {
        "patterns": ["Long debugging prompts", "Repetitive React questions"],
        "potentialSavings": 15.50,
        "optimizationOpportunities": [
          {
            "type": "prompt_optimization",
            "reason": "Debug prompts can be more specific",
            "estimatedSaving": 23
          }
        ]
      }
    },
    "predictions": {
      "monthlyProjectedCost": 47.83,
      "limitReachDate": "2024-01-28T15:00:00Z",
      "confidenceScore": 87
    }
  },
  "recommendations": [
    {
      "id": "rec_001",
      "type": "prompt_optimization",
      "priority": "high",
      "title": "Optimize Your React Debugging Prompts",
      "message": "Based on your React debugging pattern and high cost sensitivity, I've identified 23% savings potential in your error-handling prompts.",
      "suggestedAction": "Try: 'Debug React hook error: [specific-error] in [component]' - saves 156 tokens per request",
      "potentialSavings": {
        "tokens": 156,
        "cost": 0.0031,
        "percentage": 23
      },
      "confidence": 87,
      "userContext": "Matches your pattern of asking detailed React debugging questions",
      "aiGenerated": true,
      "personalized": true
    }
  ]
}
```

### **GET** `/monitoring/status` - Get AI Usage Status
Returns current usage status with AI predictions and warnings.

**Query Parameters:**
- `includeForecasting` (boolean): Include AI forecasting
- `timeframe` (string): "daily" | "weekly" | "monthly"

**Response:**
```json
{
  "success": true,
  "status": {
    "currentUsage": {
      "monthlyRequests": 145,
      "monthlyTokens": 125000,
      "monthlyCost": 32.50,
      "dailyAverage": 4.8
    },
    "aiPredictions": {
      "projectedMonthlyLimit": 89,
      "daysUntilLimit": 12,
      "confidenceScore": 92,
      "riskLevel": "medium",
      "recommendation": "Consider optimizing your React debugging prompts to extend your budget"
    },
    "personalizedInsights": {
      "efficiencyTrend": "improving",
      "lastWeekImprovement": 15,
      "topOptimizationOpportunity": "Prompt specificity for debugging tasks"
    },
    "alerts": [
      {
        "type": "predictive_warning",
        "severity": "medium",
        "message": "AI predicts you'll reach 80% of your monthly limit in 8 days",
        "action": "Consider switching to GPT-3.5 for simpler queries"
      }
    ]
  }
}
```

### **GET** `/monitoring/recommendations` - Get Personalized AI Recommendations
Returns AI-generated, personalized optimization recommendations.

**Query Parameters:**
- `type` (string): Filter by recommendation type
- `priority` (string): "low" | "medium" | "high" | "urgent"
- `limit` (number): Maximum recommendations to return

**Response:**
```json
{
  "success": true,
  "recommendations": [
    {
      "id": "rec_002",
      "type": "model_switch",
      "priority": "high",
      "title": "AI-Optimized Model Selection for Your Learning Questions",
      "message": "For your learning-focused conversations, GPT-3.5 Turbo provides 89% similar quality at 75% lower cost. Perfect match for your intermediate technical level.",
      "suggestedAction": "Switch to GPT-3.5 Turbo for explanatory questions about React concepts",
      "potentialSavings": {
        "costPerRequest": 0.008,
        "monthlyProjection": 24.50,
        "percentage": 75
      },
      "confidence": 91,
      "userContext": "Based on your learning-focused conversation pattern",
      "aiGenerated": true,
      "personalized": true,
      "implementationSteps": [
        "Identify learning vs debugging questions",
        "Use GPT-3.5 for conceptual explanations",
        "Reserve GPT-4 for complex debugging"
      ]
    }
  ],
  "meta": {
    "totalRecommendations": 5,
    "highPriority": 2,
    "aiGenerated": 4,
    "personalized": 5,
    "avgConfidence": 88.2
  }
}
```

## 🔗 **ChatGPT Integration**

### **POST** `/chatgpt/action` - ChatGPT Custom GPT Actions
Main endpoint for ChatGPT Custom GPT integration with AI-powered responses.

**Request:**
```json
{
  "action": "track_usage",
  "api_key": "ck_user_123_abc456",
  "conversation_data": {
    "prompt": "Help me debug this React component error",
    "response": "Here's how to debug your React component...",
    "model": "gpt-4",
    "tokens_used": {
      "prompt_tokens": 150,
      "completion_tokens": 300,
      "total_tokens": 450
    },
    "user_context": {
      "use_case": "coding",
      "technical_level": "intermediate",
      "cost_sensitivity": "high"
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Usage tracked successfully with AI analysis",
  "data": {
    "usageId": "usage_789",
    "cost": 0.009,
    "projectId": "default_project"
  },
  "ai_insights": {
    "smart_tip": "🤖 AI Tip: Your React debugging prompts can save 28% tokens. Try: 'Debug React hook error: [error] in [component]' instead of your current style. Technique: Component-focused queries",
    "confidence": 87,
    "personalized": true,
    "user_profile": "Advanced React developer with cost-conscious usage",
    "predicted_savings": {
      "tokens": 126,
      "cost_per_request": 0.0025,
      "percentage": 28
    },
    "limit_warning": {
      "current_usage_percentage": 67,
      "predicted_limit_date": "2024-01-28T15:00:00Z",
      "recommendation": "Consider Cost Katana's API access for unlimited usage"
    }
  }
}
```

### **GET** `/chatgpt/health` - Health Check with AI Status
Returns health status including AI service availability.

**Response:**
```json
{
  "success": true,
  "message": "Cost Katana AI Intelligence is operational",
  "version": "2.0.0",
  "timestamp": "2024-01-15T10:30:00Z",
  "ai_features": [
    "intelligent_monitoring",
    "personalized_recommendations", 
    "predictive_analytics",
    "magic_link_onboarding",
    "context_aware_tips"
  ],
  "bedrock_status": "available"
}
```

## ✨ **Magic Link Onboarding**

### **POST** `/onboarding/generate-magic-link` - Generate Magic Link
Creates a magic link for seamless user onboarding.

**Request:**
```json
{
  "email": "newuser@example.com",
  "name": "New User",
  "source": "chatgpt-custom-gpt",
  "preferences": {
    "use_case": "coding",
    "ai_coaching": true,
    "email_insights": true
  }
}
```

**Response:**
```json
{
  "success": true,
  "magic_link": "https://costkatana.com/onboard?token=magic_abc123def456",
  "expires_at": "2024-01-15T11:00:00Z",
  "session_id": "session_789",
  "message": "Magic link generated successfully. Valid for 30 minutes."
}
```

### **GET** `/onboarding/verify/:token` - Verify Magic Link
Completes the magic link onboarding process.

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "user_new_123",
    "email": "newuser@example.com",
    "name": "New User"
  },
  "api_key": "ck_user_new_123_generated456",
  "project": {
    "id": "project_default_789",
    "name": "My AI Cost Tracking"
  },
  "ai_setup": {
    "profile_created": true,
    "intelligent_monitoring_enabled": true,
    "personalized_tips_activated": true
  },
  "next_steps": [
    "Complete your profile in the dashboard",
    "Set up your first project budget",
    "Install the ChatGPT Custom GPT"
  ]
}
```

## 📊 **Usage Tracking**

### **POST** `/usage/track` - Track AI Usage with Intelligence
Enhanced usage tracking with automatic AI analysis.

**Request:**
```json
{
  "projectId": "project_123",
  "service": "openai",
  "model": "gpt-4",
  "prompt": "Help me optimize this React component for performance",
  "completion": "Here are several optimization strategies...",
  "promptTokens": 120,
  "completionTokens": 280,
  "totalTokens": 400,
  "cost": 0.008,
  "responseTime": 1200,
  "metadata": {
    "source": "chatgpt-custom-gpt",
    "useCase": "coding",
    "technicalLevel": "advanced",
    "optimization_applied": false
  },
  "aiAnalysis": {
    "enable": true,
    "generateTips": true,
    "updateProfile": true
  }
}
```

**Response:**
```json
{
  "success": true,
  "usage": {
    "id": "usage_456",
    "cost": 0.008,
    "tokens": 400,
    "efficiency_score": 87,
    "created_at": "2024-01-15T10:30:00Z"
  },
  "ai_analysis": {
    "pattern_detected": "React performance optimization queries",
    "efficiency_improvement": "Consider more specific performance metrics in your prompts",
    "cost_optimization": {
      "current_efficiency": 87,
      "potential_improvement": 15,
      "recommendation": "Use specific performance bottlenecks in your prompts"
    }
  },
  "smart_tip": "🤖 Performance Tip: For React optimization questions, mention specific metrics (render time, memory usage) to get more targeted, efficient responses. This matches your advanced technical level.",
  "project_status": {
    "current_usage": 67.5,
    "budget_remaining": 32.5,
    "projected_end_date": "2024-01-28"
  }
}
```

## 📈 **Analytics & Reporting**

### **GET** `/analytics/intelligent` - AI-Powered Analytics
Returns comprehensive analytics with AI insights and predictions.

**Query Parameters:**
- `timeframe` (string): "day" | "week" | "month" | "year"
- `projectId` (string): Specific project ID
- `includeForecasting` (boolean): Include AI predictions

**Response:**
```json
{
  "success": true,
  "analytics": {
    "summary": {
      "totalCost": 245.50,
      "totalTokens": 1250000,
      "totalRequests": 1847,
      "efficiency_score": 78,
      "ai_insights_generated": 156
    },
    "ai_analysis": {
      "cost_trends": {
        "trend": "decreasing",
        "improvement": 23,
        "reason": "User applied AI optimization recommendations"
      },
      "usage_patterns": {
        "primary_use_case": "React development and debugging",
        "peak_hours": [9, 14, 19],
        "efficiency_improvements": [
          {
            "date": "2024-01-10",
            "improvement": 15,
            "cause": "Applied prompt optimization suggestions"
          }
        ]
      },
      "predictions": {
        "monthly_projection": 187.30,
        "budget_status": "on_track",
        "confidence": 91,
        "recommendations": [
          "Continue current optimization pattern",
          "Consider GPT-3.5 for simpler debugging tasks"
        ]
      }
    },
    "personalized_insights": [
      {
        "insight": "Your debugging efficiency improved 28% this month",
        "action": "Apply similar techniques to other query types",
        "potential_savings": 45.20
      }
    ]
  }
}
```

## ⚠️ **Error Handling**

### **Standard Error Response Format**
```json
{
  "success": false,
  "error": {
    "code": "AI_SERVICE_UNAVAILABLE",
    "message": "AI analysis temporarily unavailable",
    "details": "AWS Bedrock service is currently unavailable. Using fallback recommendations.",
    "timestamp": "2024-01-15T10:30:00Z",
    "request_id": "req_123456"
  },
  "fallback": {
    "basic_recommendations": true,
    "ai_features_available": false,
    "retry_after": 300
  }
}
```

### **Common Error Codes**

| Code | Description | HTTP Status |
|------|-------------|-------------|
| `AI_SERVICE_UNAVAILABLE` | AWS Bedrock unavailable | 503 |
| `INSUFFICIENT_DATA` | Not enough data for AI analysis | 400 |
| `INVALID_API_KEY` | Invalid or expired API key | 401 |
| `RATE_LIMIT_EXCEEDED` | Too many requests | 429 |
| `USAGE_LIMIT_EXCEEDED` | User exceeded usage limits | 402 |
| `INVALID_USER_PROFILE` | User profile incomplete | 400 |

## 🚦 **Rate Limiting**

### **Rate Limit Headers**
All responses include rate limiting headers:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 85
X-RateLimit-Reset: 1642234567
X-RateLimit-AI-Calls: 20
X-RateLimit-AI-Remaining: 15
```

### **Rate Limits by Endpoint Type**

| Endpoint Category | Requests per Hour | AI Calls per Hour |
|-------------------|-------------------|-------------------|
| Authentication | 30 | 0 |
| Usage Tracking | 1000 | 50 |
| AI Analysis | 100 | 50 |
| ChatGPT Integration | 500 | 100 |
| Magic Link | 10 | 5 |


### **AI Events**
Real-time AI analysis and recommendations via WebSocket:

```json
{
  "event": "ai_recommendation",
  "data": {
    "type": "urgent_optimization",
    "message": "🤖 Urgent: You're approaching your ChatGPT limit. Consider these alternatives...",
    "recommendations": [...],
    "confidence": 95
  }
}

{
  "event": "usage_pattern_detected", 
  "data": {
    "pattern": "inefficient_debugging_prompts",
    "severity": "medium",
    "suggestion": "Use more specific error descriptions in your React debugging prompts"
  }
}

{
  "event": "ai_insight",
  "data": {
    "insight": "Your prompt efficiency improved 15% this week",
    "personalized": true,
    "next_goal": "Achieve 20% improvement by optimizing model selection"
  }
}
```

## 🎯 **Best Practices**

### **AI-Powered Integration**
1. **Always handle AI fallbacks**: When AI services are unavailable
2. **Use confidence scores**: Only act on high-confidence recommendations
3. **Personalization data**: Provide user context for better AI insights
4. **Progressive enhancement**: Basic features work without AI

### **Performance Optimization**
1. **Cache AI responses**: Avoid redundant AI calls
2. **Batch requests**: Combine multiple operations when possible
3. **Use appropriate timeframes**: Don't request unnecessary historical data
4. **Monitor rate limits**: Respect AI service quotas

### **Security**
1. **Validate all inputs**: Especially data sent to AI services
2. **Sanitize AI responses**: Before displaying to users
3. **Rotate API keys**: Regular rotation for security
4. **Audit AI interactions**: Log all AI service calls

## 🪝 **Webhooks**

For comprehensive webhook documentation, including:
- Complete API reference
- Event types and payloads
- Security and signature verification
- Integration examples
- Best practices

See [WEBHOOK_DOCUMENTATION.md](./WEBHOOK_DOCUMENTATION.md)

---

## 💬 **Support & Feedback**

For API support:
- 📧 **Email**: abdul@hypothesize.tech
- 📖 **Documentation**: [docs.costkatana.com](https://docs.costkatana.com)
- 🐛 **Issues**: [GitHub Issues](https://github.com/Hypothesize-Tech/ai-cost-optimizer-backend/issues)

**Latest Update**: August 2025 - AI Intelligence v2.0 with personalized recommendations and predictive analytics.