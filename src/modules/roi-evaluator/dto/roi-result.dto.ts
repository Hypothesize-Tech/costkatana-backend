export type ScenarioTier = 'conservative' | 'moderate' | 'optimistic';

export interface UseCaseBenchmark {
  useCaseName: string;
  efficiencyGainPercent: number;
  costReductionPercent: number;
  implementationTimeWeeks: number;
  sources: Array<{ title: string; url: string }>;
}

export interface ScenarioResult {
  tier: ScenarioTier;
  netROIPercent: number;
  totalBenefit: number;
  totalInvestment: number;
  paybackPeriodMonths: number;
  threeYearSavings: number;
  productivityHoursSaved: number;
  laborSavings: number;
  costAvoidance: number;
  productivityGain: number;
}

export interface UseCaseBreakdown {
  useCaseName: string;
  laborSavings: number;
  costAvoidance: number;
  productivityGain: number;
  totalBenefit: number;
  benchmarkSource?: string;
}

export interface RoiResultDto {
  resultId: string;
  scenarios: {
    conservative: ScenarioResult;
    moderate: ScenarioResult;
    optimistic: ScenarioResult;
  };
  useCaseBreakdowns: UseCaseBreakdown[];
  benchmarks: UseCaseBenchmark[];
  inputs: {
    industry: string;
    companySize: string;
    annualRevenue: number;
    implementationBudget: number;
    timeHorizon: number;
  };
}
