export type CortexPrimitive = string | number | boolean | null;

export interface CortexRole {
    name: string;
    description: string;
    type: 'string' | 'number' | 'boolean' | 'array';
    required: boolean;
}

export function isCortexRole(obj: any): obj is CortexRole {
    return obj && typeof obj.name === 'string' && typeof obj.description === 'string';
}
