import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import JavaScript from 'tree-sitter-javascript';
import Python from 'tree-sitter-python';
import Go from 'tree-sitter-go';
import Java from 'tree-sitter-java';
import Rust from 'tree-sitter-rust';
import Cpp from 'tree-sitter-cpp';
import C from 'tree-sitter-c';
import Ruby from 'tree-sitter-ruby';
import Php from 'tree-sitter-php';
import { loggingService } from './logging.service';

/**
 * AST Analysis result interfaces
 */
export interface FunctionInfo {
    name: string;
    parameters: string[];
    returnType?: string;
    line: number;
    endLine: number;
    isAsync?: boolean;
    isExported?: boolean;
    visibility?: 'public' | 'private' | 'protected';
}

export interface ClassInfo {
    name: string;
    line: number;
    endLine: number;
    methods: string[];
    properties: string[];
    extends?: string;
    implements?: string[];
    isExported?: boolean;
}

export interface ImportInfo {
    source: string;
    imports: string[];
    line: number;
    isTypeOnly?: boolean;
}

export interface ExportInfo {
    name: string;
    type: 'function' | 'class' | 'variable' | 'interface' | 'type' | 'default';
    line: number;
}

export interface TypeInfo {
    name: string;
    line: number;
    endLine: number;
    properties?: string[];
}

export interface InterfaceInfo {
    name: string;
    line: number;
    endLine: number;
    properties: string[];
    extends?: string[];
}

export interface VariableInfo {
    name: string;
    type?: string;
    line: number;
    isConst?: boolean;
    isExported?: boolean;
}

export interface CommentInfo {
    text: string;
    line: number;
    type: 'line' | 'block' | 'doc';
}

export interface ASTAnalysis {
    functions: FunctionInfo[];
    classes: ClassInfo[];
    imports: ImportInfo[];
    exports: ExportInfo[];
    types: TypeInfo[];
    interfaces: InterfaceInfo[];
    variables: VariableInfo[];
    comments: CommentInfo[];
    symbols: SymbolLocation[];
}

export interface SymbolLocation {
    name: string;
    type: 'function' | 'class' | 'variable' | 'interface' | 'type' | 'import';
    line: number;
    endLine: number;
    filePath: string;
}

/**
 * Tree-Sitter Service for precise AST parsing
 */
export class TreeSitterService {
    private static parsers: Map<string, Parser> = new Map();
    private static initialized = false;

    /**
     * Initialize parsers for all supported languages
     */
    static initialize(): void {
        if (this.initialized) return;

        try {
            // TypeScript/TSX
            const tsParser = new Parser();
            tsParser.setLanguage(TypeScript.typescript as any);
            this.parsers.set('typescript', tsParser);
            this.parsers.set('ts', tsParser);

            const tsxParser = new Parser();
            tsxParser.setLanguage(TypeScript.tsx as any);
            this.parsers.set('tsx', tsxParser);

            // JavaScript/JSX
            const jsParser = new Parser();
            jsParser.setLanguage(JavaScript as any);
            this.parsers.set('javascript', jsParser);
            this.parsers.set('js', jsParser);

            const jsxParser = new Parser();
            jsxParser.setLanguage(JavaScript as any);
            this.parsers.set('jsx', jsxParser);

            // Python
            const pythonParser = new Parser();
            pythonParser.setLanguage(Python as any);
            this.parsers.set('python', pythonParser);
            this.parsers.set('py', pythonParser);

            // Go
            const goParser = new Parser();
            goParser.setLanguage(Go as any);
            this.parsers.set('go', goParser);

            // Java
            const javaParser = new Parser();
            javaParser.setLanguage(Java as any);
            this.parsers.set('java', javaParser);

            // Rust
            const rustParser = new Parser();
            rustParser.setLanguage(Rust as any);
            this.parsers.set('rust', rustParser);
            this.parsers.set('rs', rustParser);

            // C/C++
            const cppParser = new Parser();
            cppParser.setLanguage(Cpp as any);
            this.parsers.set('cpp', cppParser);
            this.parsers.set('cxx', cppParser);
            this.parsers.set('cc', cppParser);
            this.parsers.set('hpp', cppParser);

            const cParser = new Parser();
            cParser.setLanguage(C as any);
            this.parsers.set('c', cParser);
            this.parsers.set('h', cParser);

            // Ruby
            const rubyParser = new Parser();
            rubyParser.setLanguage(Ruby as any);
            this.parsers.set('ruby', rubyParser);
            this.parsers.set('rb', rubyParser);

            // PHP - handle the object structure
            const phpParser = new Parser();
            const phpLang = (Php as any).php || Php;
            phpParser.setLanguage(phpLang as any);
            this.parsers.set('php', phpParser);

            this.initialized = true;
            loggingService.info('Tree-Sitter parsers initialized', {
                languages: Array.from(this.parsers.keys())
            });
        } catch (error) {
            loggingService.error('Failed to initialize Tree-Sitter parsers', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get parser for a specific language
     */
    private static getParser(language: string): Parser | null {
        if (!this.initialized) {
            this.initialize();
        }

        const normalizedLang = language.toLowerCase();
        return this.parsers.get(normalizedLang) || null;
    }

    /**
     * Parse code into AST and extract structural information
     */
    static parseCode(code: string, language: string, filePath = ''): ASTAnalysis {
        const parser = this.getParser(language);
        
        if (!parser) {
            loggingService.warn('No parser available for language', { language });
            return this.getEmptyAnalysis();
        }

        try {
            const tree = parser.parse(code);
            const analysis: ASTAnalysis = {
                functions: [],
                classes: [],
                imports: [],
                exports: [],
                types: [],
                interfaces: [],
                variables: [],
                comments: [],
                symbols: []
            };

            // Extract based on language
            switch (language.toLowerCase()) {
                case 'typescript':
                case 'ts':
                case 'tsx':
                case 'javascript':
                case 'js':
                case 'jsx':
                    this.extractJavaScriptLike(tree.rootNode, analysis, filePath);
                    break;
                case 'python':
                case 'py':
                    this.extractPython(tree.rootNode, analysis, filePath);
                    break;
                case 'go':
                    this.extractGo(tree.rootNode, analysis, filePath);
                    break;
                case 'java':
                    this.extractJava(tree.rootNode, analysis, filePath);
                    break;
                case 'rust':
                case 'rs':
                    this.extractRust(tree.rootNode, analysis, filePath);
                    break;
                case 'cpp':
                case 'cxx':
                case 'cc':
                case 'c':
                case 'h':
                case 'hpp':
                    this.extractCpp(tree.rootNode, analysis, filePath);
                    break;
                case 'ruby':
                case 'rb':
                    this.extractRuby(tree.rootNode, analysis, filePath);
                    break;
                case 'php':
                    this.extractPhp(tree.rootNode, analysis, filePath);
                    break;
                default:
                    loggingService.warn('Unsupported language for AST extraction', { language });
            }

            // Extract comments for all languages
            this.extractComments(tree.rootNode, analysis);

            return analysis;
        } catch (error) {
            loggingService.warn('AST parsing failed, returning empty analysis', {
                language,
                error: error instanceof Error ? error.message : String(error),
                filePath
            });
            return this.getEmptyAnalysis();
        }
    }

    /**
     * Extract functions, classes, imports, exports for JavaScript/TypeScript
     */
    private static extractJavaScriptLike(
        node: Parser.SyntaxNode,
        analysis: ASTAnalysis,
        filePath: string
    ): void {
        // Functions
        node.descendantsOfType(['function_declaration', 'function', 'arrow_function', 'method_definition']).forEach(fn => {
            const nameNode = fn.childForFieldName('name');
            const name = nameNode?.text || 'anonymous';
            const params = this.extractParams(fn);
            const returnType = this.extractReturnType(fn);
            const isAsync = fn.type === 'function_declaration' && fn.children.some(c => c.type === 'async');
            const isExported = fn.parent?.type === 'export_statement' || fn.parent?.parent?.type === 'export_statement';

            analysis.functions.push({
                name,
                parameters: params,
                returnType,
                line: fn.startPosition.row + 1,
                endLine: fn.endPosition.row + 1,
                isAsync,
                isExported
            });

            analysis.symbols.push({
                name,
                type: 'function',
                line: fn.startPosition.row + 1,
                endLine: fn.endPosition.row + 1,
                filePath
            });
        });

        // Classes
        node.descendantsOfType('class_declaration').forEach(cls => {
            const nameNode = cls.childForFieldName('name');
            const name = nameNode?.text || '';
            const methods: string[] = [];
            const properties: string[] = [];

            cls.descendantsOfType('method_definition').forEach(method => {
                const methodName = method.childForFieldName('name')?.text;
                if (methodName) methods.push(methodName);
            });

            cls.descendantsOfType(['property_signature', 'public_field_definition']).forEach(prop => {
                const propName = prop.childForFieldName('name')?.text;
                if (propName) properties.push(propName);
            });

            const extendsNode = cls.childForFieldName('superclass');
            const extendsName = extendsNode?.text;

            analysis.classes.push({
                name,
                line: cls.startPosition.row + 1,
                endLine: cls.endPosition.row + 1,
                methods,
                properties,
                extends: extendsName,
                isExported: cls.parent?.type === 'export_statement'
            });

            analysis.symbols.push({
                name,
                type: 'class',
                line: cls.startPosition.row + 1,
                endLine: cls.endPosition.row + 1,
                filePath
            });
        });

        // Imports
        node.descendantsOfType(['import_statement', 'import_declaration']).forEach(imp => {
            const sourceNode = imp.childForFieldName('source');
            const source = sourceNode?.text?.replace(/['"]/g, '') || '';
            const imports: string[] = [];

            imp.descendantsOfType(['import_specifier', 'namespace_import']).forEach(spec => {
                const name = spec.childForFieldName('name')?.text || spec.text;
                if (name) imports.push(name);
            });

            if (source) {
                analysis.imports.push({
                    source,
                    imports,
                    line: imp.startPosition.row + 1,
                    isTypeOnly: imp.type.includes('type')
                });
            }
        });

        // Exports
        node.descendantsOfType('export_statement').forEach(exp => {
            const declaration = exp.firstChild;
            if (declaration) {
                const name = declaration.childForFieldName('name')?.text || 
                           declaration.firstNamedChild?.text || '';
                const type = declaration.type.includes('function') ? 'function' :
                           declaration.type.includes('class') ? 'class' :
                           declaration.type.includes('interface') ? 'interface' :
                           declaration.type.includes('type') ? 'type' : 'variable';

                if (name) {
                    analysis.exports.push({
                        name,
                        type: type as any,
                        line: exp.startPosition.row + 1
                    });
                }
            }
        });

        // Interfaces
        node.descendantsOfType('interface_declaration').forEach(intf => {
            const nameNode = intf.childForFieldName('name');
            const name = nameNode?.text || '';
            const properties: string[] = [];

            intf.descendantsOfType('property_signature').forEach(prop => {
                const propName = prop.childForFieldName('name')?.text;
                if (propName) properties.push(propName);
            });

            analysis.interfaces.push({
                name,
                line: intf.startPosition.row + 1,
                endLine: intf.endPosition.row + 1,
                properties
            });

            analysis.symbols.push({
                name,
                type: 'interface',
                line: intf.startPosition.row + 1,
                endLine: intf.endPosition.row + 1,
                filePath
            });
        });

        // Variables
        node.descendantsOfType(['variable_declaration', 'lexical_declaration']).forEach(varDecl => {
            varDecl.descendantsOfType('variable_declarator').forEach(declarator => {
                const nameNode = declarator.childForFieldName('name');
                const name = nameNode?.text || '';
                const isConst = varDecl.type.includes('const');
                const isExported = varDecl.parent?.type === 'export_statement';

                if (name) {
                    analysis.variables.push({
                        name,
                        line: varDecl.startPosition.row + 1,
                        isConst,
                        isExported
                    });

                    analysis.symbols.push({
                        name,
                        type: 'variable',
                        line: varDecl.startPosition.row + 1,
                        endLine: varDecl.endPosition.row + 1,
                        filePath
                    });
                }
            });
        });
    }

    /**
     * Extract Python-specific structures
     */
    private static extractPython(
        node: Parser.SyntaxNode,
        analysis: ASTAnalysis,
        filePath: string
    ): void {
        // Functions
        node.descendantsOfType('function_definition').forEach(fn => {
            const nameNode = fn.childForFieldName('name');
            const name = nameNode?.text || '';
            const params = this.extractPythonParams(fn);
            const returnType = this.extractPythonReturnType(fn);

            analysis.functions.push({
                name,
                parameters: params,
                returnType,
                line: fn.startPosition.row + 1,
                endLine: fn.endPosition.row + 1
            });

            analysis.symbols.push({
                name,
                type: 'function',
                line: fn.startPosition.row + 1,
                endLine: fn.endPosition.row + 1,
                filePath
            });
        });

        // Classes
        node.descendantsOfType('class_definition').forEach(cls => {
            const nameNode = cls.childForFieldName('name');
            const name = nameNode?.text || '';
            const methods: string[] = [];
            const properties: string[] = [];

            cls.descendantsOfType('function_definition').forEach(method => {
                const methodName = method.childForFieldName('name')?.text;
                if (methodName) methods.push(methodName);
            });

            const superclasses = cls.childForFieldName('superclasses');
            const extendsName = superclasses?.firstChild?.text;

            analysis.classes.push({
                name,
                line: cls.startPosition.row + 1,
                endLine: cls.endPosition.row + 1,
                methods,
                properties,
                extends: extendsName
            });

            analysis.symbols.push({
                name,
                type: 'class',
                line: cls.startPosition.row + 1,
                endLine: cls.endPosition.row + 1,
                filePath
            });
        });

        // Imports
        node.descendantsOfType(['import_statement', 'import_from_statement']).forEach(imp => {
            const source = imp.descendantsOfType('dotted_name').map(n => n.text).join('.') ||
                          imp.childForFieldName('module_name')?.text?.replace(/['"]/g, '') || '';
            const imports: string[] = [];

            imp.descendantsOfType('imported_name').forEach(imported => {
                const name = imported.text;
                if (name) imports.push(name);
            });

            if (source || imports.length > 0) {
                analysis.imports.push({
                    source: source || imports[0] || '',
                    imports: imports.length > 0 ? imports : [source],
                    line: imp.startPosition.row + 1
                });
            }
        });
    }

    /**
     * Extract Go-specific structures
     */
    private static extractGo(
        node: Parser.SyntaxNode,
        analysis: ASTAnalysis,
        filePath: string
    ): void {
        // Functions
        node.descendantsOfType('function_declaration').forEach(fn => {
            const nameNode = fn.childForFieldName('name');
            const name = nameNode?.text || '';
            const params = this.extractGoParams(fn);
            const returnType = this.extractGoReturnType(fn);

            analysis.functions.push({
                name,
                parameters: params,
                returnType,
                line: fn.startPosition.row + 1,
                endLine: fn.endPosition.row + 1
            });

            analysis.symbols.push({
                name,
                type: 'function',
                line: fn.startPosition.row + 1,
                endLine: fn.endPosition.row + 1,
                filePath
            });
        });

        // Imports
        node.descendantsOfType('import_declaration').forEach(imp => {
            const source = imp.descendantsOfType('interpreted_string_literal').map(n => 
                n.text.replace(/['"]/g, '')
            )[0] || '';

            if (source) {
                analysis.imports.push({
                    source,
                    imports: [],
                    line: imp.startPosition.row + 1
                });
            }
        });
    }

    /**
     * Extract Java-specific structures
     */
    private static extractJava(
        node: Parser.SyntaxNode,
        analysis: ASTAnalysis,
        filePath: string
    ): void {
        // Classes
        node.descendantsOfType('class_declaration').forEach(cls => {
            const nameNode = cls.childForFieldName('name');
            const name = nameNode?.text || '';
            const methods: string[] = [];
            const properties: string[] = [];

            cls.descendantsOfType('method_declaration').forEach(method => {
                const methodName = method.childForFieldName('name')?.text;
                if (methodName) methods.push(methodName);
            });

            cls.descendantsOfType('field_declaration').forEach(field => {
                const fieldName = field.descendantsOfType('variable_declarator').map(v => 
                    v.childForFieldName('name')?.text
                ).filter((text): text is string => Boolean(text));
                properties.push(...fieldName);
            });

            const superclass = cls.childForFieldName('superclass')?.text;
            const implementsList = cls.descendantsOfType('super_interfaces').map(i => i.text);

            analysis.classes.push({
                name,
                line: cls.startPosition.row + 1,
                endLine: cls.endPosition.row + 1,
                methods,
                properties,
                extends: superclass,
                implements: implementsList
            });

            analysis.symbols.push({
                name,
                type: 'class',
                line: cls.startPosition.row + 1,
                endLine: cls.endPosition.row + 1,
                filePath
            });
        });

        // Imports
        node.descendantsOfType('import_declaration').forEach(imp => {
            const source = imp.descendantsOfType('scoped_identifier').map(n => n.text).join('.') || '';
            if (source) {
                analysis.imports.push({
                    source,
                    imports: [],
                    line: imp.startPosition.row + 1
                });
            }
        });
    }

    /**
     * Extract Rust-specific structures
     */
    private static extractRust(
        node: Parser.SyntaxNode,
        analysis: ASTAnalysis,
        filePath: string
    ): void {
        // Functions
        node.descendantsOfType('function_item').forEach(fn => {
            const nameNode = fn.childForFieldName('name');
            const name = nameNode?.text || '';
            const params = this.extractRustParams(fn);
            const returnType = this.extractRustReturnType(fn);

            analysis.functions.push({
                name,
                parameters: params,
                returnType,
                line: fn.startPosition.row + 1,
                endLine: fn.endPosition.row + 1
            });

            analysis.symbols.push({
                name,
                type: 'function',
                line: fn.startPosition.row + 1,
                endLine: fn.endPosition.row + 1,
                filePath
            });
        });

        // Imports
        node.descendantsOfType('use_declaration').forEach(imp => {
            const source = imp.descendantsOfType('scoped_identifier').map(n => n.text).join('::') || '';
            if (source) {
                analysis.imports.push({
                    source,
                    imports: [],
                    line: imp.startPosition.row + 1
                });
            }
        });
    }

    /**
     * Extract C/C++ structures
     */
    private static extractCpp(
        node: Parser.SyntaxNode,
        analysis: ASTAnalysis,
        filePath: string
    ): void {
        // Functions
        node.descendantsOfType(['function_definition', 'declaration']).forEach(fn => {
            const declarator = fn.descendantsOfType('function_declarator')[0];
            const nameNode = declarator?.childForFieldName('declarator');
            const name = nameNode?.text || '';

            if (name) {
                analysis.functions.push({
                    name,
                    parameters: [],
                    line: fn.startPosition.row + 1,
                    endLine: fn.endPosition.row + 1
                });

                analysis.symbols.push({
                    name,
                    type: 'function',
                    line: fn.startPosition.row + 1,
                    endLine: fn.endPosition.row + 1,
                    filePath
                });
            }
        });

        // Includes
        node.descendantsOfType('preproc_include').forEach(inc => {
            const source = inc.descendantsOfType('string_literal').map(n => 
                n.text.replace(/['"]/g, '')
            )[0] || '';

            if (source) {
                analysis.imports.push({
                    source,
                    imports: [],
                    line: inc.startPosition.row + 1
                });
            }
        });
    }

    /**
     * Extract Ruby structures
     */
    private static extractRuby(
        node: Parser.SyntaxNode,
        analysis: ASTAnalysis,
        filePath: string
    ): void {
        // Methods
        node.descendantsOfType('method').forEach(method => {
            const nameNode = method.childForFieldName('name');
            const name = nameNode?.text || '';

            analysis.functions.push({
                name,
                parameters: [],
                line: method.startPosition.row + 1,
                endLine: method.endPosition.row + 1
            });

            analysis.symbols.push({
                name,
                type: 'function',
                line: method.startPosition.row + 1,
                endLine: method.endPosition.row + 1,
                filePath
            });
        });

        // Classes
        node.descendantsOfType('class').forEach(cls => {
            const nameNode = cls.childForFieldName('name');
            const name = nameNode?.text || '';

            analysis.classes.push({
                name,
                line: cls.startPosition.row + 1,
                endLine: cls.endPosition.row + 1,
                methods: [],
                properties: []
            });

            analysis.symbols.push({
                name,
                type: 'class',
                line: cls.startPosition.row + 1,
                endLine: cls.endPosition.row + 1,
                filePath
            });
        });
    }

    /**
     * Extract PHP structures
     */
    private static extractPhp(
        node: Parser.SyntaxNode,
        analysis: ASTAnalysis,
        filePath: string
    ): void {
        // Functions
        node.descendantsOfType('function_definition').forEach(fn => {
            const nameNode = fn.childForFieldName('name');
            const name = nameNode?.text || '';

            analysis.functions.push({
                name,
                parameters: [],
                line: fn.startPosition.row + 1,
                endLine: fn.endPosition.row + 1
            });

            analysis.symbols.push({
                name,
                type: 'function',
                line: fn.startPosition.row + 1,
                endLine: fn.endPosition.row + 1,
                filePath
            });
        });

        // Classes
        node.descendantsOfType('class_declaration').forEach(cls => {
            const nameNode = cls.childForFieldName('name');
            const name = nameNode?.text || '';

            analysis.classes.push({
                name,
                line: cls.startPosition.row + 1,
                endLine: cls.endPosition.row + 1,
                methods: [],
                properties: []
            });

            analysis.symbols.push({
                name,
                type: 'class',
                line: cls.startPosition.row + 1,
                endLine: cls.endPosition.row + 1,
                filePath
            });
        });
    }

    /**
     * Extract comments from AST
     */
    private static extractComments(
        node: Parser.SyntaxNode,
        analysis: ASTAnalysis
    ): void {
        node.descendantsOfType(['comment', 'line_comment', 'block_comment']).forEach(comment => {
            analysis.comments.push({
                text: comment.text,
                line: comment.startPosition.row + 1,
                type: comment.type.includes('block') ? 'block' : 'line'
            });
        });
    }

    /**
     * Helper methods for parameter extraction
     */
    private static extractParams(node: Parser.SyntaxNode): string[] {
        const params: string[] = [];
        const paramList = node.childForFieldName('parameters') || 
                         node.descendantsOfType('formal_parameters')[0];
        
        if (paramList) {
            paramList.descendantsOfType(['required_parameter', 'identifier']).forEach(param => {
                const name = param.childForFieldName('name')?.text || param.text;
                if (name && name !== ',') params.push(name);
            });
        }
        
        return params;
    }

    private static extractPythonParams(node: Parser.SyntaxNode): string[] {
        const params: string[] = [];
        const paramList = node.childForFieldName('parameters');
        
        if (paramList) {
            paramList.descendantsOfType('identifier').forEach(param => {
                params.push(param.text);
            });
        }
        
        return params;
    }

    private static extractGoParams(node: Parser.SyntaxNode): string[] {
        const params: string[] = [];
        const paramList = node.childForFieldName('parameters');
        
        if (paramList) {
            paramList.descendantsOfType('parameter_declaration').forEach(param => {
                const name = param.descendantsOfType('identifier').map(i => i.text)[0];
                if (name) params.push(name);
            });
        }
        
        return params;
    }

    private static extractRustParams(node: Parser.SyntaxNode): string[] {
        const params: string[] = [];
        const paramList = node.childForFieldName('parameters');
        
        if (paramList) {
            paramList.descendantsOfType('parameter').forEach(param => {
                const name = param.descendantsOfType('identifier').map(i => i.text)[0];
                if (name) params.push(name);
            });
        }
        
        return params;
    }

    /**
     * Helper methods for return type extraction
     */
    private static extractReturnType(node: Parser.SyntaxNode): string | undefined {
        const returnType = node.childForFieldName('return_type') ||
                          node.descendantsOfType('type_annotation')[0];
        return returnType?.text;
    }

    private static extractPythonReturnType(node: Parser.SyntaxNode): string | undefined {
        const returnType = node.descendantsOfType('type').map(t => t.text)[0];
        return returnType;
    }

    private static extractGoReturnType(node: Parser.SyntaxNode): string | undefined {
        const returnType = node.childForFieldName('result')?.text;
        return returnType;
    }

    private static extractRustReturnType(node: Parser.SyntaxNode): string | undefined {
        const returnType = node.descendantsOfType('type_identifier').map(t => t.text)[0];
        return returnType;
    }

    /**
     * Return empty analysis structure
     */
    private static getEmptyAnalysis(): ASTAnalysis {
        return {
            functions: [],
            classes: [],
            imports: [],
            exports: [],
            types: [],
            interfaces: [],
            variables: [],
            comments: [],
            symbols: []
        };
    }
}

