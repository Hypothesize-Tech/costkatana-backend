/**
 * Binary Serialization for Cortex
 * Converts Cortex expressions to/from compact binary format
 */

import { CortexExpression, CortexQuery, CortexResponse } from '../types';
import { loggingService } from '../../services/logging.service';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);


/**
 * Binary format specification:
 * [Header: 4 bytes] [Version: 1 byte] [Flags: 1 byte] [Content Type: 1 byte] [Content Length: 4 bytes] [Content: N bytes]
 */
export class BinarySerializer {
  private static readonly HEADER = Buffer.from('CRTX'); // Magic header
  private static readonly VERSION = 0x01;
  
  // Content types
  private static readonly TYPE_EXPRESSION = 0x01;
  private static readonly TYPE_QUERY = 0x02;
  private static readonly TYPE_RESPONSE = 0x03;
  
  // Flags
  private static readonly FLAG_COMPRESSED = 0x01;
  private static readonly FLAG_ENCRYPTED = 0x02;
  
  // Primitive type mappings for compact encoding
  private static readonly primitiveMap = new Map<string, number>();
  private static readonly reversePrimitiveMap = new Map<number, string>();
  
  static {
    // Initialize primitive mappings
    const commonPrimitives = [
      'action_get', 'action_create', 'action_analyze', 'action_summarize',
      'concept_document', 'concept_person', 'concept_time', 'concept_data',
      'prop_name', 'prop_title', 'prop_sentiment', 'prop_cause'
    ];
    
    commonPrimitives.forEach((primitive, index) => {
      this.primitiveMap.set(primitive, index);
      this.reversePrimitiveMap.set(index, primitive);
    });
  }
  
  /**
   * Serialize Cortex expression to binary format
   */
  public static async serialize(
    data: CortexExpression | CortexQuery | CortexResponse,
    options: {
      compress?: boolean;
      encrypt?: boolean;
    } = {}
  ): Promise<Buffer> {
    try {
      // Determine content type
      let contentType: number;
      if ('expression' in data) {
        contentType = this.TYPE_QUERY;
      } else if ('response' in data) {
        contentType = this.TYPE_RESPONSE;
      } else {
        contentType = this.TYPE_EXPRESSION;
      }
      
      // Convert to compact JSON with primitive replacements
      const compactData = this.compactify(data);
      let content = Buffer.from(JSON.stringify(compactData));
      
      // Apply compression if requested
      let flags = 0;
      if (options.compress) {
        const compressed = await gzip(content);
        content = Buffer.from(compressed);
        flags |= this.FLAG_COMPRESSED;
      }
      
      // Apply encryption if requested
      if (options.encrypt) {
        const crypto = await import('crypto');
        const algorithm = 'aes-256-cbc';
        const key = crypto.scryptSync(
          process.env.CORTEX_ENCRYPTION_KEY || 'cortex-default-key-change-in-production',
          'salt',
          32
        );
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        
        const encrypted = Buffer.concat([
          cipher.update(content),
          cipher.final()
        ]);
        
        // Prepend IV to encrypted content
        content = Buffer.concat([iv, encrypted]);
        flags |= this.FLAG_ENCRYPTED;
      }
      
      // Build binary packet
      const header = Buffer.alloc(11);
      this.HEADER.copy(header, 0); // Magic header (4 bytes)
      header.writeUInt8(this.VERSION, 4); // Version (1 byte)
      header.writeUInt8(flags, 5); // Flags (1 byte)
      header.writeUInt8(contentType, 6); // Content type (1 byte)
      header.writeUInt32BE(content.length, 7); // Content length (4 bytes)
      
      // Combine header and content
      const binary = Buffer.concat([header, content]);
      
      loggingService.debug('Binary serialization complete', {
        originalSize: JSON.stringify(data).length,
        binarySize: binary.length,
        compressionRatio: options.compress 
          ? (1 - binary.length / JSON.stringify(data).length).toFixed(2)
          : 'N/A'
      });
      
      return binary;
    } catch (error) {
      loggingService.error('Binary serialization failed', { error });
      throw error;
    }
  }
  
  /**
   * Deserialize binary format back to Cortex expression
   */
  public static async deserialize(
    binary: Buffer
  ): Promise<CortexExpression | CortexQuery | CortexResponse> {
    try {
      // Validate header
      if (binary.length < 11) {
        throw new Error('Invalid binary format: too short');
      }
      
      const header = binary.slice(0, 4);
      if (!header.equals(this.HEADER)) {
        throw new Error('Invalid binary format: bad header');
      }
      
      // Read metadata
      const version = binary.readUInt8(4);
      if (version !== this.VERSION) {
        throw new Error(`Unsupported version: ${version}`);
      }
      
          const flags = binary.readUInt8(5);
    binary.readUInt8(6); // contentType - not used
    const contentLength = binary.readUInt32BE(7);
      
      // Extract content
      let content = binary.slice(11, 11 + contentLength);
      
      // Handle decryption if needed
      if (flags & this.FLAG_ENCRYPTED) {
        const crypto = await import('crypto');
        const algorithm = 'aes-256-cbc';
        const key = crypto.scryptSync(
          process.env.CORTEX_ENCRYPTION_KEY || 'cortex-default-key-change-in-production',
          'salt',
          32
        );
        
        // Extract IV from the beginning of content
        const iv = content.slice(0, 16);
        const encrypted = content.slice(16);
        
        const decipher = crypto.createDecipheriv(algorithm, key, iv);
        content = Buffer.concat([
          decipher.update(encrypted),
          decipher.final()
        ]);
      }
      
      // Handle decompression if needed
      if (flags & this.FLAG_COMPRESSED) {
        const decompressed = await gunzip(content);
        content = Buffer.from(decompressed);
      }
      
      // Parse JSON and expand primitives
      const compactData = JSON.parse(content.toString());
      const data = this.expand(compactData);
      
      loggingService.debug('Binary deserialization complete', {
        binarySize: binary.length,
        expandedSize: JSON.stringify(data).length
      });
      
      return data;
    } catch (error) {
      loggingService.error('Binary deserialization failed', { error });
      throw error;
    }
  }
  
  /**
   * Compactify data by replacing common primitives with numeric codes
   */
  private static compactify(data: any): any {
    if (typeof data === 'string') {
      // Replace known primitives with numeric codes
      if (this.primitiveMap.has(data)) {
        return { _p: this.primitiveMap.get(data) };
      }
      return data;
    }
    
    if (Array.isArray(data)) {
      return data.map(item => this.compactify(item));
    }
    
    if (typeof data === 'object' && data !== null) {
      const result: any = {};
      for (const [key, value] of Object.entries(data)) {
        result[key] = this.compactify(value);
      }
      return result;
    }
    
    return data;
  }
  
  /**
   * Expand compactified data back to full primitives
   */
  private static expand(data: any): any {
    if (typeof data === 'object' && data !== null && '_p' in data) {
      // Expand numeric code back to primitive
      const primitive = this.reversePrimitiveMap.get(data._p);
      if (primitive) {
        return primitive;
      }
      return `unknown_primitive_${data._p}`;
    }
    
    if (Array.isArray(data)) {
      return data.map(item => this.expand(item));
    }
    
    if (typeof data === 'object' && data !== null) {
      const result: any = {};
      for (const [key, value] of Object.entries(data)) {
        result[key] = this.expand(value);
      }
      return result;
    }
    
    return data;
  }
  
  /**
   * Calculate size reduction achieved by binary serialization
   */
  public static calculateSizeReduction(
    original: any,
    binary: Buffer
  ): {
    originalSize: number;
    binarySize: number;
    reduction: number;
    percentage: string;
  } {
    const originalSize = JSON.stringify(original).length;
    const binarySize = binary.length;
    const reduction = originalSize - binarySize;
    const percentage = ((reduction / originalSize) * 100).toFixed(2);
    
    return {
      originalSize,
      binarySize,
      reduction,
      percentage: `${percentage}%`
    };
  }
}

/**
 * Protocol Buffer-like schema definition for stronger typing
 */
export interface CortexBinarySchema {
  version: number;
  fields: {
    [key: string]: {
      type: 'string' | 'number' | 'boolean' | 'array' | 'object';
      id: number;
      optional?: boolean;
      repeated?: boolean;
    };
  };
}

/**
 * Schema-based binary encoder for even more compact representation
 */
export class SchemaBasedSerializer {
  private fieldMap: Map<string, number>;
  private reverseFieldMap: Map<number, string>;
  
  constructor(private schema: CortexBinarySchema) {
    this.fieldMap = new Map();
    this.reverseFieldMap = new Map();
    
    // Build field mappings from schema
    Object.entries(schema.fields).forEach(([name, field]) => {
      this.fieldMap.set(name, field.id);
      this.reverseFieldMap.set(field.id, name);
    });
  }
  
  public encode(data: any): Buffer {
    const encoded: number[] = [];
    
    // Write version
    encoded.push(this.schema.version);
    
    // Encode each field
    Object.entries(data).forEach(([key, value]) => {
      const field = this.schema.fields[key];
      if (!field) return; // Skip unknown fields
      
      // Write field ID
      encoded.push(field.id);
      
      // Encode value based on type
      const valueBuffer = this.encodeValue(value, field.type, field.repeated);
      encoded.push(valueBuffer.length);
      for (let i = 0; i < valueBuffer.length; i++) {
        encoded.push(valueBuffer[i]);
      }
    });
    
    // Write end marker
    encoded.push(0xFF);
    
    return Buffer.from(encoded);
  }
  
  public decode(buffer: Buffer): any {
    const result: any = {};
    let offset = 0;
    
    // Read version
    const version = buffer.readUInt8(offset++);
    if (version !== this.schema.version) {
      throw new Error(`Schema version mismatch: expected ${this.schema.version}, got ${version}`);
    }
    
    // Read fields until end marker
    while (offset < buffer.length) {
      const fieldId = buffer.readUInt8(offset++);
      
      // Check for end marker
      if (fieldId === 0xFF) break;
      
      const fieldName = this.reverseFieldMap.get(fieldId);
      if (!fieldName) {
        throw new Error(`Unknown field ID: ${fieldId}`);
      }
      
      const field = this.schema.fields[fieldName];
      const valueLength = buffer.readUInt8(offset++);
      const valueBuffer = buffer.slice(offset, offset + valueLength);
      offset += valueLength;
      
      result[fieldName] = this.decodeValue(valueBuffer, field.type, field.repeated);
    }
    
    return result;
  }
  
  private encodeValue(value: any, type: string, repeated?: boolean): Buffer {
    if (repeated && Array.isArray(value)) {
      const buffers = value.map(v => this.encodeSingleValue(v, type));
      return Buffer.concat(buffers);
    }
    return this.encodeSingleValue(value, type);
  }
  
  private encodeSingleValue(value: any, type: string): Buffer {
    switch (type) {
      case 'string':
        return Buffer.from(value || '', 'utf8');
      case 'number':
        const numBuffer = Buffer.allocUnsafe(8);
        numBuffer.writeDoubleLE(value || 0, 0);
        return numBuffer;
      case 'boolean':
        return Buffer.from([value ? 1 : 0]);
      case 'object':
        return Buffer.from(JSON.stringify(value || {}), 'utf8');
      case 'array':
        return Buffer.from(JSON.stringify(value || []), 'utf8');
      default:
        return Buffer.from(JSON.stringify(value), 'utf8');
    }
  }
  
  private decodeValue(buffer: Buffer, type: string, repeated?: boolean): any {
    if (repeated) {
      // For simplicity, assuming single value for now
      // In production, would need length prefixes for each array element
      return [this.decodeSingleValue(buffer, type)];
    }
    return this.decodeSingleValue(buffer, type);
  }
  
  private decodeSingleValue(buffer: Buffer, type: string): any {
    switch (type) {
      case 'string':
        return buffer.toString('utf8');
      case 'number':
        return buffer.readDoubleLE(0);
      case 'boolean':
        return buffer.readUInt8(0) === 1;
      case 'object':
      case 'array':
        return JSON.parse(buffer.toString('utf8'));
      default:
        return JSON.parse(buffer.toString('utf8'));
    }
  }
}
