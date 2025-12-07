/**
 * Prompt Compiler Service
 * 
 * Compiles natural language prompts into optimized IR:
 * 1. Parse: Natural Language → AST
 * 2. Analyze: Build dependency graph, detect patterns
 * 3. Optimize: Apply optimization passes
 * 4. Generate: IR → Optimized prompt
 */

import { loggingService } from '../services/logging.service';
import {
  ProgramNode,
  IRProgram,
  CompilationResult,
  OptimizationPassResult,
  IROpcode,
  IRInstruction,
  StatementNode,
  ContextNode,
  OutputFormatNode,
  ConstraintNode,
  InstructionNode
} from './promptAST.types';

export class PromptCompilerService {
  /**
   * Compile prompt with full optimization pipeline
   */
  static async compile(
    prompt: string,
    options: {
      optimizationLevel?: 0 | 1 | 2 | 3; // 0=none, 3=aggressive
      targetTokens?: number;
      preserveQuality?: boolean;
      enableParallelization?: boolean;
    } = {}
  ): Promise<CompilationResult> {
    const startTime = Date.now();
    const {
      optimizationLevel = 2,
      targetTokens,
      preserveQuality = true,
      enableParallelization = true
    } = options;

    try {
      loggingService.info('Starting prompt compilation', {
        promptLength: prompt.length,
        optimizationLevel,
        preserveQuality
      });

      // Stage 1: Parse to AST
      const ast = await this.parse(prompt);
      const originalTokens = this.estimateTokens(prompt);

      // Stage 2: Semantic Analysis
      const analysisResult = await this.analyze(ast);

      // Stage 3: Optimization Passes
      let optimizedAST = ast;
      const optimizationResults: OptimizationPassResult[] = [];

      if (optimizationLevel > 0) {
        // Pass 1: Dead code elimination
        const deadCodeResult = await this.eliminateDeadCode(optimizedAST);
        optimizedAST = deadCodeResult.ast;
        optimizationResults.push(deadCodeResult.result);

        if (optimizationLevel >= 2) {
          // Pass 2: Constant folding
          const constantFoldResult = await this.foldConstants(optimizedAST);
          optimizedAST = constantFoldResult.ast;
          optimizationResults.push(constantFoldResult.result);

          // Pass 3: Context compression - conditionally compress less if preserveQuality is true
          const compressionResult = await this.compressContext(
            optimizedAST,
            targetTokens
          );
          optimizedAST = compressionResult.ast;
          optimizationResults.push(compressionResult.result);
        }

        if (optimizationLevel >= 3 && !preserveQuality) {
          // Pass 4: Aggressive token reduction, only if not preserving quality
          const aggressiveResult = await this.aggressiveOptimization(optimizedAST, targetTokens);
          optimizedAST = aggressiveResult.ast;
          optimizationResults.push(aggressiveResult.result);
        }
      }

      // Stage 4: Generate IR
      const ir = await this.generateIR(optimizedAST, {
        enableParallelization,
        analysisResult
      });

      // Stage 5: Code generation (IR → optimized prompt)
      const optimizedPrompt = await this.generateCode(ir);
      const optimizedTokens = this.estimateTokens(optimizedPrompt);

      const duration = Date.now() - startTime;

      loggingService.info('Prompt compilation completed', {
        originalTokens,
        optimizedTokens,
        reduction: ((1 - optimizedTokens / originalTokens) * 100).toFixed(1) + '%',
        duration: duration + 'ms',
        preserveQuality
      });

      return {
        success: true,
        ast,
        ir,
        optimizedPrompt,
        metrics: {
          originalTokens,
          optimizedTokens,
          tokenReduction: ((1 - optimizedTokens / originalTokens) * 100),
          estimatedCost: optimizedTokens * 0.00001, // Rough estimate
          optimizationPasses: optimizationResults
        },
        errors: [],
        warnings: analysisResult.warnings
      };
    } catch (error) {
      loggingService.error('Prompt compilation failed', {
        error: error instanceof Error ? error.message : String(error),
        preserveQuality
      });

      return {
        success: false,
        optimizedPrompt: prompt, // Fallback to original
        metrics: {
          originalTokens: this.estimateTokens(prompt),
          optimizedTokens: this.estimateTokens(prompt),
          tokenReduction: 0,
          estimatedCost: 0,
          optimizationPasses: []
        },
        errors: [{
          type: 'syntax',
          message: error instanceof Error ? error.message : 'Compilation failed',
          severity: 'error'
        }],
        warnings: []
      };
    }
  }

  /**
   * Parse prompt to AST using production-ready NLP parsing
   * 
   * Features:
   * - Sentence segmentation and chunking
   * - Instruction pattern detection (imperative verbs)
   * - Context extraction with priority scoring
   * - Constraint detection (length, format, style, tone)
   * - Output format detection (JSON, markdown, code, etc.)
   * - Modifier extraction (concise, detailed, creative, etc.)
   * - Variable and reference detection
   * - Dependency graph construction
   */
  private static async parse(prompt: string): Promise<ProgramNode> {
    const body: StatementNode[] = [];
    let currentPos = 0;
    const dependencies: string[] = [];
    const variableMap = new Map<string, string>(); // Track variables for dependency resolution

    // Step 1: Pre-process - normalize and segment
    const normalizedPrompt = prompt.trim();
    const segments = this.segmentPrompt(normalizedPrompt);

    // Step 2: Parse each segment with context awareness
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const startPos = normalizedPrompt.indexOf(segment.text, currentPos);
      const endPos = startPos + segment.text.length;
      currentPos = endPos;

      // Detect instruction patterns (imperative verbs + action)
      const instructionMatch = this.detectInstruction(segment.text);
      if (instructionMatch) {
        const instructionNode = this.createInstructionNode(
          instructionMatch,
          segment,
          startPos,
          endPos,
          i,
          variableMap,
          body // Pass current body for context lookup
        );
        body.push(instructionNode);
        continue;
      }

      // Detect constraints (length, format, style, tone)
      const constraintMatch = this.detectConstraint(segment.text);
      if (constraintMatch) {
        const constraintNode = this.createConstraintNode(
          constraintMatch,
          segment,
          startPos,
          endPos,
          i
        );
        body.push(constraintNode);
        continue;
      }

      // Detect output format requirements
      const formatMatch = this.detectOutputFormat(segment.text);
      if (formatMatch) {
        const formatNode = this.createOutputFormatNode(
          formatMatch,
          segment,
          startPos,
          endPos,
          i
        );
        body.push(formatNode);
        continue;
      }

      // Detect conditional statements
      const conditionalMatch = this.detectConditional(segment.text);
      if (conditionalMatch) {
        // For now, treat as context with high priority
        // Full conditional parsing would require recursive parsing
        const contextNode = this.createContextNode(
          segment.text,
          'local',
          8, // High priority for conditionals
          true, // Required
          startPos,
          endPos,
          i
        );
        body.push(contextNode);
        continue;
      }

      // Default: Treat as context with intelligent priority scoring
      const priority = this.calculateContextPriority(segment.text, i, segments.length);
      const required = this.isContextRequired(segment.text);
      const scope = this.determineContextScope(segment.text, i);

      const contextNode = this.createContextNode(
        segment.text,
        scope,
        priority,
        required,
        startPos,
        endPos,
        i
      );
      body.push(contextNode);
    }

    // Step 3: Extract modifiers from the entire prompt
    const globalModifiers = this.extractModifiers(normalizedPrompt);
    
    // Step 4: Apply modifiers to instructions
    for (const node of body) {
      if (node.type === 'Instruction') {
        const instructionNode = node as any;
        instructionNode.modifiers = [
          ...instructionNode.modifiers,
          ...globalModifiers.map(mod => ({
            type: 'Modifier',
            id: `mod_${Date.now()}_${Math.random()}`,
            modifier: mod.type,
            strength: mod.strength,
            metadata: { startPos: 0, endPos: 0 }
          }))
        ];
      }
    }

    // Step 5: Build dependency graph
    const extractedDependencies = this.extractDependencies(body, variableMap);

    loggingService.debug('Prompt parsed to AST', {
      nodeCount: body.length,
      instructions: body.filter(n => n.type === 'Instruction').length,
      contexts: body.filter(n => n.type === 'Context').length,
      constraints: body.filter(n => n.type === 'Constraint').length,
      formats: body.filter(n => n.type === 'OutputFormat').length,
      dependencies: extractedDependencies.length
    });

    return {
      type: 'Program',
      id: 'prog_0',
      body,
      dependencies: extractedDependencies,
      metadata: { 
        startPos: 0, 
        endPos: normalizedPrompt.length, 
        tokens: this.estimateTokens(normalizedPrompt) 
      }
    };
  }

  /**
   * Segment prompt into logical chunks (sentences, paragraphs, sections)
   */
  private static segmentPrompt(prompt: string): Array<{ text: string; type: 'sentence' | 'paragraph' | 'section' }> {
    const segments: Array<{ text: string; type: 'sentence' | 'paragraph' | 'section' }> = [];
    
    // Split by double newlines (paragraphs/sections)
    const paragraphs = prompt.split(/\n\s*\n/);
    
    for (const paragraph of paragraphs) {
      if (paragraph.trim().length === 0) continue;
      
      // Check if it's a section header (short line, often all caps or starts with #)
      if (paragraph.match(/^#{1,6}\s+/) || (paragraph.length < 100 && paragraph.match(/^[A-Z][A-Z\s]+$/))) {
        segments.push({ text: paragraph.trim(), type: 'section' });
        continue;
      }
      
      // Split paragraph into sentences
      const sentences = paragraph.split(/(?<=[.!?])\s+(?=[A-Z])/);
      
      for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (trimmed.length > 0) {
          segments.push({ text: trimmed, type: 'sentence' });
        }
      }
    }
    
    return segments.length > 0 ? segments : [{ text: prompt, type: 'sentence' }];
  }

  /**
   * Detect instruction patterns (imperative verbs)
   */
  private static detectInstruction(text: string): { directive: string; subject: string; modifiers: string[] } | null {
    // Imperative verb patterns
    const imperativePatterns = [
      /^(generate|create|write|compose|draft|produce|build|make|develop|design)\s+(.+)/i,
      /^(analyze|examine|evaluate|assess|review|study|investigate|explore)\s+(.+)/i,
      /^(explain|describe|clarify|elaborate|detail|outline|summarize|condense)\s+(.+)/i,
      /^(translate|convert|transform|change|modify|adapt|rewrite|rephrase)\s+(.+)/i,
      /^(compare|contrast|differentiate|distinguish|relate)\s+(.+)/i,
      /^(classify|categorize|organize|group|sort|arrange)\s+(.+)/i,
      /^(extract|identify|find|locate|discover|detect)\s+(.+)/i,
      /^(suggest|recommend|propose|advise|recommend)\s+(.+)/i
    ];

    for (const pattern of imperativePatterns) {
      const match = text.match(pattern);
      if (match) {
        const directive = match[1].toLowerCase();
        const subject = match[2].trim();
        
        // Extract modifiers from the instruction
        const modifiers: string[] = [];
        if (text.match(/\b(concise|brief|short)\b/i)) modifiers.push('concise');
        if (text.match(/\b(detailed|comprehensive|thorough|in-depth)\b/i)) modifiers.push('detailed');
        if (text.match(/\b(creative|original|innovative)\b/i)) modifiers.push('creative');
        if (text.match(/\b(factual|accurate|precise)\b/i)) modifiers.push('factual');
        if (text.match(/\b(step-by-step|stepwise|sequential)\b/i)) modifiers.push('step-by-step');
        
        return { directive, subject, modifiers };
      }
    }

    return null;
  }

  /**
   * Detect constraint patterns
   */
  private static detectConstraint(text: string): { type: 'length' | 'format' | 'style' | 'tone' | 'custom'; value: string; strict: boolean } | null {
    // Length constraints
    if (text.match(/\b(within|max|maximum|at most|up to|limit|restrict)\s+(\d+)\s*(words|characters|chars|tokens|sentences|paragraphs)\b/i)) {
      const match = text.match(/\b(within|max|maximum|at most|up to|limit|restrict)\s+(\d+)\s*(words|characters|chars|tokens|sentences|paragraphs)\b/i);
      return {
        type: 'length',
        value: match ? `${match[2]} ${match[3]}` : '',
        strict: text.match(/\b(exactly|precisely|strictly)\b/i) !== null
      };
    }

    // Format constraints
    if (text.match(/\b(format|structure|organize|arrange)\s+(as|in|into)\s+(json|markdown|code|yaml|xml|csv|table|list|bullets?|numbered)\b/i)) {
      const match = text.match(/\b(format|structure|organize|arrange)\s+(as|in|into)\s+(json|markdown|code|yaml|xml|csv|table|list|bullets?|numbered)\b/i);
      return {
        type: 'format',
        value: match ? match[3] : '',
        strict: true
      };
    }

    // Style constraints
    if (text.match(/\b(style|written|composed|formatted)\s+(as|in|like)\s+(.+?)(?:\.|$)/i)) {
      const match = text.match(/\b(style|written|composed|formatted)\s+(as|in|like)\s+(.+?)(?:\.|$)/i);
      return {
        type: 'style',
        value: match ? match[3].trim() : '',
        strict: false
      };
    }

    // Tone constraints
    if (text.match(/\b(tone|mood|voice)\s+(should be|must be|is|be)\s+(professional|casual|formal|informal|friendly|serious|humorous|technical|academic|conversational)\b/i)) {
      const match = text.match(/\b(tone|mood|voice)\s+(should be|must be|is|be)\s+(professional|casual|formal|informal|friendly|serious|humorous|technical|academic|conversational)\b/i);
      return {
        type: 'tone',
        value: match ? match[3] : '',
        strict: text.match(/\b(must|required|mandatory)\b/i) !== null
      };
    }

    return null;
  }

  /**
   * Detect output format requirements
   */
  private static detectOutputFormat(text: string): { format: 'json' | 'markdown' | 'code' | 'text' | 'list'; schema?: any } | null {
    // JSON format
    if (text.match(/\b(json|JSON)\b/i) || text.match(/\breturn\s+(a\s+)?json/i)) {
      // Try to extract schema hints
      const schemaMatch = text.match(/\b(?:with|including|containing)\s+(?:fields?|properties?|keys?)\s*:?\s*([^.]+)/i);
      return {
        format: 'json',
        schema: schemaMatch ? this.parseSchemaHints(schemaMatch[1]) : undefined
      };
    }

    // Markdown format
    if (text.match(/\b(markdown|md|\.md)\b/i)) {
      return { format: 'markdown' };
    }

    // Code format
    if (text.match(/\b(code|source|programming|syntax)\b/i) || text.match(/\b(?:in|using|with)\s+(\w+)\s+code/i)) {
      const langMatch = text.match(/\b(?:in|using|with)\s+(\w+)\s+code/i);
      return {
        format: 'code',
        schema: langMatch ? { language: langMatch[1] } : undefined
      };
    }

    // List format
    if (text.match(/\b(list|bullets?|numbered|items?)\b/i)) {
      return { format: 'list' };
    }

    return null;
  }

  /**
   * Detect conditional statements
   */
  private static detectConditional(text: string): boolean {
    return /^(if|when|whenever|provided that|assuming|suppose)\s+/i.test(text) ||
           /\b(if|when|whenever)\s+[^,]+,\s*(then|do|perform)/i.test(text);
  }

  /**
   * Calculate context priority (0-10)
   */
  private static calculateContextPriority(text: string, index: number, totalSegments: number): number {
    let priority = 5; // Default

    // High priority indicators
    if (text.match(/\b(important|critical|essential|required|necessary|must|key|primary)\b/i)) priority += 2;
    if (text.match(/\b(context|background|information|details?|data)\b/i)) priority += 1;
    if (index === 0) priority += 1; // First segment often important
    if (text.length > 200) priority += 1; // Longer contexts often more important

    // Low priority indicators
    if (text.match(/\b(optional|additional|extra|supplementary|nice to have)\b/i)) priority -= 2;
    if (text.match(/\b(example|sample|instance|illustration)\b/i)) priority -= 1;
    if (index === totalSegments - 1 && text.length < 50) priority -= 1; // Short last segment often less important

    return Math.max(0, Math.min(10, priority));
  }

  /**
   * Determine if context is required
   */
  private static isContextRequired(text: string): boolean {
    return text.match(/\b(required|necessary|essential|critical|must|mandatory)\b/i) !== null ||
           text.match(/\b(important|key|primary|vital)\b/i) !== null;
  }

  /**
   * Determine context scope
   */
  private static determineContextScope(text: string, index: number): 'global' | 'local' {
    if (text.match(/\b(global|general|universal|overall|system-wide)\b/i)) return 'global';
    if (index === 0) return 'global'; // First segment often global context
    return 'local';
  }

  /**
   * Extract modifiers from prompt
   */
  private static extractModifiers(prompt: string): Array<{ type: string; strength: number }> {
    const modifiers: Array<{ type: string; strength: number }> = [];

    // Modifier patterns with strength detection
    const modifierPatterns = [
      { pattern: /\b(very|extremely|highly)\s+(concise|brief)\b/i, type: 'concise', strength: 0.9 },
      { pattern: /\b(concise|brief|short)\b/i, type: 'concise', strength: 0.7 },
      { pattern: /\b(very|extremely|highly)\s+(detailed|comprehensive|thorough)\b/i, type: 'detailed', strength: 0.9 },
      { pattern: /\b(detailed|comprehensive|thorough|in-depth)\b/i, type: 'detailed', strength: 0.7 },
      { pattern: /\b(creative|original|innovative|imaginative)\b/i, type: 'creative', strength: 0.8 },
      { pattern: /\b(factual|accurate|precise|exact)\b/i, type: 'factual', strength: 0.8 },
      { pattern: /\b(step-by-step|stepwise|sequential)\b/i, type: 'step-by-step', strength: 0.9 }
    ];

    for (const { pattern, type, strength } of modifierPatterns) {
      if (pattern.test(prompt)) {
        modifiers.push({ type, strength });
      }
    }

    return modifiers;
  }

  /**
   * Extract dependencies between nodes
   */
  private static extractDependencies(body: StatementNode[], variableMap: Map<string, string>): string[] {
    const dependencies: string[] = [];
    
    for (let i = 0; i < body.length; i++) {
      const node = body[i];
      
      // Check for references to previous nodes
      if (i > 0 && node.type === 'Instruction') {
        const instructionNode = node as any;
        const subjectText = typeof instructionNode.subject?.value === 'string' 
          ? instructionNode.subject.value 
          : '';
        
        // Simple dependency detection: if instruction references previous context
        for (let j = 0; j < i; j++) {
          const prevNode = body[j];
          if (prevNode.type === 'Context') {
            const contextText = typeof (prevNode as any).content?.value === 'string'
              ? (prevNode as any).content.value
              : '';
            
            // Check if instruction references context keywords
            const contextKeywords = contextText.split(/\s+/).slice(0, 5); // First 5 words
            if (contextKeywords.some((keyword: string) => 
              keyword.length > 3 && 
              subjectText.toLowerCase().includes(keyword.toLowerCase())
            )) {
              dependencies.push(prevNode.id);
            }
          }
        }
      }
    }
    
    return dependencies;
  }

  /**
   * Extract variable declarations from text
   * Patterns: "let X be Y", "X is Y", "X = Y", "define X as Y", "X: Y"
   */
  private static extractVariableDeclarations(text: string): Array<{ name: string; value: string }> {
    const declarations: Array<{ name: string; value: string }> = [];
    
    // Pattern 1: "let X be Y" or "let X = Y"
    const letPattern = /\blet\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:be|is|=)\s+(.+?)(?:\.|$|,)/gi;
    let match;
    while ((match = letPattern.exec(text)) !== null) {
      declarations.push({
        name: match[1].toLowerCase(),
        value: match[2].trim()
      });
    }
    
    // Pattern 2: "X is Y" (simple assignment)
    const isPattern = /\b([A-Z][a-zA-Z0-9_]*)\s+is\s+(.+?)(?:\.|$|,)/g;
    while ((match = isPattern.exec(text)) !== null) {
      declarations.push({
        name: match[1].toLowerCase(),
        value: match[2].trim()
      });
    }
    
    // Pattern 3: "define X as Y"
    const definePattern = /\bdefine\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+as\s+(.+?)(?:\.|$|,)/gi;
    while ((match = definePattern.exec(text)) !== null) {
      declarations.push({
        name: match[1].toLowerCase(),
        value: match[2].trim()
      });
    }
    
    // Pattern 4: "X: Y" (key-value style)
    const colonPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+?)(?:\.|$|,|\n)/g;
    while ((match = colonPattern.exec(text)) !== null) {
      const value = match[2].trim();
      // Only treat as variable if value is substantial (not just a type hint)
      if (value.length > 3 && !value.match(/^(string|number|boolean|object|array)$/i)) {
        declarations.push({
          name: match[1].toLowerCase(),
          value: value
        });
      }
    }
    
    return declarations;
  }

  /**
   * Check if a word is a common English word (not a variable)
   */
  private static isCommonWord(word: string): boolean {
    const commonWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be',
      'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
      'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this',
      'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
      'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all', 'each',
      'every', 'some', 'any', 'no', 'not', 'more', 'most', 'many', 'much',
      'few', 'little', 'other', 'another', 'such', 'only', 'just', 'also',
      'very', 'too', 'so', 'than', 'then', 'there', 'here', 'now', 'then'
    ]);
    
    return commonWords.has(word.toLowerCase());
  }

  /**
   * Find variable value in previous context nodes
   * Searches through previously parsed nodes to find variable definitions or references
   */
  private static findVariableInContext(varName: string, body: StatementNode[], currentIndex: number): string | null {
    // Search backwards through previous nodes
    for (let i = currentIndex - 1; i >= 0; i--) {
      const node = body[i];
      
      // Check context nodes for variable mentions
      if (node.type === 'Context') {
        const contextNode = node as ContextNode;
        const contextText = typeof contextNode.content === 'object' && 'value' in contextNode.content
          ? String((contextNode.content as any).value)
          : '';
        
        // Look for variable definition patterns in context
        const varPatterns = [
          new RegExp(`\\b${varName}\\s+(?:is|be|equals?|=\\s*)(.+?)(?:\\.|$|,)`, 'i'),
          new RegExp(`\\b(?:let|define)\\s+${varName}\\s+(?:be|as|is|=)\\s+(.+?)(?:\\.|$|,)`, 'i'),
          new RegExp(`\\b${varName}\\s*:\\s*(.+?)(?:\\.|$|,|\n)`, 'i')
        ];
        
        for (const pattern of varPatterns) {
          const match = contextText.match(pattern);
          if (match && match[1]) {
            const value = match[1].trim();
            if (value.length > 0) {
              loggingService.debug('Variable found in context', {
                variable: varName,
                foundIn: contextNode.id,
                value: value.substring(0, 50) + (value.length > 50 ? '...' : '')
              });
              return value;
            }
          }
        }
        
        // If context text contains the variable name prominently, use the context
        const words = contextText.toLowerCase().split(/\s+/);
        const varIndex = words.findIndex(w => w.includes(varName.toLowerCase()));
        if (varIndex >= 0 && varIndex < 10) {
          // Variable mentioned early in context, might be defining it
          // Extract surrounding text as potential value
          const start = Math.max(0, varIndex - 2);
          const end = Math.min(words.length, varIndex + 10);
          const extracted = words.slice(start, end).join(' ');
          if (extracted.length > varName.length + 5) {
            return extracted;
          }
        }
      }
      
      // Check instruction nodes for variable definitions
      if (node.type === 'Instruction') {
        const instructionNode = node as InstructionNode;
        const instructionText = typeof instructionNode.subject === 'object' && 'value' in instructionNode.subject
          ? String((instructionNode.subject as any).value)
          : '';
        
        // Check if instruction defines this variable
        const defPattern = new RegExp(`\\b(?:let|define)\\s+${varName}\\s+(?:be|as|is|=)\\s+(.+?)(?:\\.|$|,)`, 'i');
        const match = instructionText.match(defPattern);
        if (match && match[1]) {
          return match[1].trim();
        }
      }
    }
    
    return null;
  }

  /**
   * Extract implicit variables from instruction text
   * Pattern: "generate a summary of X" -> X might be a variable
   */
  private static extractImplicitVariables(text: string, directive: string): Array<{ name: string; type: string }> {
    const implicitVars: Array<{ name: string; type: string }> = [];
    
    // Pattern: "of X", "about X", "for X", "from X"
    const ofPattern = /\b(?:of|about|for|from|regarding|concerning)\s+([A-Z][a-zA-Z0-9_]*)\b/g;
    let match;
    while ((match = ofPattern.exec(text)) !== null) {
      const varName = match[1].toLowerCase();
      if (!this.isCommonWord(varName) && varName.length > 2) {
        implicitVars.push({
          name: varName,
          type: 'reference'
        });
      }
    }
    
    // Pattern: Quoted strings that might be variable names
    const quotedPattern = /["']([A-Z][a-zA-Z0-9_]+)["']/g;
    while ((match = quotedPattern.exec(text)) !== null) {
      const varName = match[1].toLowerCase();
      if (!this.isCommonWord(varName)) {
        implicitVars.push({
          name: varName,
          type: 'quoted'
        });
      }
    }
    
    return implicitVars;
  }

  /**
   * Create instruction node
   */
  private static createInstructionNode(
    match: { directive: string; subject: string; modifiers: string[] },
    segment: { text: string; type: string },
    startPos: number,
    endPos: number,
    index: number,
    variableMap: Map<string, string>,
    body: StatementNode[] // Current body for context lookup
  ): InstructionNode {
    // Utilize variableMap: Map variable mentions in the subject if any
    let subjectValue = match.subject;
    
    // Step 1: Detect and extract variable declarations from the subject
    // Pattern: "let X be Y", "X is Y", "X = Y", "define X as Y", "X: Y"
    const variableDeclarations = this.extractVariableDeclarations(subjectValue);
    for (const decl of variableDeclarations) {
      if (!variableMap.has(decl.name)) {
        variableMap.set(decl.name, decl.value);
        loggingService.debug('Variable declared in instruction', {
          variable: decl.name,
          value: decl.value.substring(0, 50) + (decl.value.length > 50 ? '...' : ''),
          instructionIndex: index
        });
      }
    }
    
    // Step 2: Detect variable references and resolve them
    const variableRefPatterns = [
      /\$\{([a-zA-Z0-9_]+)\}/g,           // ${varName}
      /\$([a-zA-Z0-9_]+)\b/g,              // $varName
      /\{\{([a-zA-Z0-9_]+)\}\}/g,          // {{varName}}
      /\b([A-Z][a-zA-Z0-9_]*)\b/g          // Capitalized words (potential variables)
    ];
    
    const detectedVariables = new Set<string>();
    
    for (const pattern of variableRefPatterns) {
      const matches = subjectValue.matchAll(pattern);
      for (const match of matches) {
        const varName = match[1] || match[0];
        const normalizedVarName = varName.replace(/[${}]/g, '').toLowerCase();
        
        // Skip if it's a common word or too short
        if (normalizedVarName.length < 3 || this.isCommonWord(normalizedVarName)) {
          continue;
        }
        
        detectedVariables.add(normalizedVarName);
        
        // If variable exists in map, replace it
        if (variableMap.has(normalizedVarName)) {
          const varValue = variableMap.get(normalizedVarName)!;
          subjectValue = subjectValue.replace(match[0], varValue);
        } else {
          // Check if it's a reference to a previous context node
          const contextMatch = this.findVariableInContext(normalizedVarName, body, index);
          if (contextMatch) {
            variableMap.set(normalizedVarName, contextMatch);
            subjectValue = subjectValue.replace(match[0], contextMatch);
          }
        }
      }
    }
    
    // Step 3: Extract implicit variable assignments from instruction patterns
    // Pattern: "generate a summary of X" -> X might be a variable reference
    const implicitVariables = this.extractImplicitVariables(subjectValue, match.directive);
    for (const implicitVar of implicitVariables) {
      if (!variableMap.has(implicitVar.name)) {
        // Try to find the value in previous context
        const contextValue = this.findVariableInContext(implicitVar.name, body, index);
        if (contextValue) {
          variableMap.set(implicitVar.name, contextValue);
        } else {
          // Store as placeholder for later resolution
          variableMap.set(implicitVar.name, `[${implicitVar.name}]`);
        }
      }
    }
    
    // Step 4: Track variable dependencies for the instruction
    const variableDependencies = Array.from(detectedVariables).filter(v => variableMap.has(v));
    
    loggingService.debug('Variable processing complete', {
      instructionIndex: index,
      declaredVariables: variableDeclarations.length,
      detectedReferences: detectedVariables.size,
      resolvedVariables: variableDependencies.length,
      finalSubjectLength: subjectValue.length
    });

    return {
      type: 'Instruction',
      id: `inst_${index}`,
      directive: match.directive,
      subject: {
        type: 'Literal',
        id: `lit_inst_${index}`,
        value: subjectValue,
        compressible: true,
        metadata: { startPos, endPos }
      },
      modifiers: match.modifiers.map((mod, i) => ({
        type: 'Modifier',
        id: `mod_${index}_${i}`,
        modifier: mod as any,
        strength: 0.7,
        metadata: { startPos, endPos }
      })),
      dependencies: variableDependencies, // Use detected variable dependencies
      metadata: { startPos, endPos, tokens: this.estimateTokens(segment.text) }
    };
  }

  /**
   * Create constraint node
   */
  private static createConstraintNode(
    match: { type: string; value: string; strict: boolean },
    segment: { text: string; type: string },
    startPos: number,
    endPos: number,
    index: number
  ): ConstraintNode {
    return {
      type: 'Constraint',
      id: `constraint_${index}`,
      constraint: match.type as any,
      value: {
        type: 'Literal',
        id: `lit_constraint_${index}`,
        value: match.value,
        compressible: false,
        metadata: { startPos, endPos }
      },
      strict: match.strict,
      metadata: { startPos, endPos, tokens: this.estimateTokens(segment.text) }
    };
  }

  /**
   * Create output format node
   */
  private static createOutputFormatNode(
    match: { format: string; schema?: any },
    segment: { text: string; type: string },
    startPos: number,
    endPos: number,
    index: number
  ): OutputFormatNode {
    return {
      type: 'OutputFormat',
      id: `format_${index}`,
      format: match.format as any,
      schema: match.schema,
      metadata: { startPos, endPos, tokens: this.estimateTokens(segment.text) }
    };
  }

  /**
   * Create context node
   */
  private static createContextNode(
    text: string,
    scope: 'global' | 'local',
    priority: number,
    required: boolean,
    startPos: number,
    endPos: number,
    index: number
  ): ContextNode {
    return {
      type: 'Context',
      id: `ctx_${index}`,
      scope,
      content: {
        type: 'Literal',
        id: `lit_ctx_${index}`,
        value: text,
        compressible: true,
        metadata: { startPos, endPos }
      },
      priority,
      required,
      metadata: { startPos, endPos, tokens: this.estimateTokens(text) }
    };
  }

  /**
   * Parse schema hints from text
   */
  private static parseSchemaHints(text: string): Record<string, any> {
    const schema: Record<string, any> = {};
    const fields = text.split(/[,;]\s*/);
    
    for (const field of fields) {
      const match = field.match(/(\w+)(?:\s*:\s*(\w+))?/);
      if (match) {
        schema[match[1]] = match[2] || 'string';
      }
    }
    
    return schema;
  }

  /**
   * Semantic analysis
   */
  private static async analyze(ast: ProgramNode): Promise<{
    dependencies: Map<string, string[]>;
    parallelizable: string[][];
    warnings: string[];
  }> {
    const dependencies = new Map<string, string[]>();
    const parallelizable: string[][] = [];
    const warnings: string[] = [];

    // Build dependency graph
    for (const node of ast.body) {
      if ('dependencies' in node) {
        dependencies.set(node.id, node.dependencies || []);
      }
    }

    // Detect parallelizable groups (nodes with no dependencies)
    const noDeps = ast.body.filter(node => 
      'dependencies' in node && (!node.dependencies || node.dependencies.length === 0)
    );
    
    if (noDeps.length > 1) {
      parallelizable.push(noDeps.map(n => n.id));
    }

    return { dependencies, parallelizable, warnings };
  }

  /**
   * Dead code elimination pass
   */
  private static async eliminateDeadCode(ast: ProgramNode): Promise<{
    ast: ProgramNode;
    result: OptimizationPassResult;
  }> {
    const transformations: OptimizationPassResult["transformations"] = [];
    let tokensSaved = 0;

    // Remove low-priority, non-required context
    const filteredBody = ast.body.filter(node => {
      if (node.type === 'Context' && 'required' in node && !node.required && 'priority' in node && node.priority < 3) {
        const tokens = node.metadata.tokens || 0;
        tokensSaved += tokens;
        transformations.push({
          type: 'dead_code_elimination',
          description: `Removed low-priority context: ${node.id}`,
          tokensSaved: tokens,
          costSaved: tokens * 0.00001
        });
        return false;
      }
      return true;
    });

    return {
      ast: { ...ast, body: filteredBody },
      result: {
        passName: 'Dead Code Elimination',
        applied: transformations.length > 0,
        transformations,
        warnings: []
      }
    };
  }

  /**
   * Constant folding pass
   */
  private static async foldConstants(ast: ProgramNode): Promise<{
    ast: ProgramNode;
    result: OptimizationPassResult;
  }> {
    const transformations: OptimizationPassResult["transformations"] = [];

    // Merge consecutive literals
    // (Implementation simplified for demonstration)

    return {
      ast,
      result: {
        passName: 'Constant Folding',
        applied: false,
        transformations,
        warnings: []
      }
    };
  }

  /**
   * Context compression pass
   */
  private static async compressContext(
    ast: ProgramNode,
    targetTokens?: number
  ): Promise<{
    ast: ProgramNode;
    result: OptimizationPassResult;
  }> {
    // Tracks the transformations performed during this pass
    const transformations: OptimizationPassResult["transformations"] = [];

    // Determine approximate current and allowed token count
    let estimatedTokens = 0;
    for (const node of ast.body) {
      // Use metadata.tokens if present, else estimate by length
      estimatedTokens += typeof node.metadata?.tokens === "number"
        ? node.metadata.tokens
        : (typeof (node as any)?.content?.value === "string"
            ? ((node as any).content.value.length / 4)
            : 0
          );
      if (node.type === "Instruction" && typeof (node as any)?.subject?.value === "string") {
        estimatedTokens += ((node as any).subject.value.length / 4);
      }
    }

    // No need to compress if no targetTokens or we already meet it
    if (!targetTokens || estimatedTokens <= targetTokens) {
      return {
        ast,
        result: {
          passName: "Context Compression",
          applied: false,
          transformations,
          warnings: [],
        },
      };
    }

    // Simulated summarization/compression:
    // - For each Context node, if it's verbose (length > 40 or tokens > 15) compress ("summarize") it
    // - Recalculate token estimates, stop when under targetToken budget
    let newTotalTokens = 0;
    let compressed = false;
    const newBody = ast.body.map((node) => {
      if (
        node.type === "Context" &&
        (typeof (node as any).content.value === "string") &&
        ((node as any).content.value.length > 40 ||
          (node.metadata?.tokens && node.metadata.tokens > 15))
      ) {
        // Simulate summarization by taking the first 12 words and adding " (summary)"
        const originalValue = (node as any).content.value;
        const originalTokens = node.metadata?.tokens ?? (originalValue.length / 4);

        const summaryWords = originalValue.split(/\s+/).slice(0, 12).join(" ");
        const summarized = summaryWords + (summaryWords.length < originalValue.length ? " ... (summary)" : " (summary)");
        const compressedTokens = Math.round(summarized.length / 4);

        // Record transformation if token count is reduced
        if (compressedTokens < originalTokens) {
          transformations.push({
            type: "context_compression",
            description: `Compressed context node '${node.id}' from ${originalTokens} to ${compressedTokens} tokens`,
            tokensSaved: originalTokens - compressedTokens,
            costSaved: (originalTokens - compressedTokens) * 0.00001,
          });
          compressed = true;
        }

        // Provide a new context node object (immutably)
        const newNode = {
          ...node,
          content: {
            ...(node as any).content,
            value: summarized,
            compressible: true,
            metadata: {
              ...(node as any).content.metadata,
              originalValue,
              wasCompressed: true,
            },
          },
          metadata: {
            ...node.metadata,
            tokens: compressedTokens,
            originalTokens,
            compressionSummary: true,
          },
        };
        newTotalTokens += compressedTokens;
        return newNode;
      } else {
        // Not a context node or already short enough; copy as is
        const nodeTokens = node.metadata?.tokens ??
          (typeof (node as any).content?.value === "string"
            ? ((node as any).content.value.length / 4)
            : 0
          );
        newTotalTokens += nodeTokens;
        return node;
      }
    });

    // If after compression still over budget, warn
    const warnings: string[] = [];
    if (targetTokens && newTotalTokens > targetTokens) {
      warnings.push(
        `Compressed context but could not fit under targetTokens=${targetTokens}. Remaining est: ${Math.round(newTotalTokens)}`
      );
    }

    return {
      ast: { ...ast, body: newBody },
      result: {
        passName: "Context Compression",
        applied: compressed,
        transformations,
        warnings,
      },
    };
  }

  /**
   * Aggressive optimization pass
   */
  private static async aggressiveOptimization(
    ast: ProgramNode,
    targetTokens?: number
  ): Promise<{
    ast: ProgramNode;
    result: OptimizationPassResult;
  }> {
    let transformed = false;
    let newAst: ProgramNode = { ...ast, body: [...ast.body] };
    const transformations: OptimizationPassResult["transformations"] = [];
    let totalTokens = ast.metadata?.tokens ?? 0;
    let warnings: string[] = [];

    // 1. Aggressively prune Context nodes with low importance until under targetTokens.
    if (typeof targetTokens === "number" && totalTokens > targetTokens) {
      // Sort context nodes by token count & importance (assume metadata.importance exists, lower means less important)
      let contextNodes = newAst.body
        .filter((node: any) => node.type === "Context")
        .map((node: any) => ({
          node,
          tokens: node.metadata?.tokens ?? 0,
          importance: node.metadata?.importance ?? 0,
        }))
        .sort((a, b) => (a.importance - b.importance) || (a.tokens - b.tokens)); // Less important & smaller first

      let trimmedBody = [...newAst.body];
      let currentTokens = totalTokens;

      for (const { node, tokens, importance } of contextNodes) {
        if (currentTokens <= targetTokens) break;
        // Remove this node from the body
        trimmedBody = trimmedBody.filter((n) => n.id !== node.id);
        currentTokens -= tokens;
        transformed = true;
        transformations.push({
          type: 'context_removal',
          description: `Removed context node with id=${node.id} (importance=${importance}, tokens=${tokens})`,
          tokensSaved: tokens,
          costSaved: tokens * 0.00001
        });
      }

      if (transformed) {
        newAst = {
          ...newAst,
          body: trimmedBody,
          metadata: {
            ...newAst.metadata,
            tokens: currentTokens,
          },
        };
        totalTokens = currentTokens;
      }
    }

    // 2. Try compressing any very long string values in Context or Instructions, if still over targetTokens
    if (
      typeof targetTokens === "number" &&
      totalTokens > targetTokens
    ) {
      let compressedBody = [];
      transformed = false;
      let newTokenTotal = 0;

      for (const node of newAst.body) {
        if (
          (node.type === "Context" || node.type === "Instruction")
        ) {
          let value: string | undefined;
          if (node.type === "Context") {
            const content = (node as any).content;
            value = typeof content?.value === "string" ? content.value : undefined;
          } else if (node.type === "Instruction") {
            const subject = (node as any).subject;
            value = typeof subject?.value === "string" ? subject.value : undefined;
          }
          
          if (!value) continue;
          let strVal = value;
          let originalTokens =
            node.metadata?.tokens ??
            Math.ceil((strVal?.length ?? 0) / 4);
          let compressedTokens = originalTokens;
          let newValue = strVal;

          // If the string is long, truncate in a lossy way
          if (
            typeof targetTokens === "number" &&
            originalTokens > 80 &&
            newTokenTotal + compressedTokens > targetTokens
          ) {
            const maxLen = Math.max(
              16,
              Math.floor(((targetTokens - newTokenTotal) / newAst.body.length) * 4)
            );
            newValue =
              strVal.substring(0, maxLen) +
              " [...] (aggressively truncated)";
            compressedTokens = Math.ceil(newValue.length / 4);

            if (node.type === "Context") {
              compressedBody.push({
                ...node,
                content: {
                  ...(node as any).content,
                  value: newValue,
                },
                metadata: {
                  ...node.metadata,
                  tokens: compressedTokens,
                },
              });
            } else {
              // Instruction
              compressedBody.push({
                ...node,
                subject: {
                  ...((node as any).subject ?? {}),
                  value: newValue,
                },
                metadata: {
                  ...node.metadata,
                  tokens: compressedTokens,
                },
              });
            }

            transformations.push({
              type: 'aggressive_truncation',
              description: `Aggressively truncated ${node.type} node id=${node.id} from ${originalTokens} to ${compressedTokens} tokens`,
              tokensSaved: originalTokens - compressedTokens,
              costSaved: (originalTokens - compressedTokens) * 0.00001
            });
            transformed = true;
          } else {
            compressedBody.push(node);
            newTokenTotal += originalTokens;
          }
        } else {
          compressedBody.push(node);
          newTokenTotal += node.metadata?.tokens ?? 0;
        }
      }

      if (transformed) {
        newAst = {
          ...newAst,
          body: compressedBody,
          metadata: {
            ...newAst.metadata,
            tokens: newTokenTotal,
          },
        };
        totalTokens = newTokenTotal;
      }
    }

    // 3. Final warning if still over budget
    if (
      typeof targetTokens === "number" &&
      totalTokens > targetTokens
    ) {
      warnings.push(
        `Aggressively optimized but could not fit under targetTokens=${targetTokens}. Remaining est: ${Math.round(
          totalTokens
        )}`
      );
    }

    // If nothing was changed, let applied be false
    return {
      ast: newAst,
      result: {
        passName: "Aggressive Optimization",
        applied: transformations.length > 0,
        transformations,
        warnings: warnings.length
          ? warnings.concat([
              "Aggressive optimization may affect quality",
            ])
          : ["Aggressive optimization may affect quality"],
      },
    };
  }

  /**
   * Generate IR from optimized AST
   */
  private static async generateIR(
    ast: ProgramNode,
    options: { enableParallelization: boolean; analysisResult: any }
  ): Promise<IRProgram> {
    const instructions: IRInstruction[] = [];

    for (const node of ast.body) {
      if (node.type === 'Instruction') {
        instructions.push({
          id: node.id,
          opcode: IROpcode.PROMPT,
          operands: [
            { type: 'constant', value: (node.subject as any).value }
          ],
          dependencies: node.dependencies || [],
          cost: {
            tokens: node.metadata.tokens || 0,
            estimatedMs: 1000
          },
          optimizations: []
        });
      } else if (node.type === 'Context') {
        instructions.push({
          id: node.id,
          opcode: IROpcode.CONTEXT,
          operands: [
            { type: 'constant', value: (node.content as any).value }
          ],
          dependencies: [],
          cost: {
            tokens: node.metadata.tokens || 0,
            estimatedMs: 0
          },
          optimizations: []
        });
      }
    }

    return {
      version: '1.0',
      instructions,
      metadata: {
        originalTokens: ast.metadata.tokens || 0,
        optimizedTokens: instructions.reduce((sum, i) => sum + i.cost.tokens, 0),
        optimizationPasses: [],
        parallelGroups: options.analysisResult.parallelizable.map((group: string[], i: number) => ({
          id: `parallel_${i}`,
          instructions: group,
          estimatedSpeedup: 1.5
        }))
      }
    };
  }

  /**
   * Generate optimized prompt from IR
   */
  private static async generateCode(ir: IRProgram): Promise<string> {
    const parts: string[] = [];

    for (const instruction of ir.instructions) {
      if (instruction.opcode === IROpcode.PROMPT || instruction.opcode === IROpcode.CONTEXT) {
        const value = instruction.operands[0]?.value;
        if (value) {
          parts.push(String(value));
        }
      }
    }

    return parts.join('\n\n');
  }

  /**
   * Estimate token count (simplified)
   */
  private static estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

