import { BedrockService } from './bedrock.service';
import { S3Service } from './s3.service';
import { PromptTemplate } from '../models/PromptTemplate';
import { Activity } from '../models/Activity';
import { loggingService } from './logging.service';
import mongoose from 'mongoose';
import { EventEmitter } from 'events';

interface CriterionInput {
    name: string;
    text: string;
}

interface ExtractedFeatures {
    extractedAt: Date;
    extractedBy: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    errorMessage?: string;
    analysis: {
        visualDescription: string;
        structuredData: {
            colors: {
                dominant: string[];
                accent: string[];
                background: string;
            };
            layout: {
                composition: string;
                orientation: string;
                spacing: string;
            };
            objects: Array<{
                name: string;
                position: string;
                description: string;
                attributes: Record<string, any>;
            }>;
            text: {
                detected: string[];
                prominent: string[];
                language?: string;
            };
            lighting: {
                type: string;
                direction: string;
                quality: string;
            };
            quality: {
                sharpness: string;
                clarity: string;
                professionalGrade: boolean;
            };
        };
        criteriaAnalysis: Array<{
            criterionId: string;
            criterionText: string;
            referenceState: {
                status: 'compliant' | 'non-compliant' | 'example';
                description: string;
                specificDetails: string;
                measurableAttributes: Record<string, any>;
                visualIndicators: string[];
            };
            comparisonInstructions: {
                whatToCheck: string;
                howToMeasure: string;
                passCriteria: string;
                failCriteria: string;
                edgeCases: string[];
            };
            confidence: number;
        }>;
    };
    extractionCost: {
        initialCallTokens: { input: number; output: number; cost: number };
        followUpCalls: Array<{ reason: string; input: number; output: number; cost: number }>;
        totalTokens: number;
        totalCost: number;
    };
    usage: {
        checksPerformed: number;
        totalTokensSaved: number;
        totalCostSaved: number;
        averageConfidence: number;
        lowConfidenceCount: number;
        lastUsedAt?: Date;
    };
}

interface ValidationResult {
    valid: boolean;
    missing: string[];
}

export class ReferenceImageAnalysisService {
    private static readonly MODEL_ID = 'us.anthropic.claude-3-5-sonnet-20241022-v2:0';
    private static extractionEmitter = new EventEmitter();

    /**
     * Get extraction event emitter for SSE subscriptions
     */
    static getExtractionEmitter(): EventEmitter {
        return this.extractionEmitter;
    }

    /**
     * Build comprehensive extraction prompt
     */
    private static buildExtractionPrompt(criteria: CriterionInput[], industry: string): string {
        return `You are analyzing a reference image for visual compliance checking in the ${industry} industry.

TASK: Extract comprehensive information for future compliance comparison checks.

Please analyze the image and provide a detailed JSON response with the following structure:

1. VISUAL DESCRIPTION:
   Provide a detailed natural language description of the image (2-3 sentences).

2. STRUCTURED DATA:
   Extract the following elements:
   - Colors: dominant colors (array), accent colors (array), background color (string)
   - Layout: composition (string), orientation (string), spacing (string)
   - Objects: array of objects with name, position, description, and attributes
   - Text: detected text (array), prominent text (array), language (optional)
   - Lighting: type (string), direction (string), quality (string)
   - Quality: sharpness (string), clarity (string), professionalGrade (boolean)

3. PER-CRITERION ANALYSIS (CRITICAL):
   For each compliance criterion below, analyze the reference image:

${criteria.map((c, i) => `
   CRITERION ${i + 1}: "${c.text}"
   
   Provide:
   a) Reference State:
      - status: Is this showing "compliant", "non-compliant", or "example"?
      - description: Describe what you see related to this criterion (natural language)
      - specificDetails: What specific details should we look for? (string)
      - measurableAttributes: Any quantifiable data related to this criterion (object)
      - visualIndicators: List of visual cues to identify this criterion (array of strings)
   
   b) Comparison Instructions:
      - whatToCheck: What should we check in evidence images? (string)
      - howToMeasure: How to measure/verify this criterion? (string)
      - passCriteria: What constitutes passing this criterion? (string)
      - failCriteria: What constitutes failing this criterion? (string)
      - edgeCases: Known ambiguous scenarios (array of strings)
   
   c) Confidence: Rate 0-1 how clear this criterion is in the reference image (number)
`).join('\n')}

FORMAT: Return ONLY valid JSON matching this exact schema:
{
  "visualDescription": "string",
  "structuredData": {
    "colors": { "dominant": ["string"], "accent": ["string"], "background": "string" },
    "layout": { "composition": "string", "orientation": "string", "spacing": "string" },
    "objects": [{ "name": "string", "position": "string", "description": "string", "attributes": {} }],
    "text": { "detected": ["string"], "prominent": ["string"], "language": "string" },
    "lighting": { "type": "string", "direction": "string", "quality": "string" },
    "quality": { "sharpness": "string", "clarity": "string", "professionalGrade": false }
  },
  "criteriaAnalysis": [
    {
      "criterionId": "criterion_1",
      "criterionText": "string",
      "referenceState": {
        "status": "compliant",
        "description": "string",
        "specificDetails": "string",
        "measurableAttributes": {},
        "visualIndicators": ["string"]
      },
      "comparisonInstructions": {
        "whatToCheck": "string",
        "howToMeasure": "string",
        "passCriteria": "string",
        "failCriteria": "string",
        "edgeCases": ["string"]
      },
      "confidence": 0.95
    }
  ]
}

Important: Ensure all fields are present and properly formatted. Return ONLY the JSON, no markdown formatting or additional text.`;
    }

    /**
     * Validate extraction response completeness
     */
    private static validateExtraction(response: any, expectedCriteriaCount: number): ValidationResult {
        const missing: string[] = [];

        if (!response.visualDescription) {
            missing.push('visualDescription');
        }

        if (!response.structuredData) {
            missing.push('structuredData');
        } else {
            if (!response.structuredData.colors) missing.push('structuredData.colors');
            if (!response.structuredData.layout) missing.push('structuredData.layout');
            if (!response.structuredData.objects) missing.push('structuredData.objects');
            if (!response.structuredData.text) missing.push('structuredData.text');
            if (!response.structuredData.lighting) missing.push('structuredData.lighting');
            if (!response.structuredData.quality) missing.push('structuredData.quality');
        }

        if (!response.criteriaAnalysis || !Array.isArray(response.criteriaAnalysis)) {
            missing.push('criteriaAnalysis');
        } else if (response.criteriaAnalysis.length !== expectedCriteriaCount) {
            missing.push(`criteriaAnalysis (expected ${expectedCriteriaCount}, got ${response.criteriaAnalysis.length})`);
        } else {
            // Validate each criterion analysis
            response.criteriaAnalysis.forEach((ca: any, index: number) => {
                if (!ca.criterionId) missing.push(`criteriaAnalysis[${index}].criterionId`);
                if (!ca.criterionText) missing.push(`criteriaAnalysis[${index}].criterionText`);
                if (!ca.referenceState) missing.push(`criteriaAnalysis[${index}].referenceState`);
                if (!ca.comparisonInstructions) missing.push(`criteriaAnalysis[${index}].comparisonInstructions`);
                if (typeof ca.confidence !== 'number') missing.push(`criteriaAnalysis[${index}].confidence`);
            });
        }

        return {
            valid: missing.length === 0,
            missing
        };
    }

    /**
     * Build follow-up prompt for missing data
     */
    private static buildFollowUpPrompt(missing: string[], criteria: CriterionInput[]): string {
        return `The previous analysis was incomplete. Please provide the following missing information:

MISSING FIELDS:
${missing.join('\n')}

Reference the same image and provide the missing data in JSON format. Focus specifically on completing these fields.

${missing.some(m => m.includes('criteriaAnalysis')) ? `
CRITERIA FOR REFERENCE:
${criteria.map((c, i) => `${i + 1}. ${c.text}`).join('\n')}
` : ''}

Return ONLY valid JSON with the missing fields populated. No markdown or additional text.`;
    }

    /**
     * Merge initial and follow-up responses
     */
    private static mergeResponses(initial: any, followUp: any): any {
        return {
            ...initial,
            ...followUp,
            structuredData: {
                ...(initial.structuredData || {}),
                ...(followUp.structuredData || {})
            },
            criteriaAnalysis: followUp.criteriaAnalysis || initial.criteriaAnalysis || []
        };
    }

    /**
     * Main extraction method
     */
    static async extractReferenceFeatures(
        imageUrl: string,
        criteria: CriterionInput[],
        industry: string,
        templateId: string,
        userId: string
    ): Promise<ExtractedFeatures> {
        const startTime = Date.now();
        let initialResponse: any;
        let initialTokens = { input: 0, output: 0, cost: 0 };
        const followUpCalls: Array<{ reason: string; input: number; output: number; cost: number }> = [];

        try {
            // Update status to processing
            await this.updateExtractionStatus(templateId, 'processing');

            // Step 1: Build extraction prompt
            const extractionPrompt = this.buildExtractionPrompt(criteria, industry);

            loggingService.info('Starting reference image feature extraction', {
                component: 'ReferenceImageAnalysisService',
                operation: 'extractReferenceFeatures',
                templateId,
                criteriaCount: criteria.length,
                industry
            });

            // Step 2: Make initial LLM call with image
            const initialResult = await BedrockService.invokeWithImage(
                extractionPrompt,
                imageUrl,
                userId,
                this.MODEL_ID
            );

            initialTokens = {
                input: initialResult.inputTokens || 0,
                output: initialResult.outputTokens || 0,
                cost: initialResult.cost || 0
            };

            // Try to parse the response
            try {
                initialResponse = JSON.parse(initialResult.response);
            } catch (parseError) {
                // Try to extract JSON from response
                const jsonMatch = initialResult.response.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    initialResponse = JSON.parse(jsonMatch[0]);
                } else {
                    throw new Error('Could not parse JSON from LLM response');
                }
            }

            // Step 3: Validate response completeness
            const validation = this.validateExtraction(initialResponse, criteria.length);

            // Step 4: If validation fails, make follow-up call
            if (!validation.valid) {
                loggingService.warn('Initial extraction incomplete, making follow-up call', {
                    component: 'ReferenceImageAnalysisService',
                    missing: validation.missing
                });

                const followUpPrompt = this.buildFollowUpPrompt(validation.missing, criteria);

                const followUpResult = await BedrockService.invokeWithImage(
                    followUpPrompt,
                    imageUrl,
                    userId,
                    this.MODEL_ID
                );

                followUpCalls.push({
                    reason: `Missing fields: ${validation.missing.join(', ')}`,
                    input: followUpResult.inputTokens || 0,
                    output: followUpResult.outputTokens || 0,
                    cost: followUpResult.cost || 0
                });

                let followUpResponse: any;
                try {
                    followUpResponse = JSON.parse(followUpResult.response);
                } catch (parseError) {
                    const jsonMatch = followUpResult.response.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        followUpResponse = JSON.parse(jsonMatch[0]);
                    } else {
                        loggingService.warn('Could not parse follow-up response, using initial data');
                        followUpResponse = {};
                    }
                }

                // Merge responses
                initialResponse = this.mergeResponses(initialResponse, followUpResponse);
            }

            // Step 5: Calculate total cost
            const totalTokens = initialTokens.input + initialTokens.output + 
                followUpCalls.reduce((sum, call) => sum + call.input + call.output, 0);
            const totalCost = initialTokens.cost + 
                followUpCalls.reduce((sum, call) => sum + call.cost, 0);

            // Step 6: Build extracted features object
            const extractedFeatures: ExtractedFeatures = {
                extractedAt: new Date(),
                extractedBy: this.MODEL_ID,
                status: 'completed',
                analysis: {
                    visualDescription: initialResponse.visualDescription || '',
                    structuredData: initialResponse.structuredData || {
                        colors: { dominant: [], accent: [], background: '' },
                        layout: { composition: '', orientation: '', spacing: '' },
                        objects: [],
                        text: { detected: [], prominent: [], language: '' },
                        lighting: { type: '', direction: '', quality: '' },
                        quality: { sharpness: '', clarity: '', professionalGrade: false }
                    },
                    criteriaAnalysis: initialResponse.criteriaAnalysis || []
                },
                extractionCost: {
                    initialCallTokens: initialTokens,
                    followUpCalls,
                    totalTokens,
                    totalCost
                },
                usage: {
                    checksPerformed: 0,
                    totalTokensSaved: 0,
                    totalCostSaved: 0,
                    averageConfidence: 0,
                    lowConfidenceCount: 0
                }
            };

            // Step 7: Update template with extracted features
            await PromptTemplate.findByIdAndUpdate(templateId, {
                'referenceImage.extractedFeatures': extractedFeatures
            });

            // Step 8: Log activity
            await Activity.create({
                userId: new mongoose.Types.ObjectId(userId),
                type: 'reference_features_extracted',
                title: 'Reference Image Features Extracted',
                description: `Successfully extracted features from reference image for template`,
                metadata: {
                    templateId: new mongoose.Types.ObjectId(templateId),
                    criteriaCount: criteria.length,
                    totalTokens,
                    totalCost,
                    extractionTime: Date.now() - startTime,
                    followUpCallsCount: followUpCalls.length
                }
            });

            loggingService.info('Reference image feature extraction completed', {
                component: 'ReferenceImageAnalysisService',
                operation: 'extractReferenceFeatures',
                templateId,
                totalTokens,
                totalCost,
                followUpCallsCount: followUpCalls.length,
                extractionTime: Date.now() - startTime
            });

            return extractedFeatures;

        } catch (error) {
            loggingService.error('Error extracting reference image features', {
                component: 'ReferenceImageAnalysisService',
                operation: 'extractReferenceFeatures',
                error: error instanceof Error ? error.message : String(error),
                templateId
            });

            // Update status to failed
            await this.updateExtractionStatus(
                templateId,
                'failed',
                error instanceof Error ? error.message : 'Unknown error'
            );

            // Log failure activity
            await Activity.create({
                userId: new mongoose.Types.ObjectId(userId),
                type: 'reference_extraction_failed',
                title: 'Reference Image Feature Extraction Failed',
                description: error instanceof Error ? error.message : 'Unknown error',
                metadata: {
                    templateId: new mongoose.Types.ObjectId(templateId),
                    criteriaCount: criteria.length,
                    extractionTime: Date.now() - startTime
                }
            });

            throw error;
        }
    }

    /**
     * Update extraction status
     */
    static async updateExtractionStatus(
        templateId: string,
        status: 'pending' | 'processing' | 'completed' | 'failed',
        errorMessage?: string
    ): Promise<void> {
        const update: any = {
            'referenceImage.extractedFeatures.status': status
        };

        if (errorMessage) {
            update['referenceImage.extractedFeatures.errorMessage'] = errorMessage;
        }

        await PromptTemplate.findByIdAndUpdate(templateId, update);

        loggingService.info('Reference image extraction status updated', {
            component: 'ReferenceImageAnalysisService',
            operation: 'updateExtractionStatus',
            templateId,
            status,
            errorMessage
        });

        // Emit event for SSE subscribers
        const template = await PromptTemplate.findById(templateId);
        const extractionData: any = {
            templateId,
            status,
            errorMessage
        };

        if (template?.referenceImage?.extractedFeatures) {
            const features = template.referenceImage.extractedFeatures;
            extractionData.extractedAt = features.extractedAt;
            extractionData.extractedBy = features.extractedBy;
            extractionData.usage = features.usage;
            extractionData.extractionCost = features.extractionCost?.totalCost;
        }

        this.extractionEmitter.emit('status_update', extractionData);

        loggingService.info('Emitted extraction status update event', {
            component: 'ReferenceImageAnalysisService',
            operation: 'updateExtractionStatus',
            templateId,
            status
        });
    }

    /**
     * Retry extraction
     */
    static async retryExtraction(templateId: string, userId: string): Promise<ExtractedFeatures> {
        const template = await PromptTemplate.findById(templateId);
        
        if (!template) {
            throw new Error('Template not found');
        }

        if (!template.referenceImage || !template.referenceImage.s3Url) {
            throw new Error('No reference image found for this template');
        }

        if (!template.isVisualCompliance || !template.visualComplianceConfig) {
            throw new Error('Template is not a visual compliance template');
        }

        // Extract criteria from variables
        const criteria: CriterionInput[] = template.variables
            .filter(v => v.name.startsWith('criterion_'))
            .map(v => ({
                name: v.name,
                text: v.defaultValue || v.description || ''
            }));

        // Generate presigned URL for the image
        const s3Key = S3Service.s3UrlToKey(template.referenceImage.s3Url);
        const imageUrl = await S3Service.generatePresignedUrl(s3Key, 3600);

        return this.extractReferenceFeatures(
            imageUrl,
            criteria,
            template.visualComplianceConfig.industry,
            templateId,
            userId
        );
    }

    /**
     * Re-extract for criteria change
     */
    static async reExtractForCriteriaChange(
        templateId: string,
        newCriteria: CriterionInput[],
        userId: string
    ): Promise<ExtractedFeatures> {
        const template = await PromptTemplate.findById(templateId);
        
        if (!template) {
            throw new Error('Template not found');
        }

        if (!template.referenceImage || !template.referenceImage.s3Url) {
            throw new Error('No reference image found for this template');
        }

        if (!template.visualComplianceConfig) {
            throw new Error('Template is not a visual compliance template');
        }

        // Generate presigned URL for the image
        const s3Key = S3Service.s3UrlToKey(template.referenceImage.s3Url);
        const imageUrl = await S3Service.generatePresignedUrl(s3Key, 3600);

        // Log activity
        await Activity.create({
            userId: new mongoose.Types.ObjectId(userId),
            type: 'reference_features_updated',
            title: 'Reference Features Re-extracted',
            description: `Re-extracted features due to criteria change`,
            metadata: {
                templateId: new mongoose.Types.ObjectId(templateId),
                newCriteriaCount: newCriteria.length
            }
        });

        return this.extractReferenceFeatures(
            imageUrl,
            newCriteria,
            template.visualComplianceConfig.industry,
            templateId,
            userId
        );
    }
}

