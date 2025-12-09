/**
 * Natural Language Date/Time Parser
 * Parses natural language date and time expressions for calendar events
 */

import { loggingService } from '../services/logging.service';

export interface ParsedDateTime {
    start: Date;
    end: Date;
    allDay: boolean;
    timezone: string;
    confidence: number;
    recurrence?: {
        frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
        interval: number;
        byDay?: string[]; // MO, TU, WE, TH, FR, SA, SU
        count?: number;
        until?: Date;
    };
}

/**
 * Parse natural language date/time into structured format
 */
export function parseNaturalDateTime(text: string, userTimezone: string = 'UTC'): ParsedDateTime {
    const now = new Date();
    const lowerText = text.toLowerCase();
    
    loggingService.debug('Parsing natural language date/time', { text, timezone: userTimezone });

    // Check for recurring patterns first
    const recurrence = parseRecurrence(lowerText);

    // Parse date components
    let startDate = parseDate(lowerText, now);
    let startTime = parseTime(lowerText, now);
    let duration = parseDuration(lowerText);
    let isAllDay = checkIfAllDay(lowerText);

    // Combine date and time
    const start = combineDateTime(startDate, startTime, now);
    
    // Calculate end time
    const end = calculateEndTime(start, duration, isAllDay);

    // Calculate confidence score
    const confidence = calculateConfidence(lowerText, start, end);

    return {
        start,
        end,
        allDay: isAllDay,
        timezone: userTimezone,
        confidence,
        recurrence
    };
}

/**
 * Parse date from natural language
 */
function parseDate(text: string, now: Date): Date {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);

    // Today
    if (/\btoday\b/i.test(text)) {
        return date;
    }

    // Tomorrow
    if (/\btomorrow\b/i.test(text)) {
        date.setDate(date.getDate() + 1);
        return date;
    }

    // Yesterday
    if (/\byesterday\b/i.test(text)) {
        date.setDate(date.getDate() - 1);
        return date;
    }

    // Day of week: "this friday", "next monday", "friday"
    const dayMatch = text.match(/\b(this\s+|next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    if (dayMatch) {
        const dayName = dayMatch[2].toLowerCase();
        const isNext = dayMatch[1]?.toLowerCase().includes('next');
        const targetDay = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(dayName);
        const currentDay = date.getDay();
        
        let daysToAdd = targetDay - currentDay;
        if (daysToAdd < 0 || (daysToAdd === 0 && !isNext)) {
            daysToAdd += 7;
        }
        if (isNext && daysToAdd < 7) {
            daysToAdd += 7;
        }
        
        date.setDate(date.getDate() + daysToAdd);
        return date;
    }

    // Specific date: "25th", "on the 25th", "25th of this month", "December 25"
    const dateMatch = text.match(/\b(\d{1,2})(st|nd|rd|th)?(?:\s+of\s+)?(?:this\s+month|next\s+month)?\b/i);
    if (dateMatch) {
        const day = parseInt(dateMatch[1]);
        if (day >= 1 && day <= 31) {
            date.setDate(day);
            if (day < now.getDate()) {
                // If date has passed this month, move to next month
                date.setMonth(date.getMonth() + 1);
            }
            return date;
        }
    }

    // Month and day: "december 25", "dec 25", "12/25"
    const monthDayMatch = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})\b/i);
    if (monthDayMatch) {
        const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
        const monthAbbr = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const monthName = monthDayMatch[1].toLowerCase();
        const monthIndex = monthNames.indexOf(monthName) >= 0 ? monthNames.indexOf(monthName) : monthAbbr.indexOf(monthName);
        const day = parseInt(monthDayMatch[2]);
        
        if (monthIndex >= 0) {
            date.setMonth(monthIndex);
            date.setDate(day);
            // If date is in the past, assume next year
            if (date < now) {
                date.setFullYear(date.getFullYear() + 1);
            }
            return date;
        }
    }

    // Numeric date: "12/25", "12-25", "2024-12-25"
    const numericMatch = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
    if (numericMatch) {
        const month = parseInt(numericMatch[1]) - 1;
        const day = parseInt(numericMatch[2]);
        const year = numericMatch[3] ? (numericMatch[3].length === 2 ? 2000 + parseInt(numericMatch[3]) : parseInt(numericMatch[3])) : now.getFullYear();
        
        date.setFullYear(year, month, day);
        return date;
    }

    // Relative days: "in 3 days", "3 days from now"
    const relativeDaysMatch = text.match(/\b(?:in\s+)?(\d+)\s+days?(?:\s+from\s+now)?\b/i);
    if (relativeDaysMatch) {
        const days = parseInt(relativeDaysMatch[1]);
        date.setDate(date.getDate() + days);
        return date;
    }

    // Relative weeks: "in 2 weeks", "2 weeks from now"
    const relativeWeeksMatch = text.match(/\b(?:in\s+)?(\d+)\s+weeks?(?:\s+from\s+now)?\b/i);
    if (relativeWeeksMatch) {
        const weeks = parseInt(relativeWeeksMatch[1]);
        date.setDate(date.getDate() + (weeks * 7));
        return date;
    }

    return date;
}

/**
 * Parse time from natural language
 */
function parseTime(text: string, now: Date): { hours: number; minutes: number } | null {
    // 24-hour format: "14:30", "14h30"
    let match = text.match(/\b(\d{1,2}):(\d{2})\b/);
    if (match) {
        return { hours: parseInt(match[1]), minutes: parseInt(match[2]) };
    }

    // 12-hour format: "2pm", "2:30pm", "2 pm", "2:30 pm"
    match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/i);
    if (match) {
        let hours = parseInt(match[1]);
        const minutes = match[2] ? parseInt(match[2]) : 0;
        const meridiem = match[3].toLowerCase();
        
        if (meridiem.startsWith('pm') || meridiem.startsWith('p.')) {
            if (hours !== 12) hours += 12;
        } else if (meridiem.startsWith('am') || meridiem.startsWith('a.')) {
            if (hours === 12) hours = 0;
        }
        
        return { hours, minutes };
    }

    // Simple hour: "5am", "5 am", "17"
    match = text.match(/\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)?\b/i);
    if (match) {
        let hours = parseInt(match[1]);
        const meridiem = match[2]?.toLowerCase();
        
        if (meridiem) {
            if (meridiem.startsWith('pm') || meridiem.startsWith('p.')) {
                if (hours !== 12) hours += 12;
            } else if (meridiem.startsWith('am') || meridiem.startsWith('a.')) {
                if (hours === 12) hours = 0;
            }
        }
        
        return { hours, minutes: 0 };
    }

    // Named times
    if (/\bmidnight\b/i.test(text)) {
        return { hours: 0, minutes: 0 };
    }
    if (/\bnoon\b/i.test(text)) {
        return { hours: 12, minutes: 0 };
    }
    if (/\bmorning\b/i.test(text)) {
        return { hours: 9, minutes: 0 };
    }
    if (/\bafternoon\b/i.test(text)) {
        return { hours: 14, minutes: 0 };
    }
    if (/\bevening\b/i.test(text)) {
        return { hours: 18, minutes: 0 };
    }
    if (/\bnight\b/i.test(text)) {
        return { hours: 20, minutes: 0 };
    }

    return null;
}

/**
 * Parse duration from natural language
 */
function parseDuration(text: string): number {
    // Hours: "for 2 hours", "2 hour meeting"
    let match = text.match(/\b(\d+)\s*(?:hours?|hrs?)\b/i);
    if (match) {
        return parseInt(match[1]) * 60; // Return minutes
    }

    // Minutes: "for 30 minutes", "30 minute meeting"
    match = text.match(/\b(\d+)\s*(?:minutes?|mins?)\b/i);
    if (match) {
        return parseInt(match[1]);
    }

    // Default duration based on event type
    if (/\bmeeting\b/i.test(text)) {
        return 60; // 1 hour
    }
    if (/\bcall\b/i.test(text)) {
        return 30; // 30 minutes
    }

    return 60; // Default 1 hour
}

/**
 * Check if event is all-day
 */
function checkIfAllDay(text: string): boolean {
    return /\ball[- ]day\b/i.test(text) || 
           /\bfull day\b/i.test(text) ||
           (/\b(?:on|for)\s+(?:the\s+)?\d{1,2}(?:st|nd|rd|th)?\b/i.test(text) && !/\bat\s+\d/i.test(text));
}

/**
 * Combine date and time
 */
function combineDateTime(date: Date, time: { hours: number; minutes: number } | null, now: Date): Date {
    const result = new Date(date);
    
    if (time) {
        result.setHours(time.hours, time.minutes, 0, 0);
    } else {
        // If no time specified, use next available hour
        result.setHours(now.getHours() + 1, 0, 0, 0);
    }
    
    // If the time is in the past, move to next day (unless date was explicitly specified)
    if (result < now && !time) {
        result.setDate(result.getDate() + 1);
    }
    
    return result;
}

/**
 * Calculate end time
 */
function calculateEndTime(start: Date, durationMinutes: number, isAllDay: boolean): Date {
    const end = new Date(start);
    
    if (isAllDay) {
        end.setDate(end.getDate() + 1);
        end.setHours(0, 0, 0, 0);
    } else {
        end.setMinutes(end.getMinutes() + durationMinutes);
    }
    
    return end;
}

/**
 * Parse recurrence pattern
 */
function parseRecurrence(text: string): ParsedDateTime['recurrence'] | undefined {
    // Daily: "every day", "daily"
    if (/\bevery\s+day\b|\bdaily\b/i.test(text)) {
        return { frequency: 'DAILY', interval: 1 };
    }

    // Weekly with specific days: "every monday", "every monday and wednesday"
    const weeklyMatch = text.match(/\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+and\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday))*/i);
    if (weeklyMatch) {
        const days = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const byDay: string[] = [];
        
        for (const match of text.matchAll(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi)) {
            const index = dayNames.indexOf(match[1].toLowerCase());
            if (index >= 0) {
                byDay.push(days[index]);
            }
        }
        
        return { frequency: 'WEEKLY', interval: 1, byDay };
    }

    // Weekly: "every week", "weekly"
    if (/\bevery\s+week\b|\bweekly\b/i.test(text)) {
        return { frequency: 'WEEKLY', interval: 1 };
    }

    // Monthly: "every month", "monthly", "every 1st"
    if (/\bevery\s+month\b|\bmonthly\b/i.test(text)) {
        return { frequency: 'MONTHLY', interval: 1 };
    }

    // Yearly: "every year", "yearly", "annually"
    if (/\bevery\s+year\b|\byearly\b|\bannually\b/i.test(text)) {
        return { frequency: 'YEARLY', interval: 1 };
    }

    return undefined;
}

/**
 * Calculate confidence score (0-1)
 */
function calculateConfidence(text: string, start: Date, end: Date): number {
    let confidence = 0.5; // Base confidence

    // Increase confidence for specific indicators
    if (/\btoday\b|\btomorrow\b/i.test(text)) confidence += 0.2;
    if (/\d{1,2}:\d{2}/.test(text)) confidence += 0.2; // Specific time
    if (/\bam\b|\bpm\b/i.test(text)) confidence += 0.1;
    if (/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text)) confidence += 0.1;
    if (/\b\d{1,2}(?:st|nd|rd|th)\b/i.test(text)) confidence += 0.1;
    
    // Decrease confidence for vague indicators
    if (/\bmaybe\b|\bprobably\b|\bpossibly\b/i.test(text)) confidence -= 0.2;
    
    // Ensure valid date/time
    if (isNaN(start.getTime()) || isNaN(end.getTime())) confidence = 0;
    if (end <= start) confidence *= 0.5;

    return Math.max(0, Math.min(1, confidence));
}

/**
 * Format recurrence as RRULE
 */
export function formatRecurrenceAsRRule(recurrence: ParsedDateTime['recurrence']): string[] {
    if (!recurrence) return [];

    const parts: string[] = [];
    parts.push(`FREQ=${recurrence.frequency}`);
    
    if (recurrence.interval > 1) {
        parts.push(`INTERVAL=${recurrence.interval}`);
    }
    
    if (recurrence.byDay && recurrence.byDay.length > 0) {
        parts.push(`BYDAY=${recurrence.byDay.join(',')}`);
    }
    
    if (recurrence.count) {
        parts.push(`COUNT=${recurrence.count}`);
    }
    
    if (recurrence.until) {
        const until = recurrence.until.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        parts.push(`UNTIL=${until}`);
    }

    return [`RRULE:${parts.join(';')}`];
}

