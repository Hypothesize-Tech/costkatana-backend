/**
 * Classify user intent for Google-related commands (Drive, Docs, Sheets, export).
 */

export type GoogleIntent =
  | 'list_docs'
  | 'list_sheets'
  | 'list_files'
  | 'open_file'
  | 'create_doc'
  | 'create_sheet'
  | 'export'
  | 'unknown';

export function classifyGoogleIntent(text: string): GoogleIntent {
  const lower = (text || '').toLowerCase();
  if (
    /\b(list|show)\s+(my\s+)?(google\s+)?docs?\b/.test(lower) ||
    lower.includes('list documents')
  )
    return 'list_docs';
  if (
    /\b(list|show)\s+(my\s+)?(google\s+)?sheets?\b/.test(lower) ||
    lower.includes('list spreadsheets')
  )
    return 'list_sheets';
  if (
    /\b(list|show)\s+(my\s+)?(drive\s+)?files?\b/.test(lower) ||
    lower.includes('list files')
  )
    return 'list_files';
  if (
    /\b(open|get|read|export)\s+(doc|file|sheet)\b/.test(lower) ||
    lower.includes('open file')
  )
    return 'open_file';
  if (/\bcreate\s+(a\s+)?(new\s+)?(google\s+)?doc\b/.test(lower))
    return 'create_doc';
  if (/\bcreate\s+(a\s+)?(new\s+)?(google\s+)?sheet\b/.test(lower))
    return 'create_sheet';
  if (
    lower.includes('export') &&
    (lower.includes('doc') || lower.includes('pdf'))
  )
    return 'export';
  return 'unknown';
}
