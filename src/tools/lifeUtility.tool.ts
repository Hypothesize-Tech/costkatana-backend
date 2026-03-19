import { Tool } from '@langchain/core/tools';
import { LifeUtilityService as LifeUtilityAgentService } from '../modules/agent/tools/life-utility.service';
import { loggingService } from '../common/services/logging.service';

export interface LifeUtilityRequest {
  operation:
    | 'weather_advice'
    | 'health_guidance'
    | 'travel_plan'
    | 'price_track';
  data: any;
}

export class LifeUtilityTool extends Tool {
  name = 'life_utility';
  description = `Life Utility Agent that handles practical daily needs with real-time data.

    This tool can:
    - ☀️ Weather-aware advice: "What should I wear in Bangalore today?"
    - 🧑‍⚕️ Health guidance: Symptom analysis + latest health articles
    - ✈️ Travel planning: Live flight/bus/train data + itinerary builder
    - 💸 Price tracking: Monitor product prices and notify on drops
    
    Input should be a JSON string with:
    {
        "operation": "weather_advice|health_guidance|travel_plan|price_track",
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
    }`;

  private lifeUtilityService: LifeUtilityAgentService;

  constructor() {
    super();
    this.lifeUtilityService = new LifeUtilityAgentService();
  }

  async _call(input: string): Promise<string> {
    try {
      loggingService.info('🎯 Life Utility Tool called with input', {
        component: 'lifeUtilityTool',
        operation: '_call',
        step: 'inputReceived',
        inputLength: input.length,
        inputPreview:
          input.substring(0, 200) + (input.length > 200 ? '...' : ''),
      });

      const request: LifeUtilityRequest = JSON.parse(input);

      switch (request.operation) {
        case 'weather_advice':
          return await this.handleWeatherAdvice(request.data);

        case 'health_guidance':
          return await this.handleHealthGuidance(request.data);

        case 'travel_plan':
          return await this.handleTravelPlan(request.data);

        case 'price_track':
          return await this.handlePriceTrack(request.data);

        default:
          return JSON.stringify({
            success: false,
            error: `Unknown operation: ${request.operation}`,
            availableOperations: [
              'weather_advice',
              'health_guidance',
              'travel_plan',
              'price_track',
            ],
          });
      }
    } catch (error) {
      loggingService.error('❌ Life Utility Tool error', {
        component: 'lifeUtilityTool',
        operation: '_call',
        step: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      return JSON.stringify({
        success: false,
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
        suggestion: 'Please check your input format and try again',
      });
    }
  }

  private async handleWeatherAdvice(data: any): Promise<string> {
    try {
      const result = await this.lifeUtilityService.getWeatherAdvice({
        location: data.location || 'bangalore',
        query: data.query || 'What should I wear today?',
        userProfile: data.userProfile,
      });

      return JSON.stringify({
        success: true,
        operation: 'weather_advice',
        result,
        location: data.location,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        operation: 'weather_advice',
        error: error instanceof Error ? error.message : 'Weather advice failed',
      });
    }
  }

  private async handleHealthGuidance(data: any): Promise<string> {
    try {
      const result = await this.lifeUtilityService.getHealthGuidance({
        symptoms: data.symptoms || [],
        age: data.age,
        gender: data.gender,
        severity: data.severity,
        duration: data.duration,
      });

      return JSON.stringify({
        success: true,
        operation: 'health_guidance',
        result,
        symptoms: data.symptoms,
        disclaimer:
          'This is informational only. Consult healthcare professionals for medical advice.',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        operation: 'health_guidance',
        error:
          error instanceof Error ? error.message : 'Health guidance failed',
        disclaimer:
          'Please consult a healthcare professional for medical advice.',
      });
    }
  }

  private async handleTravelPlan(data: any): Promise<string> {
    try {
      const result = await this.lifeUtilityService.planTravel({
        from: data.from,
        to: data.to,
        date: data.date,
        returnDate: data.returnDate,
        budget: data.budget,
        preferences: data.preferences,
      });

      return JSON.stringify({
        success: true,
        operation: 'travel_plan',
        result,
        route: `${data.from} to ${data.to}`,
        date: data.date,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        operation: 'travel_plan',
        error:
          error instanceof Error ? error.message : 'Travel planning failed',
      });
    }
  }

  private async handlePriceTrack(data: any): Promise<string> {
    try {
      const result = await this.lifeUtilityService.trackPrice({
        product: data.product,
        targetPrice: data.targetPrice,
        userId: data.userId,
        notificationMethod: data.notificationMethod,
      });

      return JSON.stringify({
        success: true,
        operation: 'price_track',
        result,
        product: data.product,
        targetPrice: data.targetPrice,
        trackingActive: true,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        operation: 'price_track',
        error: error instanceof Error ? error.message : 'Price tracking failed',
      });
    }
  }

  async cleanup(): Promise<void> {
    try {
      await this.lifeUtilityService.cleanup();
    } catch (error) {
      loggingService.error('Life Utility Tool cleanup failed', {
        component: 'lifeUtilityTool',
        operation: 'cleanup',
        step: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
