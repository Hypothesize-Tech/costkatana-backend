/**
 * Format Google API responses for consistent chat/API output.
 */

export function formatGoogleFileList(
  files: Array<{ id: string; name: string; webViewLink?: string }>,
): string {
  if (!Array.isArray(files) || files.length === 0) return 'No files found.';
  return files
    .map(
      (f, i) =>
        `${i + 1}. ${f.name} ${f.webViewLink ? `(${f.webViewLink})` : ''}`,
    )
    .join('\n');
}

export function formatGoogleCommandResult(
  command: string,
  success: boolean,
  data?: unknown,
  error?: string,
): string {
  if (!success)
    return `Command "${command}" failed: ${error ?? 'Unknown error'}`;
  if (data == null) return `Command "${command}" completed.`;
  if (
    Array.isArray(data) &&
    data.length > 0 &&
    typeof data[0] === 'object' &&
    data[0] !== null &&
    'name' in data[0]
  ) {
    return formatGoogleFileList(
      data as Array<{ id: string; name: string; webViewLink?: string }>,
    );
  }
  if (typeof data === 'object' && data !== null && 'content' in data) {
    const content = (data as { content?: string }).content;
    return typeof content === 'string'
      ? content.slice(0, 2000) + (content.length > 2000 ? '...' : '')
      : String(data);
  }
  return JSON.stringify(data);
}
