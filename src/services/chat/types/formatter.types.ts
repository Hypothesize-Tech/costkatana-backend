/**
 * Integration Formatter Types
 * Shared types for all integration result formatters
 */

export interface MCPResult {
    metadata?: {
        operation?: string;
        [key: string]: any;
    };
    data?: unknown;
}

export interface FormattedResult {
    type: string;
    data: unknown;
}

export interface ListItem {
    id: string | number;
    title: string;
    description: string;
    url?: string;
    html_url?: string;
    metadata?: Record<string, any>;
}

export interface FormattedListResult extends FormattedResult {
    type: 'list';
    data: {
        items: ListItem[];
        count: number;
        title: string;
    };
}

export interface FormattedTableResult extends FormattedResult {
    type: 'table';
    data: any;
}

export interface FormattedJSONResult extends FormattedResult {
    type: 'json';
    data: any;
}
