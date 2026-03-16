import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import JavaScript from 'tree-sitter-javascript';
import Python from 'tree-sitter-python';
import Go from 'tree-sitter-go';
import Java from 'tree-sitter-java';
import Rust from 'tree-sitter-rust';
import C from 'tree-sitter-c';
import Cpp from 'tree-sitter-cpp';
import Ruby from 'tree-sitter-ruby';
import Php from 'tree-sitter-php';

import {
  ASTAnalysis,
  FunctionInfo,
  ClassInfo,
  ImportInfo,
  ExportInfo,
  TypeInfo,
  InterfaceInfo,
  VariableInfo,
  CommentInfo,
} from './interfaces/github.interfaces';

@Injectable()
export class TreeSitterService implements OnModuleInit {
  private readonly logger = new Logger(TreeSitterService.name);
  private parsers: Map<string, Parser> = new Map();
  private initialized = false;

  async onModuleInit() {
    this.initialize();
  }

  initialize(): void {
    if (this.initialized) return;

    try {
      // Initialize parsers for all supported languages
      this.parsers.set('typescript', new Parser());
      this.parsers.set('tsx', new Parser());
      this.parsers.set('javascript', new Parser());
      this.parsers.set('jsx', new Parser());
      this.parsers.set('python', new Parser());
      this.parsers.set('go', new Parser());
      this.parsers.set('java', new Parser());
      this.parsers.set('rust', new Parser());
      this.parsers.set('c', new Parser());
      this.parsers.set('cpp', new Parser());
      this.parsers.set('ruby', new Parser());
      this.parsers.set('php', new Parser());

      // Set language grammars (cast: language packages use compatible but differently-typed Language)
      const Lang = (l: unknown): Parser.Language => l as Parser.Language;
      this.parsers.get('typescript')!.setLanguage(Lang(TypeScript.typescript));
      this.parsers.get('tsx')!.setLanguage(Lang(TypeScript.tsx));
      this.parsers.get('javascript')!.setLanguage(Lang(JavaScript));
      this.parsers.get('jsx')!.setLanguage(Lang(JavaScript));
      this.parsers.get('python')!.setLanguage(Lang(Python));
      this.parsers.get('go')!.setLanguage(Lang(Go));
      this.parsers.get('java')!.setLanguage(Lang(Java));
      this.parsers.get('rust')!.setLanguage(Lang(Rust));
      this.parsers.get('c')!.setLanguage(Lang(C));
      this.parsers.get('cpp')!.setLanguage(Lang(Cpp));
      this.parsers.get('ruby')!.setLanguage(Lang(Ruby));
      this.parsers.get('php')!.setLanguage(Lang(Php.php));

      this.initialized = true;
      this.logger.log('Tree-sitter parsers initialized for all languages');
    } catch (error) {
      this.logger.error('Failed to initialize tree-sitter parsers', error);
      throw error;
    }
  }

  parseCode(code: string, language: string, filePath = ''): ASTAnalysis {
    try {
      const parser = this.parsers.get(language.toLowerCase());
      if (!parser) {
        this.logger.warn(`No parser available for language: ${language}`);
        return this.getEmptyAnalysis();
      }

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
        symbols: [],
      };

      this.extractFromTree(
        tree.rootNode,
        analysis,
        filePath,
        language.toLowerCase(),
      );

      return analysis;
    } catch (error) {
      this.logger.error(`Failed to parse ${language} code`, error);
      return this.getEmptyAnalysis();
    }
  }

  private extractFromTree(
    node: any,
    analysis: ASTAnalysis,
    filePath: string,
    language: string,
  ): void {
    switch (language) {
      case 'typescript':
      case 'tsx':
      case 'javascript':
      case 'jsx':
        this.extractJavaScriptLike(node, analysis, filePath);
        break;
      case 'python':
        this.extractPython(node, analysis, filePath);
        break;
      case 'go':
        this.extractGo(node, analysis, filePath);
        break;
      case 'java':
        this.extractJava(node, analysis, filePath);
        break;
      case 'rust':
        this.extractRust(node, analysis, filePath);
        break;
      case 'c':
      case 'cpp':
        this.extractCpp(node, analysis, filePath);
        break;
      case 'ruby':
        this.extractRuby(node, analysis, filePath);
        break;
      case 'php':
        this.extractPhp(node, analysis, filePath);
        break;
    }

    // Extract comments for all languages
    this.extractComments(node, analysis);

    // Recursively process child nodes
    for (const child of node.children || []) {
      this.extractFromTree(child, analysis, filePath, language);
    }
  }

  private extractJavaScriptLike(
    node: any,
    analysis: ASTAnalysis,
    filePath: string,
  ): void {
    const nodeType = node.type;

    switch (nodeType) {
      case 'function_declaration':
      case 'function_expression':
      case 'arrow_function':
      case 'method_definition':
        const funcInfo: FunctionInfo = {
          name: this.extractFunctionName(node),
          parameters: this.extractParameters(node),
          returnType: this.extractReturnType(node, 'typescript'),
          line: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isAsync: this.isAsyncFunction(node),
          isExported: this.isExported(node),
          visibility: this.extractVisibility(node),
        };
        analysis.functions.push(funcInfo);
        analysis.symbols.push({
          name: funcInfo.name,
          type: 'function',
          line: funcInfo.line,
          endLine: funcInfo.endLine,
          filePath,
        });
        break;

      case 'class_declaration':
        const classInfo: ClassInfo = {
          name: this.extractClassName(node),
          methods: [],
          properties: [],
          line: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isExported: this.isExported(node),
        };
        analysis.classes.push(classInfo);
        analysis.symbols.push({
          name: classInfo.name,
          type: 'class',
          line: classInfo.line,
          endLine: classInfo.endLine,
          filePath,
        });
        break;

      case 'import_statement':
        const importInfo: ImportInfo = {
          module: this.extractImportModule(node),
          imports: this.extractImportNames(node),
          line: node.startPosition.row + 1,
          isTypeOnly: this.isTypeOnlyImport(node),
        };
        analysis.imports.push(importInfo);
        break;

      case 'export_statement':
        const exportInfo: ExportInfo = {
          name: this.extractExportName(node),
          type: this.extractExportType(node),
          line: node.startPosition.row + 1,
          isDefault: this.isDefaultExport(node),
        };
        analysis.exports.push(exportInfo);
        break;

      case 'interface_declaration':
        const interfaceInfo: InterfaceInfo = {
          name: this.extractInterfaceName(node),
          properties: this.extractInterfaceProperties(node),
          methods: [],
          line: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isExported: this.isExported(node),
        };
        analysis.interfaces.push(interfaceInfo);
        analysis.symbols.push({
          name: interfaceInfo.name,
          type: 'interface',
          line: interfaceInfo.line,
          endLine: interfaceInfo.endLine,
          filePath,
        });
        break;

      case 'type_alias_declaration':
        const typeInfo: TypeInfo = {
          name: this.extractTypeName(node),
          type: this.extractTypeDefinition(node),
          line: node.startPosition.row + 1,
          isExported: this.isExported(node),
        };
        analysis.types.push(typeInfo);
        analysis.symbols.push({
          name: typeInfo.name,
          type: 'type',
          line: typeInfo.line,
          endLine: typeInfo.line,
          filePath,
        });
        break;

      case 'variable_declaration':
        const varInfo: VariableInfo = {
          name: this.extractVariableName(node),
          type: this.extractVariableType(node),
          line: node.startPosition.row + 1,
          isConst: this.isConstVariable(node),
          isExported: this.isExported(node),
        };
        analysis.variables.push(varInfo);
        analysis.symbols.push({
          name: varInfo.name,
          type: 'variable',
          line: varInfo.line,
          endLine: varInfo.line,
          filePath,
        });
        break;
    }
  }

  private extractPython(
    node: any,
    analysis: ASTAnalysis,
    filePath: string,
  ): void {
    const nodeType = node.type;

    switch (nodeType) {
      case 'function_definition':
        const funcInfo: FunctionInfo = {
          name: this.extractPythonFunctionName(node),
          parameters: this.extractPythonParameters(node),
          returnType: this.extractPythonReturnType(node),
          line: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isAsync: this.isAsyncFunction(node),
          isExported: false, // Python doesn't have explicit exports
          visibility: this.extractPythonVisibility(node),
        };
        analysis.functions.push(funcInfo);
        analysis.symbols.push({
          name: funcInfo.name,
          type: 'function',
          line: funcInfo.line,
          endLine: funcInfo.endLine,
          filePath,
        });
        break;

      case 'class_definition':
        const classInfo: ClassInfo = {
          name: this.extractPythonClassName(node),
          methods: [],
          properties: [],
          line: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isExported: false,
        };
        analysis.classes.push(classInfo);
        analysis.symbols.push({
          name: classInfo.name,
          type: 'class',
          line: classInfo.line,
          endLine: classInfo.endLine,
          filePath,
        });
        break;

      case 'import_statement':
      case 'import_from_statement':
        const importInfo: ImportInfo = {
          module: this.extractPythonImportModule(node),
          imports: this.extractPythonImportNames(node),
          line: node.startPosition.row + 1,
          isTypeOnly: false,
        };
        analysis.imports.push(importInfo);
        break;
    }
  }

  private extractGo(node: any, analysis: ASTAnalysis, filePath: string): void {
    const nodeType = node.type;

    switch (nodeType) {
      case 'function_declaration':
        const funcInfo: FunctionInfo = {
          name: this.extractGoFunctionName(node),
          parameters: this.extractGoParameters(node),
          returnType: this.extractGoReturnType(node),
          line: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isAsync: false, // Go doesn't have async
          isExported: this.isGoExported(node),
          visibility: this.extractGoVisibility(node),
        };
        analysis.functions.push(funcInfo);
        analysis.symbols.push({
          name: funcInfo.name,
          type: 'function',
          line: funcInfo.line,
          endLine: funcInfo.endLine,
          filePath,
        });
        break;

      case 'type_declaration':
        const typeInfo: TypeInfo = {
          name: this.extractGoTypeName(node),
          type: this.extractGoTypeDefinition(node),
          line: node.startPosition.row + 1,
          isExported: this.isGoExported(node),
        };
        analysis.types.push(typeInfo);
        break;

      case 'import_declaration':
        const importInfo: ImportInfo = {
          module: this.extractGoImportModule(node),
          imports: this.extractGoImportNames(node),
          line: node.startPosition.row + 1,
          isTypeOnly: false,
        };
        analysis.imports.push(importInfo);
        break;
    }
  }

  private extractJava(
    node: any,
    analysis: ASTAnalysis,
    filePath: string,
  ): void {
    const nodeType = node.type;

    switch (nodeType) {
      case 'method_declaration':
        const funcInfo: FunctionInfo = {
          name: this.extractJavaMethodName(node),
          parameters: this.extractJavaParameters(node),
          returnType: this.extractJavaReturnType(node),
          line: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isAsync: false,
          isExported: false,
          visibility: this.extractJavaVisibility(node),
        };
        analysis.functions.push(funcInfo);
        break;

      case 'class_declaration':
        const classInfo: ClassInfo = {
          name: this.extractJavaClassName(node),
          methods: [],
          properties: [],
          line: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isExported: false,
        };
        analysis.classes.push(classInfo);
        break;

      case 'import_declaration':
        const importInfo: ImportInfo = {
          module: this.extractJavaImportModule(node),
          imports: this.extractJavaImportNames(node),
          line: node.startPosition.row + 1,
          isTypeOnly: false,
        };
        analysis.imports.push(importInfo);
        break;
    }
  }

  private extractRust(
    node: any,
    analysis: ASTAnalysis,
    filePath: string,
  ): void {
    const nodeType = node.type;

    switch (nodeType) {
      case 'function_item':
        const funcInfo: FunctionInfo = {
          name: this.extractRustFunctionName(node),
          parameters: this.extractRustParameters(node),
          returnType: this.extractRustReturnType(node),
          line: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isAsync: this.isAsyncFunction(node),
          isExported: this.isRustExported(node),
          visibility: this.extractRustVisibility(node),
        };
        analysis.functions.push(funcInfo);
        break;

      case 'struct_item':
        const classInfo: ClassInfo = {
          name: this.extractRustStructName(node),
          methods: [],
          properties: [],
          line: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isExported: this.isRustExported(node),
        };
        analysis.classes.push(classInfo);
        break;
    }
  }

  private extractCpp(node: any, analysis: ASTAnalysis, filePath: string): void {
    const nodeType = node.type;

    switch (nodeType) {
      case 'function_definition':
        const funcInfo: FunctionInfo = {
          name: this.extractCppFunctionName(node),
          parameters: this.extractCppParameters(node),
          returnType: this.extractCppReturnType(node),
          line: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isAsync: false,
          isExported: false,
          visibility: this.extractCppVisibility(node),
        };
        analysis.functions.push(funcInfo);
        break;

      case 'class_specifier':
        const classInfo: ClassInfo = {
          name: this.extractCppClassName(node),
          methods: [],
          properties: [],
          line: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isExported: false,
        };
        analysis.classes.push(classInfo);
        break;
    }
  }

  private extractRuby(
    node: any,
    analysis: ASTAnalysis,
    filePath: string,
  ): void {
    const nodeType = node.type;

    switch (nodeType) {
      case 'method':
        const funcInfo: FunctionInfo = {
          name: this.extractRubyMethodName(node),
          parameters: this.extractRubyParameters(node),
          returnType: undefined, // Ruby is dynamically typed
          line: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isAsync: false,
          isExported: false,
          visibility: this.extractRubyVisibility(node),
        };
        analysis.functions.push(funcInfo);
        break;

      case 'class':
        const classInfo: ClassInfo = {
          name: this.extractRubyClassName(node),
          methods: [],
          properties: [],
          line: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isExported: false,
        };
        analysis.classes.push(classInfo);
        break;
    }
  }

  private extractPhp(node: any, analysis: ASTAnalysis, filePath: string): void {
    const nodeType = node.type;

    switch (nodeType) {
      case 'function_definition':
        const funcInfo: FunctionInfo = {
          name: this.extractPhpFunctionName(node),
          parameters: this.extractPhpParameters(node),
          returnType: this.extractPhpReturnType(node),
          line: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isAsync: false,
          isExported: false,
          visibility: this.extractPhpVisibility(node),
        };
        analysis.functions.push(funcInfo);
        break;

      case 'class_declaration':
        const classInfo: ClassInfo = {
          name: this.extractPhpClassName(node),
          methods: [],
          properties: [],
          line: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isExported: false,
        };
        analysis.classes.push(classInfo);
        break;
    }
  }

  private extractComments(node: any, analysis: ASTAnalysis): void {
    if (node.type === 'comment') {
      const commentInfo: CommentInfo = {
        content: node.text,
        line: node.startPosition.row + 1,
        type: this.getCommentType(node.text),
      };
      analysis.comments.push(commentInfo);
    }
  }

  // Helper methods for extracting specific constructs
  private extractFunctionName(node: any): string {
    const identifier = node.childForFieldName('name');
    return identifier?.text || 'anonymous';
  }

  private extractParameters(node: any): string[] {
    const parameters = node.childForFieldName('parameters');
    if (!parameters) return [];

    const params: string[] = [];
    for (const child of parameters.children || []) {
      if (
        child.type === 'identifier' ||
        child.type === 'required_parameter' ||
        child.type === 'optional_parameter'
      ) {
        const param = child.childForFieldName('name') || child;
        params.push(param.text);
      }
    }
    return params;
  }

  private extractReturnType(node: any, language: string): string | undefined {
    const returnType =
      node.childForFieldName('return_type') || node.childForFieldName('type');
    return returnType?.text;
  }

  private isAsyncFunction(node: any): boolean {
    return node.children?.some((child: any) => child.type === 'async') || false;
  }

  private isExported(node: any): boolean {
    return (
      node.children?.some((child: any) => child.type === 'export') || false
    );
  }

  private extractVisibility(node: any): 'public' | 'private' | 'protected' {
    const modifiers = node.children?.filter(
      (child: any) => child.type === 'accessibility_modifier',
    );
    if (modifiers?.length > 0) {
      const modifier = modifiers[0].text;
      if (
        modifier === 'private' ||
        modifier === 'protected' ||
        modifier === 'public'
      ) {
        return modifier;
      }
    }
    return 'public'; // Default visibility
  }

  private extractClassName(node: any): string {
    const identifier = node.childForFieldName('name');
    return identifier?.text || 'anonymous';
  }

  private extractImportModule(node: any): string {
    const source = node.childForFieldName('source');
    return source?.text?.replace(/['"]/g, '') || '';
  }

  private extractImportNames(node: any): string[] {
    const names: string[] = [];
    const specifiers =
      node.childForFieldName('specifiers') || node.children || [];

    for (const spec of specifiers) {
      if (spec.type === 'import_specifier' || spec.type === 'named_import') {
        const name = spec.childForFieldName('name') || spec;
        names.push(name.text);
      }
    }
    return names;
  }

  private isTypeOnlyImport(node: any): boolean {
    return node.children?.some((child: any) => child.type === 'type') || false;
  }

  private extractExportName(node: any): string {
    const declaration = node.childForFieldName('declaration');
    if (
      declaration?.type === 'function_declaration' ||
      declaration?.type === 'class_declaration'
    ) {
      const name = declaration.childForFieldName('name');
      return name?.text || 'anonymous';
    }
    return 'unknown';
  }

  private extractExportType(
    node: any,
  ): 'function' | 'class' | 'variable' | 'interface' | 'type' | 'other' {
    const declaration = node.childForFieldName('declaration');
    if (!declaration) return 'other';

    switch (declaration.type) {
      case 'function_declaration':
        return 'function';
      case 'class_declaration':
        return 'class';
      case 'interface_declaration':
        return 'interface';
      case 'type_alias_declaration':
        return 'type';
      case 'variable_declaration':
        return 'variable';
      default:
        return 'other';
    }
  }

  private isDefaultExport(node: any): boolean {
    return (
      node.children?.some((child: any) => child.type === 'default') || false
    );
  }

  private extractInterfaceName(node: any): string {
    const identifier = node.childForFieldName('name');
    return identifier?.text || 'anonymous';
  }

  private extractInterfaceProperties(node: any): VariableInfo[] {
    const body = node.childForFieldName('body');
    const properties: VariableInfo[] = [];

    if (body) {
      for (const member of body.children || []) {
        if (member.type === 'property_signature') {
          const name = member.childForFieldName('name');
          const type = member.childForFieldName('type');

          properties.push({
            name: name?.text || 'unknown',
            type: type?.text,
            line: member.startPosition.row + 1,
            isConst: false,
            isExported: false,
          });
        }
      }
    }

    return properties;
  }

  private extractTypeName(node: any): string {
    const identifier = node.childForFieldName('name');
    return identifier?.text || 'anonymous';
  }

  private extractTypeDefinition(node: any): string {
    const value = node.childForFieldName('value');
    return value?.text || 'unknown';
  }

  private extractVariableName(node: any): string {
    const declarator = node.children?.find(
      (child: any) => child.type === 'variable_declarator',
    );
    const name = declarator?.childForFieldName('name');
    return name?.text || 'unknown';
  }

  private extractVariableType(node: any): string | undefined {
    const declarator = node.children?.find(
      (child: any) => child.type === 'variable_declarator',
    );
    const type = declarator?.childForFieldName('type');
    return type?.text;
  }

  private isConstVariable(node: any): boolean {
    return node.children?.some((child: any) => child.type === 'const') || false;
  }

  // Language-specific helper methods (simplified implementations)
  private extractPythonFunctionName(node: any): string {
    return this.extractFunctionName(node);
  }
  private extractPythonParameters(node: any): string[] {
    return this.extractParameters(node);
  }
  private extractPythonReturnType(node: any): string | undefined {
    return this.extractReturnType(node, 'python');
  }
  private extractPythonVisibility(
    node: any,
  ): 'public' | 'private' | 'protected' {
    return 'public';
  }

  private extractGoFunctionName(node: any): string {
    return this.extractFunctionName(node);
  }
  private extractGoParameters(node: any): string[] {
    return this.extractParameters(node);
  }
  private extractGoReturnType(node: any): string | undefined {
    return this.extractReturnType(node, 'go');
  }
  private isGoExported(node: any): boolean {
    return this.isExported(node);
  }
  private extractGoVisibility(node: any): 'public' | 'private' | 'protected' {
    return 'public';
  }

  private extractJavaMethodName(node: any): string {
    return this.extractFunctionName(node);
  }
  private extractJavaParameters(node: any): string[] {
    return this.extractParameters(node);
  }
  private extractJavaReturnType(node: any): string | undefined {
    return this.extractReturnType(node, 'java');
  }
  private extractJavaVisibility(node: any): 'public' | 'private' | 'protected' {
    return 'public';
  }

  private extractRustFunctionName(node: any): string {
    return this.extractFunctionName(node);
  }
  private extractRustParameters(node: any): string[] {
    return this.extractParameters(node);
  }
  private extractRustReturnType(node: any): string | undefined {
    return this.extractReturnType(node, 'rust');
  }
  private isRustExported(node: any): boolean {
    return this.isExported(node);
  }
  private extractRustVisibility(node: any): 'public' | 'private' | 'protected' {
    return 'public';
  }

  private extractCppFunctionName(node: any): string {
    return this.extractFunctionName(node);
  }
  private extractCppParameters(node: any): string[] {
    return this.extractParameters(node);
  }
  private extractCppReturnType(node: any): string | undefined {
    return this.extractReturnType(node, 'cpp');
  }
  private extractCppVisibility(node: any): 'public' | 'private' | 'protected' {
    return 'public';
  }

  private extractRubyMethodName(node: any): string {
    return this.extractFunctionName(node);
  }
  private extractRubyParameters(node: any): string[] {
    return this.extractParameters(node);
  }
  private extractRubyVisibility(node: any): 'public' | 'private' | 'protected' {
    return 'public';
  }

  private extractPhpFunctionName(node: any): string {
    return this.extractFunctionName(node);
  }
  private extractPhpParameters(node: any): string[] {
    return this.extractParameters(node);
  }
  private extractPhpReturnType(node: any): string | undefined {
    return this.extractReturnType(node, 'php');
  }
  private extractPhpVisibility(node: any): 'public' | 'private' | 'protected' {
    return 'public';
  }

  // Additional helper methods
  private extractPythonClassName(node: any): string {
    return this.extractClassName(node);
  }
  private extractPythonImportModule(node: any): string {
    return this.extractImportModule(node);
  }
  private extractPythonImportNames(node: any): string[] {
    return this.extractImportNames(node);
  }

  private extractGoTypeName(node: any): string {
    return this.extractTypeName(node);
  }
  private extractGoTypeDefinition(node: any): string {
    return this.extractTypeDefinition(node);
  }
  private extractGoImportModule(node: any): string {
    return this.extractImportModule(node);
  }
  private extractGoImportNames(node: any): string[] {
    return this.extractImportNames(node);
  }

  private extractJavaClassName(node: any): string {
    return this.extractClassName(node);
  }
  private extractJavaImportModule(node: any): string {
    return this.extractImportModule(node);
  }
  private extractJavaImportNames(node: any): string[] {
    return this.extractImportNames(node);
  }

  private extractRustStructName(node: any): string {
    return this.extractClassName(node);
  }

  private extractCppClassName(node: any): string {
    return this.extractClassName(node);
  }

  private extractRubyClassName(node: any): string {
    return this.extractClassName(node);
  }

  private extractPhpClassName(node: any): string {
    return this.extractClassName(node);
  }

  private getCommentType(text: string): 'single' | 'multi' | 'doc' {
    if (text.startsWith('/**') || text.startsWith('/*')) return 'doc';
    if (text.startsWith('/*')) return 'multi';
    return 'single';
  }

  private getEmptyAnalysis(): ASTAnalysis {
    return {
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      types: [],
      interfaces: [],
      variables: [],
      comments: [],
      symbols: [],
    };
  }
}
