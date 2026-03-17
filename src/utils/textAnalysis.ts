import Sentiment from 'sentiment';

export interface TextAnalysis {
  language: string;
  sentiment: string;
  complexity: 'simple' | 'medium' | 'complex';
  keywords: string[];
}

/** Map ISO 639-3 (franc) to common ISO 639-1 where applicable for compatibility */
const ISO639_3_TO_1: Record<string, string> = {
  eng: 'en',
  spa: 'es',
  fra: 'fr',
  deu: 'de',
  ita: 'it',
  por: 'pt',
  rus: 'ru',
  jpn: 'ja',
  kor: 'ko',
  zho: 'zh',
  cmn: 'zh',
  ara: 'ar',
  hin: 'hi',
  ind: 'id',
  tur: 'tr',
  nld: 'nl',
  pol: 'pl',
  swe: 'sv',
  tha: 'th',
  und: 'en', // undetermined → fallback to English
};

async function detectLanguage(text: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return 'en';

  const { franc } = await import('franc-min');
  const iso6393 = franc(trimmed, { minLength: 1 });
  return ISO639_3_TO_1[iso6393] ?? iso6393;
}

function detectSentiment(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return 'neutral';

  const analyzer = new Sentiment();
  const result = analyzer.analyze(trimmed);

  if (result.score > 0) return 'positive';
  if (result.score < 0) return 'negative';
  return 'neutral';
}

export async function analyzeText(text: string): Promise<TextAnalysis> {
  let complexity: 'simple' | 'medium' | 'complex';

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 10) {
    complexity = 'simple';
  } else if (wordCount <= 30) {
    complexity = 'medium';
  } else {
    complexity = 'complex';
  }

  const keywords = text
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .filter(
      (word) =>
        !/^(the|and|or|but|if|then|when|where|what|how|why|with|for|from|to|in|on|at|by|of)$/i.test(
          word,
        ),
    )
    .slice(0, 10);

  const language = await detectLanguage(text);
  const sentiment = detectSentiment(text);

  return {
    language,
    sentiment,
    complexity,
    keywords,
  };
}
