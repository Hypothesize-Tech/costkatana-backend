import { Injectable } from '@nestjs/common';
import type {
  ScenarioTier,
  ScenarioResult,
  UseCaseBreakdown,
  UseCaseBenchmark,
} from '../dto/roi-result.dto';
import type { UseCaseDto } from '../dto/calculate-roi.dto';

/** Default average fully-loaded salary (USD/year) by company size */
const AVG_SALARY_BY_SIZE: Record<string, number> = {
  '1-50': 85000,
  '51-200': 95000,
  '201-1000': 105000,
  '1000+': 115000,
};

/** Default hourly rate derived from salary (2080 hours/year) */
function hourlyRateFromSalary(salary: number): number {
  return salary / 2080;
}

/** Scenario multipliers: conservative = 0.6x, moderate = 1.0x, optimistic = 1.4x */
const SCENARIO_MULTIPLIERS: Record<ScenarioTier, number> = {
  conservative: 0.6,
  moderate: 1.0,
  optimistic: 1.4,
};

export interface RoiCalculatorInput {
  useCases: UseCaseDto[];
  companySize: string;
  implementationBudget: number;
  timeHorizonMonths: number;
  currentAISpend?: number;
  benchmarks: UseCaseBenchmark[];
}

export interface RoiCalculatorOutput {
  scenarios: Record<ScenarioTier, ScenarioResult>;
  useCaseBreakdowns: UseCaseBreakdown[];
}

/**
 * Pure ROI math service - fully testable, no side effects.
 * Computes labor savings, cost avoidance, productivity gains, net ROI, and payback period.
 */
@Injectable()
export class RoiCalculatorService {
  /**
   * Estimate monthly AI API cost based on implementation budget (rough heuristic).
   * Assumes 30% of implementation goes to tooling/platform, 70% to integration.
   * Ongoing API cost estimated as ~20% of implementation per year amortized monthly.
   */
  private estimateMonthlyAICost(implementationBudget: number): number {
    const annualEstimate = implementationBudget * 0.2;
    return annualEstimate / 12;
  }

  /**
   * Compute ROI for all three scenarios.
   */
  calculate(input: RoiCalculatorInput): RoiCalculatorOutput {
    const avgSalary = AVG_SALARY_BY_SIZE[input.companySize] ?? 95000;
    const hourlyRate = hourlyRateFromSalary(avgSalary);
    const monthlyAICost = this.estimateMonthlyAICost(input.implementationBudget);
    const timeHorizon = input.timeHorizonMonths;
    const totalInvestment =
      input.implementationBudget + monthlyAICost * timeHorizon;

    const useCaseBreakdowns: UseCaseBreakdown[] = [];
    const scenarioResults: Record<ScenarioTier, ScenarioResult> = {
      conservative: this.blankScenario('conservative'),
      moderate: this.blankScenario('moderate'),
      optimistic: this.blankScenario('optimistic'),
    };

    const tierKeys: ScenarioTier[] = ['conservative', 'moderate', 'optimistic'];

    for (let i = 0; i < input.useCases.length; i++) {
      const uc = input.useCases[i];
      const bench = input.benchmarks[i] ?? this.defaultBenchmark(uc.name);

      const multCons = SCENARIO_MULTIPLIERS.conservative;
      const multMod = SCENARIO_MULTIPLIERS.moderate;
      const multOpt = SCENARIO_MULTIPLIERS.optimistic;

      const efficiencyCons = (bench.efficiencyGainPercent / 100) * multCons;
      const efficiencyMod = (bench.efficiencyGainPercent / 100) * multMod;
      const efficiencyOpt = (bench.efficiencyGainPercent / 100) * multOpt;

      const costRedCons = (bench.costReductionPercent / 100) * multCons;
      const costRedMod = (bench.costReductionPercent / 100) * multMod;
      const costRedOpt = (bench.costReductionPercent / 100) * multOpt;

      const laborSavingsCons = uc.currentHeadcount * avgSalary * efficiencyCons * (timeHorizon / 12);
      const laborSavingsMod = uc.currentHeadcount * avgSalary * efficiencyMod * (timeHorizon / 12);
      const laborSavingsOpt = uc.currentHeadcount * avgSalary * efficiencyOpt * (timeHorizon / 12);

      const costAvoidanceCons = uc.currentCostPerMonth * costRedCons * timeHorizon;
      const costAvoidanceMod = uc.currentCostPerMonth * costRedMod * timeHorizon;
      const costAvoidanceOpt = uc.currentCostPerMonth * costRedOpt * timeHorizon;

      const hoursPerMonth = (uc.hoursPerWeekSpent * 52) / 12;
      const productivityGainCons = hoursPerMonth * timeHorizon * hourlyRate * efficiencyCons;
      const productivityGainMod = hoursPerMonth * timeHorizon * hourlyRate * efficiencyMod;
      const productivityGainOpt = hoursPerMonth * timeHorizon * hourlyRate * efficiencyOpt;

      const totalCons = laborSavingsCons + costAvoidanceCons + productivityGainCons;
      const totalMod = laborSavingsMod + costAvoidanceMod + productivityGainMod;
      const totalOpt = laborSavingsOpt + costAvoidanceOpt + productivityGainOpt;

      scenarioResults.conservative.laborSavings += laborSavingsCons;
      scenarioResults.conservative.costAvoidance += costAvoidanceCons;
      scenarioResults.conservative.productivityGain += productivityGainCons;
      scenarioResults.conservative.totalBenefit += totalCons;

      scenarioResults.moderate.laborSavings += laborSavingsMod;
      scenarioResults.moderate.costAvoidance += costAvoidanceMod;
      scenarioResults.moderate.productivityGain += productivityGainMod;
      scenarioResults.moderate.totalBenefit += totalMod;

      scenarioResults.optimistic.laborSavings += laborSavingsOpt;
      scenarioResults.optimistic.costAvoidance += costAvoidanceOpt;
      scenarioResults.optimistic.productivityGain += productivityGainOpt;
      scenarioResults.optimistic.totalBenefit += totalOpt;

      useCaseBreakdowns.push({
        useCaseName: uc.name,
        laborSavings: laborSavingsMod,
        costAvoidance: costAvoidanceMod,
        productivityGain: productivityGainMod,
        totalBenefit: totalMod,
        benchmarkSource: bench.sources?.[0]?.title,
      });
    }

    for (const tier of tierKeys) {
      const s = scenarioResults[tier];
      s.totalInvestment = totalInvestment;
      s.netROIPercent =
        totalInvestment > 0
          ? ((s.totalBenefit - totalInvestment) / totalInvestment) * 100
          : 0;
      s.paybackPeriodMonths =
        s.totalBenefit > 0 ? totalInvestment / (s.totalBenefit / timeHorizon) : Infinity;
      s.threeYearSavings = this.extrapolateToThreeYears(s.totalBenefit, timeHorizon);
      s.productivityHoursSaved = s.productivityGain / hourlyRate;
    }

    return { scenarios: scenarioResults, useCaseBreakdowns };
  }

  private blankScenario(tier: ScenarioTier): ScenarioResult {
    return {
      tier,
      netROIPercent: 0,
      totalBenefit: 0,
      totalInvestment: 0,
      paybackPeriodMonths: 0,
      threeYearSavings: 0,
      productivityHoursSaved: 0,
      laborSavings: 0,
      costAvoidance: 0,
      productivityGain: 0,
    };
  }

  private defaultBenchmark(useCaseName: string): UseCaseBenchmark {
    return {
      useCaseName,
      efficiencyGainPercent: 25,
      costReductionPercent: 20,
      implementationTimeWeeks: 12,
      sources: [],
    };
  }

  private extrapolateToThreeYears(benefitOverPeriod: number, months: number): number {
    if (months <= 0) return 0;
    const monthlyBenefit = benefitOverPeriod / months;
    return monthlyBenefit * 36;
  }
}
