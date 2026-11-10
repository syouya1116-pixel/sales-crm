const HALF_KANA_MAP: Record<string, string> = {
  'ｦ':'ヲ','ｧ':'ァ','ｨ':'ィ','ｩ':'ゥ','ｪ':'ェ','ｫ':'ォ','ｬ':'ャ','ｭ':'ュ','ｮ':'ョ',
  'ｯ':'ッ','ｰ':'ー','ｱ':'ア','ｲ':'イ','ｳ':'ウ','ｴ':'エ','ｵ':'オ',
  'ｶ':'カ','ｷ':'キ','ｸ':'ク','ｹ':'ケ','ｺ':'コ',
  'ｻ':'サ','ｼ':'シ','ｽ':'ス','ｾ':'セ','ｿ':'ソ',
  'ﾀ':'タ','ﾁ':'チ','ﾂ':'ツ','ﾃ':'テ','ﾄ':'ト',
  'ﾅ':'ナ','ﾆ':'ニ','ﾇ':'ヌ','ﾈ':'ネ','ﾉ':'ノ',
  'ﾊ':'ハ','ﾋ':'ヒ','ﾌ':'フ','ﾍ':'ヘ','ﾎ':'ホ',
  'ﾏ':'マ','ﾐ':'ミ','ﾑ':'ム','ﾒ':'メ','ﾓ':'モ',
  'ﾔ':'ヤ','ﾕ':'ユ','ﾖ':'ヨ',
  'ﾗ':'ラ','ﾘ':'リ','ﾙ':'ル','ﾚ':'レ','ﾛ':'ロ',
  'ﾜ':'ワ','ﾝ':'ン',
}

// 半角の濁点「ﾞ」半濁点「ﾟ」は前の文字と独立した1文字なので、
// 先に合成しないと「ﾄｯﾌﾟ」が「トッフﾟ」になって「トップ」にヒットしない。
const HALF_KANA_VOICED_MAP: Record<string, string> = {
  'ｶﾞ':'ガ','ｷﾞ':'ギ','ｸﾞ':'グ','ｹﾞ':'ゲ','ｺﾞ':'ゴ',
  'ｻﾞ':'ザ','ｼﾞ':'ジ','ｽﾞ':'ズ','ｾﾞ':'ゼ','ｿﾞ':'ゾ',
  'ﾀﾞ':'ダ','ﾁﾞ':'ヂ','ﾂﾞ':'ヅ','ﾃﾞ':'デ','ﾄﾞ':'ド',
  'ﾊﾞ':'バ','ﾋﾞ':'ビ','ﾌﾞ':'ブ','ﾍﾞ':'ベ','ﾎﾞ':'ボ',
  'ｳﾞ':'ヴ','ﾜﾞ':'ヷ','ｦﾞ':'ヺ',
  'ﾊﾟ':'パ','ﾋﾟ':'ピ','ﾌﾟ':'プ','ﾍﾟ':'ペ','ﾎﾟ':'ポ',
}

// 半角英数字 → 全角
function toFullWidth(s: string): string {
  return s.replace(/[A-Za-z0-9]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0))
}

// ひらがな → カタカナ
function toKatakana(s: string): string {
  return s.replace(/[\u3041-\u3096]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60))
}

// カタカナ → ひらがな
function toHiragana(s: string): string {
  return s.replace(/[\u30A1-\u30F6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
}

// 入力を半角英数・全角カタカナに正規化（ひらがなはカタカナに統一・スペースは単一スペースに正規化）
export function normalizeSearch(text: string): string {
  let s = text.trim()
  s = s.replace(/[\s　]+/g, ' ')
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
  s = s.replace(/[ｦ-ﾝ][ﾞﾟ]/g, m => HALF_KANA_VOICED_MAP[m] || m)
  s = s.replace(/[ｦ-ﾝ]/g, c => HALF_KANA_MAP[c] || c)
  s = s.replace(/ﾞ/g, '゛').replace(/ﾟ/g, '゜')
  s = s.replace(/（株）|\(株\)|㈱/g, '株式会社')
  s = toKatakana(s)
  return s
}

// スペースを % に変換した ilike パターンを生成（"FRANK PRODUCTS" → "%FRANK%PRODUCTS%"）
export function buildIlikePattern(normalized: string): string {
  const parts = normalized.split(' ').filter(Boolean)
  return '%' + parts.join('%') + '%'
}

// 半角/全角・カタカナ/ひらがなの全バリアントを返す（OR検索用）
export function getSearchVariants(text: string): string[] {
  const normalized = normalizeSearch(text)
  if (!normalized) return []
  const variants = new Set<string>([normalized])
  const full = toFullWidth(normalized)
  if (full !== normalized) variants.add(full)
  const hira = toHiragana(normalized)
  if (hira !== normalized) variants.add(hira)
  return [...variants]
}
