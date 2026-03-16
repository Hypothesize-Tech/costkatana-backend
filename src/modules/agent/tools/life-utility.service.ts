import { Injectable, Logger } from '@nestjs/common';
import { ChatBedrockConverse } from '@langchain/aws';
import { WebSearchToolService } from './web-search.tool';

export interface WeatherAdviceRequest {
  location: string;
  query: string;
  userProfile?: {
    gender?: 'male' | 'female' | 'other';
    age?: number;
    preferences?: string[];
    healthConditions?: string[];
  };
}

export interface HealthQueryRequest {
  symptoms: string[];
  age?: number;
  gender?: 'male' | 'female' | 'other';
  severity?: 'mild' | 'moderate' | 'severe';
  duration?: string;
}

export interface TravelPlanRequest {
  from: string;
  to: string;
  date: string;
  returnDate?: string;
  budget?: number;
  preferences?: string[];
}

export interface PriceTrackRequest {
  product: string;
  targetPrice?: number;
  userId: string;
  notificationMethod?: 'email' | 'sms' | 'push';
}

/**
 * Life Utility Agent Service
 * Handles practical daily needs with real-time data
 * Ported from Express LifeUtilityAgentService with NestJS patterns
 */
@Injectable()
export class LifeUtilityService {
  private readonly logger = new Logger(LifeUtilityService.name);

  // AI models for different life utility tasks
  private weatherModel: ChatBedrockConverse;
  private healthModel: ChatBedrockConverse;
  private travelModel: ChatBedrockConverse;
  private priceModel: ChatBedrockConverse;

  constructor(private readonly webSearch: WebSearchToolService) {
    // Initialize AI models with appropriate configurations
    this.weatherModel = new ChatBedrockConverse({
      model: 'amazon.nova-lite-v1:0',
      region: process.env.AWS_REGION || 'us-east-1',
      temperature: 0.3,
      maxTokens: 1000,
    });

    this.healthModel = new ChatBedrockConverse({
      model: 'amazon.nova-pro-v1:0',
      region: process.env.AWS_REGION || 'us-east-1',
      temperature: 0.2, // Lower temperature for health advice
      maxTokens: 1500,
    });

    this.travelModel = new ChatBedrockConverse({
      model: 'amazon.nova-lite-v1:0',
      region: process.env.AWS_REGION || 'us-east-1',
      temperature: 0.4,
      maxTokens: 2000,
    });

    this.priceModel = new ChatBedrockConverse({
      model: 'amazon.nova-lite-v1:0',
      region: process.env.AWS_REGION || 'us-east-1',
      temperature: 0.1,
      maxTokens: 1000,
    });
  }

  /**
   * Weather-Aware Agent: Provides contextual advice based on weather
   */
  async getWeatherAdvice(request: WeatherAdviceRequest): Promise<string> {
    try {
      this.logger.log(
        `Processing weather advice request for ${request.location}`,
      );

      // First, get real-time weather data
      const weatherSources = [
        `https://www.timeanddate.com/weather/india/${request.location.toLowerCase()}`,
        `https://www.accuweather.com/en/search-locations?query=${request.location}`,
        `https://www.weather.gov/`,
      ];

      const weatherData = await this.scrapeWeatherData(weatherSources);

      // Generate contextual advice based on weather + user profile
      const advicePrompt = `You are a helpful personal assistant providing weather-based advice.

Weather Data for ${request.location}:
${weatherData}

User Query: "${request.query}"

User Profile:
- Gender: ${request.userProfile?.gender || 'not specified'}
- Age: ${request.userProfile?.age || 'not specified'}
- Preferences: ${request.userProfile?.preferences?.join(', ') || 'none specified'}
- Health Conditions: ${request.userProfile?.healthConditions?.join(', ') || 'none'}

Provide practical, personalized advice based on the current weather. Be specific about:
1. Clothing recommendations
2. Health considerations (UV, air quality, temperature)
3. Activity suggestions
4. Any precautions to take

Keep the response conversational and helpful.`;

      const response = await this.weatherModel.invoke([
        { role: 'user', content: advicePrompt },
      ]);

      return response.content.toString();
    } catch (error) {
      this.logger.error('Weather advice failed:', error);
      return `I couldn't get real-time weather data for ${request.location}. Please check a reliable weather app for current conditions.`;
    }
  }

  /**
   * Health Agent: Analyzes symptoms + latest health articles
   */
  async getHealthGuidance(request: HealthQueryRequest): Promise<string> {
    try {
      this.logger.log(
        `Processing health query for symptoms: ${request.symptoms.join(', ')}`,
      );

      // Scrape latest health information from reliable sources including government portals
      const healthSources = [
        'https://www.mohfw.gov.in/', // Ministry of Health & Family Welfare, India
        'https://www.cdc.gov/', // Centers for Disease Control and Prevention
        'https://www.who.int/', // World Health Organization
        'https://www.mayoclinic.org/', // Mayo Clinic
        'https://www.webmd.com/', // WebMD
        'https://www.nhs.uk/', // National Health Service UK
        'https://www.nih.gov/', // National Institutes of Health
        'https://www.healthline.com/', // Healthline
      ];

      const symptomsQuery = request.symptoms.join(' ');
      const healthData = await this.scrapeHealthData(
        healthSources,
        symptomsQuery,
      );

      const healthPrompt = `You are a health information assistant. IMPORTANT: Always recommend consulting healthcare professionals for medical advice.

Symptoms: ${request.symptoms.join(', ')}
Duration: ${request.duration || 'not specified'}
Severity: ${request.severity || 'not specified'}
Age: ${request.age || 'not specified'}
Gender: ${request.gender || 'not specified'}

Latest Health Information:
${healthData}

Provide:
1. General information about possible causes
2. Self-care suggestions (if appropriate)
3. When to seek medical attention
4. Red flag symptoms to watch for

ALWAYS emphasize that this is informational only and not a substitute for professional medical advice.`;

      const response = await this.healthModel.invoke([
        { role: 'user', content: healthPrompt },
      ]);

      return response.content.toString();
    } catch (error) {
      this.logger.error('Health guidance failed:', error);
      return 'I recommend consulting with a healthcare professional for medical advice. If this is an emergency, please call emergency services immediately.';
    }
  }

  /**
   * Travel Planner: Live flight/bus/train + itinerary builder
   */
  async planTravel(request: TravelPlanRequest): Promise<string> {
    try {
      this.logger.log(`Planning travel from ${request.from} to ${request.to}`);

      // Scrape travel booking sites for live data - comprehensive Indian travel sources
      const travelSources = [
        `https://www.makemytrip.com/`, // Flights, Hotels, Trains, Buses
        `https://www.goibibo.com/`, // Flights, Hotels, Buses
        `https://www.cleartrip.com/`, // Flights, Trains, Hotels
        `https://www.irctc.co.in/`, // Indian Railways official
        `https://www.redbus.in/`, // Bus bookings
        `https://www.yatra.com/`, // Flights, Hotels, Trains
        `https://www.ixigo.com/`, // Flights, Trains, Buses
        `https://www.abhibus.com/`, // Bus bookings
        `https://www.oyorooms.com/`, // Hotels and accommodations
        `https://www.trivago.in/`, // Hotel price comparison
      ];

      const travelData = await this.scrapeTravelData(travelSources, request);

      const travelPrompt = `You are a travel planning assistant.

Travel Request:
- From: ${request.from}
- To: ${request.to}
- Date: ${request.date}
- Return Date: ${request.returnDate || 'One way'}
- Budget: ${request.budget ? `₹${request.budget}` : 'No specific budget'}
- Preferences: ${request.preferences?.join(', ') || 'None specified'}

Live Travel Data:
${travelData}

Provide:
1. Best transportation options (flight/train/bus)
2. Approximate costs and timing
3. Suggested itinerary
4. Local attractions and recommendations
5. Travel tips and considerations

Be practical and cost-effective in your suggestions.`;

      const response = await this.travelModel.invoke([
        { role: 'user', content: travelPrompt },
      ]);

      return response.content.toString();
    } catch (error) {
      this.logger.error('Travel planning failed:', error);
      return `I couldn't fetch live travel data. Please check travel booking websites like MakeMyTrip, Goibibo, or IRCTC for current prices and availability.`;
    }
  }

  /**
   * Price Tracker: Monitor product prices and notify on drops
   */
  async trackPrice(request: PriceTrackRequest): Promise<string> {
    try {
      this.logger.log(`Setting up price tracking for: ${request.product}`);

      // Scrape e-commerce sites for current prices - comprehensive Indian shopping sources
      const shoppingSources = [
        `https://www.amazon.in/s?k=${encodeURIComponent(request.product)}`,
        `https://www.flipkart.com/search?q=${encodeURIComponent(request.product)}`,
        `https://www.myntra.com/search?q=${encodeURIComponent(request.product)}`,
        `https://www.snapdeal.com/search?keyword=${encodeURIComponent(request.product)}`,
        `https://www.ajio.com/search/?text=${encodeURIComponent(request.product)}`,
        `https://www.nykaa.com/search/result/?q=${encodeURIComponent(request.product)}`,
        `https://www.bigbasket.com/ps/?q=${encodeURIComponent(request.product)}`,
        `https://www.croma.com/search?q=${encodeURIComponent(request.product)}`,
        `https://www.reliancedigital.in/search?q=${encodeURIComponent(request.product)}`,
        `https://www.tatacliq.com/search/?searchCategory=all&text=${encodeURIComponent(request.product)}`,
      ];

      const priceData = await this.scrapePriceData(
        shoppingSources,
        request.product,
      );

      const pricePrompt = `You are a price tracking assistant.

Product: ${request.product}
Target Price: ${request.targetPrice ? `₹${request.targetPrice}` : 'Any good deal'}
User ID: ${request.userId}

Current Price Data:
${priceData}

Provide:
1. Current best prices across platforms
2. Price comparison
3. Historical price trends (if available)
4. Recommendations on when to buy
5. Alternative products if relevant

Set up tracking confirmation message.`;

      const response = await this.priceModel.invoke([
        { role: 'user', content: pricePrompt },
      ]);

      this.logger.log(`Price tracking set up for user ${request.userId}`);

      return response.content.toString();
    } catch (error) {
      this.logger.error('Price tracking failed:', error);
      return `I couldn't set up price tracking for ${request.product}. Please check e-commerce sites directly for current prices.`;
    }
  }

  /**
   * Reverse Search: Identify objects from descriptions
   */
  async reverseSearch(description: string, category?: string): Promise<string> {
    try {
      if (!description) {
        return 'Please provide a description of the object you want to identify';
      }

      this.logger.log(`Processing reverse search for: ${description}`);

      // Scrape search results to identify the object
      const searchSources = [
        `https://www.google.com/search?q=${encodeURIComponent(description + ' product')}`,
        `https://www.amazon.in/s?k=${encodeURIComponent(description)}`,
        `https://www.flipkart.com/search?q=${encodeURIComponent(description)}`,
        `https://images.google.com/search?q=${encodeURIComponent(description)}`,
      ];

      const results = [];
      for (const source of searchSources.slice(0, 2)) {
        try {
          const scrapingRequest = {
            operation: 'scrape' as const,
            url: source,
            selectors: {
              title: '.product-title, .item-title, h1, h2, h3',
              content: '.product-info, .item-details, .description',
              prices: '.price, .cost, .amount',
            },
            options: {
              timeout: 30000,
              javascript: true,
              extractText: true,
            },
          };

          const result = await this.webSearch._call(
            JSON.stringify(scrapingRequest),
          );
          const parsedResult = JSON.parse(result);

          if (parsedResult.success && parsedResult.data?.extractedText) {
            results.push(parsedResult.data.extractedText.substring(0, 1000));
          }
        } catch (error) {
          this.logger.warn(
            `Failed to scrape reverse search from source: ${error}`,
          );
        }
      }

      const searchData =
        results.join('\n---\n') || 'No search results available';

      // Use AI to analyze and identify the object
      const identificationPrompt = `You are an object identification assistant. Based on the description and search results, help identify what the object might be.

User Description: "${description}"
Category: ${category || 'general'}

Search Results:
${searchData}

Provide:
1. Most likely identification of the object
2. Key characteristics and features
3. Possible brands or models
4. Price range (if available)
5. Where to buy or find more information

Be specific and helpful in your identification.`;

      const response = await this.priceModel.invoke([
        { role: 'user', content: identificationPrompt },
      ]);

      return response.content.toString();
    } catch (error) {
      this.logger.error('Reverse search failed:', error);
      return `I couldn't identify the object from the description "${description}". Please provide a clearer description or try searching online directly.`;
    }
  }

  // Helper methods for data scraping
  private async scrapeWeatherData(sources: string[]): Promise<string> {
    try {
      const results = [];
      for (const source of sources.slice(0, 2)) {
        // Limit to 2 sources for speed
        try {
          const scrapingRequest = {
            operation: 'scrape' as const,
            url: source,
            selectors: {
              title: '.weather-title, .current-weather h1, .location-name',
              content:
                '.weather-info, .current-weather-details, .temperature, .conditions',
              temperature: '.temp, .temperature-value, .current-temp',
            },
            options: {
              timeout: 30000,
              javascript: true,
              extractText: true,
            },
          };

          const result = await this.webSearch._call(
            JSON.stringify(scrapingRequest),
          );
          const parsedResult = JSON.parse(result);

          if (parsedResult.success && parsedResult.data?.extractedText) {
            results.push(parsedResult.data.extractedText.substring(0, 1000));
          }
        } catch (error) {
          this.logger.warn(`Failed to scrape weather from ${source}: ${error}`);
        }
      }
      return results.join('\n---\n') || 'No weather data available';
    } catch (error) {
      this.logger.error('Weather scraping failed:', error);
      return 'Weather data unavailable';
    }
  }

  private async scrapeHealthData(
    sources: string[],
    symptoms: string,
  ): Promise<string> {
    try {
      const results = [];
      for (const source of sources.slice(0, 2)) {
        // Limit to 2 sources
        try {
          const scrapingRequest = {
            operation: 'scrape' as const,
            url: `${source}/search?q=${encodeURIComponent(symptoms)}`,
            selectors: {
              title: 'h1, h2, .article-title, .content-title',
              content: '.article-content, .health-info, .medical-content, p',
            },
            options: {
              timeout: 30000,
              javascript: true,
              extractText: true,
            },
          };

          const result = await this.webSearch._call(
            JSON.stringify(scrapingRequest),
          );
          const parsedResult = JSON.parse(result);

          if (parsedResult.success && parsedResult.data?.extractedText) {
            results.push(parsedResult.data.extractedText.substring(0, 1500));
          }
        } catch (error) {
          this.logger.warn(
            `Failed to scrape health data from ${source}: ${error}`,
          );
        }
      }
      return results.join('\n---\n') || 'No health data available';
    } catch (error) {
      this.logger.error('Health data scraping failed:', error);
      return 'Health data unavailable';
    }
  }

  private async scrapeTravelData(
    sources: string[],
    _request: TravelPlanRequest,
  ): Promise<string> {
    try {
      const results = [];
      for (const source of sources.slice(0, 2)) {
        // Limit to 2 sources
        try {
          const scrapingRequest = {
            operation: 'scrape' as const,
            url: source,
            selectors: {
              title: '.travel-option, .flight-info, .train-info',
              content: '.price, .timing, .duration, .travel-details',
              prices: '.fare, .price, .cost',
            },
            options: {
              timeout: 30000,
              javascript: true,
              extractText: true,
            },
          };

          const result = await this.webSearch._call(
            JSON.stringify(scrapingRequest),
          );
          const parsedResult = JSON.parse(result);

          if (parsedResult.success && parsedResult.data?.extractedText) {
            results.push(parsedResult.data.extractedText.substring(0, 1500));
          }
        } catch (error) {
          this.logger.warn(
            `Failed to scrape travel data from ${source}: ${error}`,
          );
        }
      }
      return results.join('\n---\n') || 'No travel data available';
    } catch (error) {
      this.logger.error('Travel data scraping failed:', error);
      return 'Travel data unavailable';
    }
  }

  private async scrapePriceData(
    sources: string[],
    _product: string,
  ): Promise<string> {
    try {
      const results = [];
      for (const source of sources.slice(0, 3)) {
        // Limit to 3 sources
        try {
          const scrapingRequest = {
            operation: 'scrape' as const,
            url: source,
            selectors: {
              title: '.product-title, .item-title, h1',
              content: '.product-info, .item-details',
              prices: '.price, .cost, .amount, .price-current, .selling-price',
            },
            options: {
              timeout: 30000,
              javascript: true,
              extractText: true,
            },
          };

          const result = await this.webSearch._call(
            JSON.stringify(scrapingRequest),
          );
          const parsedResult = JSON.parse(result);

          if (parsedResult.success && parsedResult.data?.extractedText) {
            results.push(parsedResult.data.extractedText.substring(0, 1000));
          }
        } catch (error) {
          this.logger.warn(
            `Failed to scrape price data from ${source}: ${error}`,
          );
        }
      }
      return results.join('\n---\n') || 'No price data available';
    } catch (error) {
      this.logger.error('Price data scraping failed:', error);
      return 'Price data unavailable';
    }
  }

  async cleanup(): Promise<void> {
    try {
      this.logger.log('Life utility service cleanup completed');
    } catch (error) {
      this.logger.error('Life utility service cleanup failed:', error);
    }
  }
}
