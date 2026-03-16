// GitHub service interfaces and types
export interface GitHubAuthConfig {
  appId?: string;
  privateKey?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  /** Present when GitHub returns an error (e.g. bad_verification_code) */
  error?: string;
  error_description?: string;
}

export interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string;
  name?: string;
  email?: string;
}

export interface RepositoryContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string | null;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  content?: string;
  encoding?: string;
}

export interface CreateBranchOptions {
  owner: string;
  repo: string;
  branchName: string;
  baseBranch: string;
}

export interface CreateFileOptions {
  owner: string;
  repo: string;
  path: string;
  content: string;
  message: string;
  branch?: string;
}

export interface CreatePROptions {
  owner: string;
  repo: string;
  title: string;
  head: string;
  base: string;
  body?: string;
  draft?: boolean;
}

export interface UpdatePROptions {
  owner: string;
  repo: string;
  pull_number: number;
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
}

// Incremental indexing interfaces
export interface IncrementalIndexOptions {
  repoFullName: string;
  commitSha: string;
  branch: string;
  changedFiles: string[];
  userId: string;
  organizationId?: string;
}

export interface IncrementalIndexResult {
  filesIndexed: number;
  filesSkipped: number;
  totalChunksCreated: number;
  totalChunksUpdated: number;
  errors: string[];
  warnings: string[];
}

// GitHub indexing interfaces
export interface ChunkMetadata {
  repoFullName: string;
  filePath: string;
  commitSha: string;
  branch: string;
  language: string;
  fileType: string;
  userId: string;
  organizationId?: string;
}

export interface CodeChunk {
  content: string;
  startLine: number;
  endLine: number;
  chunkType: 'function' | 'class' | 'method' | 'doc' | 'config' | 'other';
  astMetadata?: {
    functionName?: string;
    className?: string;
    methodName?: string;
    signature?: string;
    parameters?: string[];
    returnType?: string;
    docstring?: string;
    imports?: string[];
    exports?: string[];
  };
}

export interface IndexingResult {
  chunksCreated: number;
  chunksUpdated: number;
  chunksDeprecated: number;
  errors: string[];
  warnings: string[];
}

// Tree-sitter AST analysis interfaces
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
  methods: FunctionInfo[];
  properties: VariableInfo[];
  line: number;
  endLine: number;
  isExported?: boolean;
  visibility?: 'public' | 'private' | 'protected';
}

export interface ImportInfo {
  module: string;
  imports: string[];
  line: number;
  isTypeOnly?: boolean;
}

export interface ExportInfo {
  name: string;
  type: 'function' | 'class' | 'variable' | 'interface' | 'type' | 'other';
  line: number;
  isDefault?: boolean;
}

export interface TypeInfo {
  name: string;
  type: string;
  line: number;
  isExported?: boolean;
}

export interface InterfaceInfo {
  name: string;
  properties: VariableInfo[];
  methods: FunctionInfo[];
  line: number;
  endLine: number;
  isExported?: boolean;
}

export interface VariableInfo {
  name: string;
  type?: string;
  value?: string;
  line: number;
  isConst?: boolean;
  isExported?: boolean;
  visibility?: 'public' | 'private' | 'protected';
}

export interface CommentInfo {
  content: string;
  line: number;
  type: 'single' | 'multi' | 'doc';
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
