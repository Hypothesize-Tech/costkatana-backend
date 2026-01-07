import { MCPToolResult } from './mongodbMcp.service';

/**
 * MongoDB Result Formatter Service
 * 
 * Formats MCP tool results for various display modes in chat
 */

export interface FormattedResult {
    type: 'table' | 'json' | 'schema' | 'stats' | 'chart' | 'text' | 'error';
    data: any;
    markdown?: string;
    exportable?: boolean;
}

export class MongoDBResultFormatterService {
    /**
     * Format MCP result for chat display
     */
    static formatForChat(result: MCPToolResult, preferredFormat?: string): FormattedResult {
        if (result.isError) {
            return this.formatAsError(result);
        }

        const content = result.content[0]?.text;
        if (!content) {
            return {
                type: 'text',
                data: null,
                markdown: '_No results found_',
            };
        }

        try {
            const parsed = JSON.parse(content);

            // Auto-detect best format if not specified
            const format = preferredFormat || this.detectBestFormat(parsed);

            switch (format) {
                case 'table':
                    return this.formatAsTable(parsed);
                case 'json':
                    return this.formatAsJSON(parsed);
                case 'schema':
                    return this.formatAsSchemaTree(parsed);
                case 'stats':
                    return this.formatAsStats(parsed);
                case 'chart':
                    return this.formatAsChartData(parsed);
                default:
                    return this.formatAsJSON(parsed);
            }
        } catch (error) {
            return this.formatAsText(content);
        }
    }

    /**
     * Auto-detect best format for data
     */
    static detectBestFormat(data: any): 'table' | 'json' | 'schema' | 'stats' | 'chart' {
        if (data.schema || data.fields) return 'schema';
        if (data.stats || data.count !== undefined) return 'stats';
        if (data.documents && Array.isArray(data.documents)) return 'table';
        if (data.results && Array.isArray(data.results)) return 'table';
        if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') return 'table';
        if (this.hasNumericData(data)) return 'chart';
        return 'json';
    }

    /**
     * Check if data contains numeric values suitable for charts
     */
    private static hasNumericData(data: any): boolean {
        if (Array.isArray(data)) {
            return data.some(item => 
                typeof item === 'object' && 
                Object.values(item).some(v => typeof v === 'number')
            );
        }
        return false;
    }

    /**
     * Format as markdown table
     */
    static formatAsTable(data: any): FormattedResult {
        let documents: any[] = [];

        // Extract documents from various possible structures
        if (data.documents && Array.isArray(data.documents)) {
            documents = data.documents;
        } else if (data.results && Array.isArray(data.results)) {
            documents = data.results;
        } else if (Array.isArray(data)) {
            documents = data;
        } else {
            documents = [data];
        }

        if (documents.length === 0) {
            return {
                type: 'table',
                data: [],
                markdown: '_No documents found_',
            };
        }

        // Get all unique keys from all documents
        const allKeys = new Set<string>();
        documents.forEach(doc => {
            Object.keys(doc).forEach(key => allKeys.add(key));
        });

        // Limit columns to first 10 keys
        const keys = Array.from(allKeys).slice(0, 10);

        // Build markdown table
        let markdown = '| ' + keys.join(' | ') + ' |\n';
        markdown += '| ' + keys.map(() => '---').join(' | ') + ' |\n';

        documents.slice(0, 50).forEach(doc => {
            const row = keys.map(key => {
                const value = doc[key];
                if (value === null || value === undefined) return '_null_';
                if (typeof value === 'object') return JSON.stringify(value).substring(0, 50);
                return String(value).substring(0, 50);
            });
            markdown += '| ' + row.join(' | ') + ' |\n';
        });

        if (documents.length > 50) {
            markdown += `\n_Showing 50 of ${documents.length} documents_`;
        }

        return {
            type: 'table',
            data: documents,
            markdown,
            exportable: true,
        };
    }

    /**
     * Format as pretty-printed JSON
     */
    static formatAsJSON(data: any): FormattedResult {
        const jsonString = JSON.stringify(data, null, 2);
        const markdown = '```json\n' + jsonString + '\n```';

        return {
            type: 'json',
            data,
            markdown,
            exportable: true,
        };
    }

    /**
     * Format schema as tree visualization
     */
    static formatAsSchemaTree(data: any): FormattedResult {
        const schema = data.schema || data.fields || data;

        let markdown = '**Schema Structure:**\n\n';

        const formatField = (name: string, info: any, indent: number = 0): string => {
            const prefix = '  '.repeat(indent);
            let line = `${prefix}- **${name}**`;

            if (info.type) {
                line += ` _(${info.type})_`;
            }

            if (info.nullable !== undefined) {
                line += info.nullable ? ' `nullable`' : ' `required`';
            }

            if (info.count !== undefined) {
                line += ` - Found in ${info.count} documents`;
            }

            if (info.unique !== undefined && info.unique) {
                line += ' `unique`';
            }

            if (info.samples && info.samples.length > 0) {
                const sampleValue = info.samples[0];
                if (typeof sampleValue === 'string' && sampleValue.length < 50) {
                    line += ` - Example: \`${sampleValue}\``;
                }
            }

            line += '\n';

            // Handle nested fields
            if (info.fields || info.properties) {
                const nestedFields = info.fields || info.properties;
                Object.entries(nestedFields).forEach(([nestedName, nestedInfo]: [string, any]) => {
                    line += formatField(nestedName, nestedInfo, indent + 1);
                });
            }

            return line;
        };

        if (typeof schema === 'object' && !Array.isArray(schema)) {
            Object.entries(schema).forEach(([fieldName, fieldInfo]: [string, any]) => {
                markdown += formatField(fieldName, fieldInfo);
            });
        } else {
            markdown += '```json\n' + JSON.stringify(schema, null, 2) + '\n```';
        }

        return {
            type: 'schema',
            data: schema,
            markdown,
            exportable: true,
        };
    }

    /**
     * Format statistics as cards/metrics
     */
    static formatAsStats(data: any): FormattedResult {
        const stats = data.stats || data;

        let markdown = '**Statistics:**\n\n';

        const formatStat = (label: string, value: any): string => {
            if (typeof value === 'number') {
                if (value > 1024 * 1024) {
                    // Format as MB
                    return `**${label}:** ${(value / 1024 / 1024).toFixed(2)} MB`;
                } else if (value > 1024) {
                    // Format as KB
                    return `**${label}:** ${(value / 1024).toFixed(2)} KB`;
                } else {
                    return `**${label}:** ${value.toLocaleString()}`;
                }
            }
            return `**${label}:** ${String(value)}`;
        };

        // Common stat fields
        const statFields = [
            { key: 'count', label: 'Document Count' },
            { key: 'size', label: 'Data Size' },
            { key: 'avgObjSize', label: 'Average Document Size' },
            { key: 'storageSize', label: 'Storage Size' },
            { key: 'nindexes', label: 'Index Count' },
            { key: 'totalIndexSize', label: 'Total Index Size' },
            { key: 'collections', label: 'Collections' },
            { key: 'dataSize', label: 'Total Data Size' },
        ];

        statFields.forEach(({ key, label }) => {
            if (stats[key] !== undefined) {
                markdown += `${formatStat(label, stats[key])}\n\n`;
            }
        });

        return {
            type: 'stats',
            data: stats,
            markdown,
            exportable: false,
        };
    }

    /**
     * Format as chart data
     */
    static formatAsChartData(data: any): FormattedResult {
        let documents: any[] = [];

        if (data.documents && Array.isArray(data.documents)) {
            documents = data.documents;
        } else if (Array.isArray(data)) {
            documents = data;
        }

        // Find numeric fields
        const numericFields: string[] = [];
        if (documents.length > 0) {
            Object.entries(documents[0]).forEach(([key, value]) => {
                if (typeof value === 'number') {
                    numericFields.push(key);
                }
            });
        }

        const chartData = {
            labels: documents.slice(0, 20).map((_, i) => `Doc ${i + 1}`),
            datasets: numericFields.slice(0, 3).map(field => ({
                label: field,
                data: documents.slice(0, 20).map(doc => doc[field] || 0),
            })),
        };

        const markdown = `**Chart Data (${numericFields.length} numeric fields found)**\n\n` +
            '```json\n' + JSON.stringify(chartData, null, 2) + '\n```';

        return {
            type: 'chart',
            data: chartData,
            markdown,
            exportable: true,
        };
    }

    /**
     * Format as plain text
     */
    static formatAsText(text: string): FormattedResult {
        return {
            type: 'text',
            data: text,
            markdown: text,
            exportable: false,
        };
    }

    /**
     * Format error
     */
    static formatAsError(result: MCPToolResult): FormattedResult {
        const errorText = result.content[0]?.text || 'An unknown error occurred';
        return {
            type: 'error',
            data: { error: errorText },
            markdown: `⚠️ **Error:** ${errorText}`,
            exportable: false,
        };
    }

    /**
     * Export as CSV
     */
    static exportAsCSV(data: any): string {
        let documents: any[] = [];

        if (data.documents && Array.isArray(data.documents)) {
            documents = data.documents;
        } else if (Array.isArray(data)) {
            documents = data;
        } else {
            documents = [data];
        }

        if (documents.length === 0) {
            return '';
        }

        // Get all keys
        const keys = Array.from(
            new Set(documents.flatMap(doc => Object.keys(doc)))
        );

        // CSV header
        let csv = keys.join(',') + '\n';

        // CSV rows
        documents.forEach(doc => {
            const row = keys.map(key => {
                const value = doc[key];
                if (value === null || value === undefined) return '';
                if (typeof value === 'object') return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
                const str = String(value);
                if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                    return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
            });
            csv += row.join(',') + '\n';
        });

        return csv;
    }

    /**
     * Export as JSON
     */
    static exportAsJSON(data: any): string {
        return JSON.stringify(data, null, 2);
    }

    /**
     * Export as SQL INSERT statements
     */
    static exportAsSQL(data: any, tableName: string = 'documents'): string {
        let documents: any[] = [];

        if (data.documents && Array.isArray(data.documents)) {
            documents = data.documents;
        } else if (Array.isArray(data)) {
            documents = data;
        } else {
            documents = [data];
        }

        if (documents.length === 0) {
            return '';
        }

        const keys = Array.from(
            new Set(documents.flatMap(doc => Object.keys(doc)))
        );

        let sql = '';

        documents.forEach(doc => {
            const values = keys.map(key => {
                const value = doc[key];
                if (value === null || value === undefined) return 'NULL';
                if (typeof value === 'number') return String(value);
                if (typeof value === 'boolean') return value ? '1' : '0';
                if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
                return `'${String(value).replace(/'/g, "''")}'`;
            });

            sql += `INSERT INTO ${tableName} (${keys.join(', ')}) VALUES (${values.join(', ')});\n`;
        });

        return sql;
    }
}
