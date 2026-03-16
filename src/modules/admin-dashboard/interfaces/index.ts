// User Growth & Engagement Interfaces
export interface UserGrowthTrend {
  date: string;
  newUsers: number;
  totalUsers: number;
  activeUsers: number;
}

export interface EngagementMetrics {
  totalUsers: number;
  activeUsers: number;
  inactiveUsers: number;
  newUsersThisMonth: number;
  retentionRate: number;
  averageEngagementScore: number;
  peakUsageHour: number;
  averageSessionsPerUser: number;
}

export interface UserSegment {
  segment: string;
  count: number;
  percentage: number;
  averageCost: number;
  totalCost: number;
}

// Anomaly Detection Interfaces
export interface Anomaly {
  type:
    | 'spending_spike'
    | 'error_spike'
    | 'budget_exceeded'
    | 'unusual_pattern';
  severity: 'low' | 'medium' | 'high' | 'critical';
  userId?: string;
  userEmail?: string;
  projectId?: string;
  projectName?: string;
  service?: string;
  model?: string;
  message: string;
  value: number;
  threshold: number;
  deviation: number;
  detectedAt: Date;
  resolved?: boolean;
  resolvedAt?: Date;
}

export interface Alert {
  id: string;
  type: 'spending' | 'error' | 'budget' | 'anomaly';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  userId?: string;
  userEmail?: string;
  projectId?: string;
  timestamp: Date;
  acknowledged?: boolean;
  acknowledgedAt?: Date;
}

// Model/Service Comparison Interfaces
export interface ModelComparison {
  model: string;
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  errorCount: number;
  errorRate: number;
  averageResponseTime: number;
  averageCostPerRequest: number;
  averageTokensPerRequest: number;
  efficiencyScore: number;
  costPerToken: number;
  tokensPerDollar: number;
  requestsPerDollar: number;
}

export interface ServiceComparison {
  service: string;
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  errorCount: number;
  errorRate: number;
  averageResponseTime: number;
  averageCostPerRequest: number;
  averageTokensPerRequest: number;
  efficiencyScore: number;
  uniqueModels: string[];
  costPerToken: number;
  tokensPerDollar: number;
  requestsPerDollar: number;
}

export interface AdminModelComparisonFilters {
  startDate?: Date;
  endDate?: Date;
  service?: string;
  userId?: string;
}

// Feature Analytics Interfaces
export interface FeatureUsageStats {
  feature: string;
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  uniqueUsers: number;
  averageCostPerRequest: number;
  averageTokensPerRequest: number;
  errorCount: number;
  errorRate: number;
}

export interface FeatureAdoption {
  feature: string;
  totalUsers: number;
  activeUsers: number;
  adoptionRate: number;
  growthRate: number;
}

export interface FeatureCostAnalysis {
  feature: string;
  totalCost: number;
  percentageOfTotal: number;
  averageCostPerUser: number;
  trend: 'increasing' | 'decreasing' | 'stable';
}

// Project Analytics Interfaces
export interface ProjectStats {
  projectId: string;
  projectName: string;
  workspaceId?: string;
  workspaceName?: string;
  ownerId: string;
  ownerEmail?: string;
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  averageCostPerRequest: number;
  budgetAmount: number;
  budgetUsagePercentage: number;
  isOverBudget: boolean;
  errorCount: number;
  errorRate: number;
  activeUsers: number;
  createdAt: Date;
  lastActivity: Date;
}

export interface WorkspaceStats {
  workspaceId: string;
  workspaceName: string;
  ownerId: string;
  ownerEmail?: string;
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  projectCount: number;
  activeProjectCount: number;
  activeUsers: number;
  budgetAmount: number;
  budgetUsagePercentage: number;
  isOverBudget: boolean;
  createdAt: Date;
}

export interface ProjectTrend {
  date: string;
  cost: number;
  tokens: number;
  requests: number;
}

// User Management Interfaces
export interface UserManagementFilters {
  search?: string;
  role?: 'user' | 'admin';
  isActive?: boolean;
  emailVerified?: boolean;
  subscriptionPlan?: 'free' | 'pro' | 'enterprise' | 'plus';
  sortBy?: 'name' | 'email' | 'createdAt' | 'lastLogin' | 'totalCost';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface AdminUserSummary {
  userId: string;
  email: string;
  name: string;
  avatar?: string;
  role: 'user' | 'admin';
  isActive: boolean;
  emailVerified: boolean;
  subscriptionPlan: 'free' | 'pro' | 'enterprise' | 'plus';
  createdAt: Date;
  lastLogin?: Date;
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  projectCount: number;
  workspaceCount: number;
}

export interface UserDetail extends AdminUserSummary {
  workspaceId?: string;
  workspaceMemberships: Array<{
    workspaceId: string;
    workspaceName?: string;
    role: 'owner' | 'admin' | 'developer' | 'viewer';
    joinedAt: Date;
  }>;
  projects: Array<{
    projectId: string;
    projectName: string;
    role?: string;
  }>;
  apiKeyCount: number;
  dashboardApiKeyCount: number;
  preferences: {
    emailAlerts: boolean;
    alertThreshold: number;
    optimizationSuggestions: boolean;
  };
}

// Activity Feed Interfaces
export interface ActivityEvent {
  id: string;
  type:
    | 'request'
    | 'error'
    | 'high_cost'
    | 'budget_warning'
    | 'anomaly'
    | 'user_action';
  userId?: string;
  userEmail?: string;
  userName?: string;
  projectId?: string;
  projectName?: string;
  service?: string;
  model?: string;
  cost?: number;
  tokens?: number;
  errorType?: string;
  message: string;
  timestamp: Date;
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

export interface ActivityFilters {
  userId?: string;
  projectId?: string;
  service?: string;
  model?: string;
  errorType?: string;
  types?: ActivityEvent['type'][];
  severities?: ActivityEvent['severity'][];
}

// Revenue Analytics Interfaces
export interface RevenueMetrics {
  totalMRR: number;
  totalARR: number;
  revenueThisMonth: number;
  revenueLastMonth: number;
  revenueGrowth: number;
  revenueByPlan: Array<{
    plan: string;
    count: number;
    revenue: number;
    percentage: number;
  }>;
  revenueTrend: Array<{
    date: string;
    revenue: number;
    subscriptions: number;
  }>;
}

export interface SubscriptionMetrics {
  totalSubscriptions: number;
  activeSubscriptions: number;
  freePlan: number;
  plusPlan: number;
  proPlan: number;
  enterprisePlan: number;
  newSubscriptionsThisMonth: number;
  cancellationsThisMonth: number;
  churnRate: number;
  retentionRate: number;
  averageRevenuePerUser: number;
  lifetimeValue: number;
}

export interface ConversionMetrics {
  freeToPlus: number;
  freeToPro: number;
  plusToPro: number;
  conversionRates: {
    freeToPlus: number;
    freeToPro: number;
    plusToPro: number;
  };
  conversionsThisMonth: number;
  conversionTrend: Array<{
    date: string;
    conversions: number;
    fromPlan: string;
    toPlan: string;
  }>;
}

export interface UpcomingRenewals {
  userId: string;
  userEmail: string;
  plan: string;
  amount: number;
  nextBillingDate: Date;
  interval: 'monthly' | 'yearly';
}

// API Key Management Interfaces
export interface ApiKeyStats {
  totalKeys: number;
  activeKeys: number;
  inactiveKeys: number;
  expiredKeys: number;
  expiringKeys: number;
  keysWithBudgetLimits: number;
  keysOverBudget: number;
}

export interface ApiKeyUsage {
  keyId: string;
  keyName: string;
  userId: string;
  userEmail: string;
  isActive: boolean;
  totalRequests: number;
  totalCost: number;
  dailyCost: number;
  monthlyCost: number;
  lastUsed?: Date;
  expiresAt?: Date;
  budgetLimit?: number;
  dailyBudgetLimit?: number;
  monthlyBudgetLimit?: number;
  isOverBudget: boolean;
  isExpired: boolean;
  isExpiring: boolean;
}

export interface ApiKeyTopUsage {
  keyId: string;
  keyName: string;
  userId: string;
  userEmail: string;
  requests: number;
  cost: number;
  lastUsed?: Date;
}

// Endpoint Performance Interfaces
export interface EndpointPerformance {
  endpoint: string;
  totalRequests: number;
  totalCost: number;
  avgResponseTime: number;
  p50ResponseTime?: number;
  p95ResponseTime?: number;
  p99ResponseTime?: number;
  minResponseTime?: number;
  maxResponseTime?: number;
  errorRate: number;
  totalErrors?: number;
  successRate: number;
  requestsPerMinute?: number;
  throughput?: number;
  avgCost?: number;
  avgTokens?: number;
  totalTokens?: number;
  lastRequest?: Date;
}

export interface EndpointTrend {
  date: string;
  endpoint?: string;
  requests?: number;
  totalRequests?: number;
  totalCost?: number;
  totalTokens?: number;
  avgResponseTime: number;
  errorRate: number;
  successRate?: number;
  cost?: number;
}

export interface TopEndpoints {
  endpoint: string;
  totalRequests?: number;
  totalCost?: number;
  totalTokens?: number;
  requests?: number;
  avgResponseTime: number;
  errorRate: number;
  successRate: number;
  cost?: number;
  rank: number;
}

// Geographic Patterns Interfaces
export interface PeakUsageTime {
  hour: number;
  dayOfWeek?: number;
  count?: number;
  percentage?: number;
  /** Discriminator for peak type: hourly or daily */
  type?: 'hourly' | 'daily';
  /** Hour (0-23) or day of week (1-7) depending on type */
  value?: number;
  requests?: number;
  cost?: number;
  tokens?: number;
  countryCount?: number;
  countries?: string[];
  dayName?: string;
}

export interface GeographicUsage {
  country: string;
  countryCode?: string;
  region?: string;
  city?: string;
  requests: number;
  cost: number;
  tokens: number;
  uniqueUsers?: number;
  users?: number;
  percentageOfTotal?: number;
  avgCostPerRequest?: number;
  avgTokensPerRequest?: number;
  avgResponseTime?: number;
  errorRate?: number;
}

// Budget Management Interfaces
export interface BudgetOverview {
  totalBudget: number;
  totalSpent: number;
  remainingBudget: number;
  budgetUtilization: number;
  budgetAlerts: number;
  overBudgetProjects: number;
  nearBudgetProjects: number;
}

export interface BudgetAlert {
  projectId?: string;
  projectName?: string;
  workspaceId?: string;
  workspaceName?: string;
  budgetAmount?: number;
  spent?: number;
  utilization?: number;
  threshold?: number;
  alertType?: 'warning' | 'critical' | 'over_budget';
  message: string;
  /** Extended fields used by budget alert notifications and listing */
  id?: string;
  type?: string;
  entityId?: string;
  entityName?: string;
  currentUsage?: number;
  limit?: number;
  percentage?: number;
  severity?: 'warning' | 'critical';
  createdAt?: Date;
}

export interface ProjectBudgetStatus {
  projectId: string;
  projectName: string;
  workspaceId?: string;
  workspaceName?: string;
  budgetAmount?: number;
  spent?: number;
  remaining?: number;
  utilization?: number;
  period?: 'monthly' | 'quarterly' | 'yearly' | 'one-time';
  startDate?: Date;
  endDate?: Date;
  status: 'on_track' | 'near_limit' | 'over_budget' | 'warning' | 'critical';
  alerts?: Array<{
    threshold: number;
    triggered: boolean;
  }>;
  /** Extended fields used by service implementation */
  userId?: string;
  userEmail?: string;
  budget?: number;
  monthlyBudget?: number;
  dailyBudget?: number;
  currentSpending?: number;
  budgetUtilization?: number;
  monthlyUtilization?: number;
  dailyUtilization?: number;
  lastUpdated?: Date;
}

export interface BudgetTrend {
  date: string;
  budget?: number;
  spent?: number;
  utilization: number;
  /** Alias for spent used by service */
  spending?: number;
}

// Integration Analytics Interfaces
export interface IntegrationStats {
  service: string;
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
  uniqueUsersCount?: number;
  uniqueProjectsCount?: number;
  avgResponseTime: number;
  errorRate: number;
  successRate: number;
  activeUsers?: number;
  activeProjects?: number;
  throughput?: number;
  lastRequest?: Date;
  health?: 'unknown' | 'healthy' | 'degraded' | 'unhealthy';
}

export interface IntegrationTrend {
  date: string;
  service: string;
  totalRequests?: number;
  totalCost?: number;
  totalTokens?: number;
  requests?: number;
  cost?: number;
  errorRate: number;
  successRate?: number;
  avgResponseTime: number;
}

export interface IntegrationHealth {
  service: string;
  status?: 'healthy' | 'degraded' | 'down';
  health?: 'healthy' | 'degraded' | 'down';
  healthScore?: number;
  uptime: number;
  errorRate?: number;
  avgResponseTime?: number;
  lastIncident?: Date;
  lastChecked?: Date;
  incidents24h?: number;
  issues?: string[];
  recommendations?: string[];
}

// Reporting Interfaces
export interface ReportConfig {
  format: 'csv' | 'excel' | 'json';
  startDate?: Date;
  endDate?: Date;
  includeCharts?: boolean;
  sections?: string[];
}

export interface ScheduledReport {
  id: string;
  name: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  format: 'csv' | 'excel' | 'json';
  recipients: string[];
  config: ReportConfig;
  lastSent?: Date;
  nextSend?: Date;
  isActive: boolean;
}

// Vectorization Dashboard Interfaces
export interface VectorizationHealth {
  embeddingService: 'healthy' | 'degraded' | 'error';
  vectorIndexes: 'healthy' | 'degraded' | 'error';
  storageUsage: {
    userMemories: { vectorized: number; total: number };
    conversations: { vectorized: number; total: number };
    messages: { vectorized: number; total: number };
  };
  lastProcessing: Date;
  currentlyProcessing: boolean;
}

export interface TimeEstimate {
  userMemories: { total: number; estimated: number };
  conversations: { total: number; estimated: number };
  messages: { total: number; estimated: number };
  totalEstimated: number;
}

export interface SamplingStats {
  selectionRate: number;
  totalRecords: number;
  selectedRecords: number;
}

export interface VectorizationDashboard {
  health: VectorizationHealth;
  processingStats: TimeEstimate;
  crossModalStats: {
    totalVectors: number;
    avgEmbeddingDimensions: number;
    memoryEfficiency: 'high' | 'medium' | 'building';
  };
  alerts: Array<{ level: string; message: string; action: string }>;
}
