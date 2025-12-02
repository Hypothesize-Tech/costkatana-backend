/**
 * Currency Converter Utility
 * Handles currency conversion for payment processing with dynamic exchange rates
 */

import { loggingService } from '../services/logging.service';

// Cache for exchange rates
interface ExchangeRateCache {
    rates: Record<string, number>;
    timestamp: number;
    expiresAt: number;
}

// Cache duration: 1 hour (3600000 ms)
const CACHE_DURATION = 60 * 60 * 1000;

// Fallback rates (used if API fails)
const FALLBACK_RATES: Record<string, number> = {
    'USD_TO_INR': 89.0,
    'INR_TO_USD': 1 / 83.0,
};

let rateCache: ExchangeRateCache | null = null;

/**
 * Exchange rate API response type
 */
interface ExchangeRateResponse {
    rates: {
        INR?: number;
        [key: string]: number | undefined;
    };
    base: string;
    date: string;
}

/**
 * Fetch exchange rates from API
 * Uses exchangerate-api.com (free tier, no API key required)
 */
async function fetchExchangeRates(): Promise<Record<string, number> | null> {
    try {
        // Using exchangerate-api.com free tier (no API key required)
        // Alternative: Can use fixer.io, currencyapi.com, etc. with API keys
        const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
            // Timeout after 5 seconds
            signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
            throw new Error(`Exchange rate API returned ${response.status}`);
        }

        const data = (await response.json()) as ExchangeRateResponse;
        
        if (!data?.rates?.INR || typeof data.rates.INR !== 'number') {
            throw new Error('Invalid response from exchange rate API');
        }

        const usdToInr = data.rates.INR;
        const inrToUsd = 1 / usdToInr;

        return {
            'USD_TO_INR': usdToInr,
            'INR_TO_USD': inrToUsd,
        };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        loggingService.warn('Failed to fetch exchange rates from API', {
            error: errorMessage,
            usingFallback: true,
        });
        return null;
    }
}

/**
 * Get exchange rates (from cache or API)
 */
async function getExchangeRates(): Promise<Record<string, number>> {
    const now = Date.now();

    // Check if cache is valid
    if (rateCache && now < rateCache.expiresAt) {
        return rateCache.rates;
    }

    // Try to fetch new rates
    const rates = await fetchExchangeRates();

    if (rates) {
        // Update cache
        rateCache = {
            rates,
            timestamp: now,
            expiresAt: now + CACHE_DURATION,
        };
        return rates;
    }

    // If API fails, use fallback rates
    loggingService.warn('Using fallback exchange rates', {
        rates: FALLBACK_RATES,
    });
    return FALLBACK_RATES;
}

/**
 * Get USD to INR exchange rate
 */
async function getUsdToInrRate(): Promise<number> {
    const rates = await getExchangeRates();
    return rates['USD_TO_INR'] || FALLBACK_RATES['USD_TO_INR'];
}

/**
 * Get INR to USD exchange rate
 */
async function getInrToUsdRate(): Promise<number> {
    const rates = await getExchangeRates();
    return rates['INR_TO_USD'] || FALLBACK_RATES['INR_TO_USD'];
}

/**
 * Convert amount from one currency to another
 * @param amount - Amount to convert
 * @param fromCurrency - Source currency code
 * @param toCurrency - Target currency code
 * @returns Promise that resolves to converted amount
 */
export async function convertCurrency(
    amount: number,
    fromCurrency: string,
    toCurrency: string
): Promise<number> {
    if (fromCurrency.toUpperCase() === toCurrency.toUpperCase()) {
        return amount;
    }

    const from = fromCurrency.toUpperCase();
    const to = toCurrency.toUpperCase();

    try {
        // USD to INR
        if (from === 'USD' && to === 'INR') {
            const rate = await getUsdToInrRate();
            return amount * rate;
        }

        // INR to USD
        if (from === 'INR' && to === 'USD') {
            const rate = await getInrToUsdRate();
            return amount * rate;
        }

        // For other currencies, return original amount (can be extended)
        return amount;
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        loggingService.error('Error converting currency', {
            amount,
            fromCurrency,
            toCurrency,
            error: errorMessage,
        });
        // Fallback to approximate conversion
        if (from === 'USD' && to === 'INR') {
            return amount * FALLBACK_RATES.USD_TO_INR;
        }
        if (from === 'INR' && to === 'USD') {
            return amount * FALLBACK_RATES.INR_TO_USD;
        }
        return amount;
    }
}

/**
 * Get currency for a country
 * @param countryCode - ISO 3166-1 alpha-2 country code
 * @returns Currency code
 */
export function getCurrencyForCountry(countryCode: string | null): string {
    if (!countryCode) {
        return 'USD'; // Default
    }

    const upperCountryCode = countryCode.toUpperCase();

    // India uses INR
    if (upperCountryCode === 'IN') {
        return 'INR';
    }

    // Add more country-to-currency mappings as needed
    // For now, default to USD for all other countries
    return 'USD';
}

/**
 * Convert amount to smallest currency unit (paise for INR, cents for USD)
 * @param amount - Amount in major currency units
 * @param currency - Currency code
 * @returns Amount in smallest currency unit
 */
export function convertToSmallestUnit(amount: number, currency: string): number {
    const upperCurrency = currency.toUpperCase();
    
    // INR uses paise (1 INR = 100 paise)
    if (upperCurrency === 'INR') {
        return Math.round(amount * 100);
    }

    // USD uses cents (1 USD = 100 cents)
    if (upperCurrency === 'USD') {
        return Math.round(amount * 100);
    }

    // Default: assume 100 subunits per unit
    return Math.round(amount * 100);
}

