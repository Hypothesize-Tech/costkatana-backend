import { Injectable } from '@nestjs/common';
import { BaseAgentTool } from './base-agent.tool';
import { LifeUtilityService } from './life-utility.service';

/**
 * Life Utility Tool Service
 * Handles practical daily needs with real-time data
 * Ported from Express LifeUtilityTool with NestJS patterns
 */
@Injectable()
export class LifeUtilityToolService extends BaseAgentTool {
  constructor(private readonly lifeUtilityService: LifeUtilityService) {
    super(
      'life_utility',
      `Life Utility Agent that handles practical daily needs with real-time data.

This tool can:
- ☀️ Weather-aware advice: "What should I wear in Bangalore today?"
- 🧑‍⚕️ Health guidance: Symptom analysis + latest health articles
- ✈️ Travel planning: Live flight/bus/train data + itinerary builder
- 💸 Price tracking: Monitor product prices and notify on drops
- 🔍 Reverse search: Identify objects from descriptions (future feature)

Input should be a JSON string with:
{
  "operation": "weather_advice|health_guidance|travel_plan|price_track|reverse_search",
  "data": {
    // Operation-specific data
  }
}

Examples:

Weather Advice:
{
  "operation": "weather_advice",
  "data": {
    "location": "bangalore",
    "query": "What should I wear today?",
    "userProfile": {
      "gender": "male",
      "age": 25,
      "preferences": ["casual", "comfortable"],
      "healthConditions": ["sensitive skin"]
    }
  }
}

Health Guidance:
{
  "operation": "health_guidance",
  "data": {
    "symptoms": ["headache", "fever", "fatigue"],
    "age": 30,
    "gender": "female",
    "severity": "moderate",
    "duration": "2 days"
  }
}

Travel Planning:
{
  "operation": "travel_plan",
  "data": {
    "from": "Mumbai",
    "to": "Goa",
    "date": "2025-08-15",
    "returnDate": "2025-08-18",
    "budget": 15000,
    "preferences": ["flight", "beach resorts"]
  }
}

Price Tracking:
{
  "operation": "price_track",
  "data": {
    "product": "MacBook M4",
    "targetPrice": 150000,
    "userId": "user123",
    "notificationMethod": "email"
  }
}`,
    );
  }

  protected async executeLogic(input: any): Promise<any> {
    try {
      const { operation, data } = input;

      if (!operation) {
        return this.createErrorResponse(
          'life_utility',
          'Operation is required',
        );
      }

      switch (operation) {
        case 'weather_advice':
          return await this.handleWeatherAdvice(data);

        case 'health_guidance':
          return await this.handleHealthGuidance(data);

        case 'travel_plan':
          return await this.handleTravelPlan(data);

        case 'price_track':
          return await this.handlePriceTrack(data);

        case 'reverse_search':
          return await this.handleReverseSearch(data);

        default:
          return this.createErrorResponse(
            'life_utility',
            `Unknown operation: ${operation}`,
          );
      }
    } catch (error: any) {
      this.logger.error('Life utility operation failed', {
        error: error.message,
        input,
      });
      return this.createErrorResponse('life_utility', error.message);
    }
  }

  private async handleWeatherAdvice(data: any): Promise<any> {
    try {
      const result = await this.lifeUtilityService.getWeatherAdvice({
        location: data.location || 'bangalore',
        query: data.query || 'What should I wear today?',
        userProfile: data.userProfile,
      });

      return this.createSuccessResponse('weather_advice', {
        result,
        location: data.location,
      });
    } catch (error: any) {
      return this.createErrorResponse(
        'weather_advice',
        `Weather advice failed: ${error.message}`,
      );
    }
  }

  private async handleHealthGuidance(data: any): Promise<any> {
    try {
      const result = await this.lifeUtilityService.getHealthGuidance({
        symptoms: data.symptoms || [],
        age: data.age,
        gender: data.gender,
        severity: data.severity,
        duration: data.duration,
      });

      return this.createSuccessResponse('health_guidance', {
        result,
        symptoms: data.symptoms,
        disclaimer:
          'This is informational only. Consult healthcare professionals for medical advice.',
      });
    } catch (error: any) {
      return this.createErrorResponse(
        'health_guidance',
        `Health guidance failed: ${error.message}`,
      );
    }
  }

  private async handleTravelPlan(data: any): Promise<any> {
    try {
      const result = await this.lifeUtilityService.planTravel({
        from: data.from,
        to: data.to,
        date: data.date,
        returnDate: data.returnDate,
        budget: data.budget,
        preferences: data.preferences,
      });

      return this.createSuccessResponse('travel_plan', {
        result,
        route: `${data.from} to ${data.to}`,
        date: data.date,
      });
    } catch (error: any) {
      return this.createErrorResponse(
        'travel_plan',
        `Travel planning failed: ${error.message}`,
      );
    }
  }

  private async handlePriceTrack(data: any): Promise<any> {
    try {
      const result = await this.lifeUtilityService.trackPrice({
        product: data.product,
        targetPrice: data.targetPrice,
        userId: data.userId,
        notificationMethod: data.notificationMethod,
      });

      return this.createSuccessResponse('price_track', {
        result,
        product: data.product,
        targetPrice: data.targetPrice,
        trackingActive: true,
      });
    } catch (error: any) {
      return this.createErrorResponse(
        'price_track',
        `Price tracking failed: ${error.message}`,
      );
    }
  }

  private async handleReverseSearch(data: any): Promise<any> {
    try {
      const description = data.description || data.query || '';
      const category = data.category || 'general';

      if (!description) {
        return this.createErrorResponse(
          'reverse_search',
          'Please provide a description of the object you want to identify',
        );
      }

      this.logger.log(`Processing reverse search for: ${description}`);

      const result = await this.lifeUtilityService.reverseSearch(
        description,
        category,
      );

      return this.createSuccessResponse('reverse_search', {
        result,
        description,
        category,
        note: 'This is a text-based identification. Image upload feature coming soon!',
      });
    } catch (error: any) {
      return this.createErrorResponse(
        'reverse_search',
        `Reverse search failed: ${error.message}`,
      );
    }
  }
}
