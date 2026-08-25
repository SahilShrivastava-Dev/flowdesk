// ─────────────────────────────────────────────────────────────────────────────
// Devanagari → Latin transliteration
//
// This exists for one job: making "Ramesh" and "रमेश" the same string so that
// name resolution can compare them.
//
// Before this, `normaliseName` whitelisted `[a-z0-9\s]`, which deleted every
// Devanagari codepoint outright. "रमेश" normalised to the empty string, scored
// 0 against every candidate, and returned `not_found` — so a contact saved in
// Hindi script was permanently unreachable, and no query in either script could
// ever match one stored in the other. Levenshtein could not help: the two
// scripts share no codepoints, so even without the whitelist the distance is
// the full length of both strings.
//
// The output is deliberately NOT a scholarly transliteration. It is a matching
// key. Accuracy is measured only by whether the two spellings a person would
// plausibly use collapse onto the same string — so `श` and `ष` both become
// "sha", because nobody typing a name in Roman script distinguishes them.
//
// Pure: no clock, no I/O, no dependencies.
// ─────────────────────────────────────────────────────────────────────────────

/** Consonants, carrying the inherent "a" that Devanagari does not write. */
const CONSONANT: Record<string, string> = {
  'क': 'k',  'ख': 'kh', 'ग': 'g',  'घ': 'gh', 'ङ': 'n',
  'च': 'ch', 'छ': 'chh','ज': 'j',  'झ': 'jh', 'ञ': 'n',
  'ट': 't',  'ठ': 'th', 'ड': 'd',  'ढ': 'dh', 'ण': 'n',
  'त': 't',  'थ': 'th', 'द': 'd',  'ध': 'dh', 'न': 'n',
  'प': 'p',  'फ': 'ph', 'ब': 'b',  'भ': 'bh', 'म': 'm',
  'य': 'y',  'र': 'r',  'ल': 'l',  'व': 'v',
  'श': 'sh', 'ष': 'sh', 'स': 's',  'ह': 'h',
  'ळ': 'l',
};

/** What a nukta turns the preceding consonant into. */
const NUKTA: Record<string, string> = {
  'क': 'q', 'ख': 'kh', 'ग': 'g', 'ज': 'z', 'ड': 'r', 'ढ': 'rh', 'फ': 'f', 'य': 'y',
};

// Vowel length is deliberately folded away: आ and अ both become "a", ई and इ
// both become "i", ऊ and उ both become "u".
//
// A faithful transliteration would write "saaheel" for साहिल, but nobody
// spells their own name that way in Roman script — they write "Sahil". Keeping
// the length put an edit or two between every Devanagari name and the Roman
// spelling of the same name, which pushed exact matches down into the
// confirm-first band and made the system ask "did you mean…?" about a name it
// had actually matched perfectly. Folding turns सुनील/Sunil, राजेश/Rajesh,
// साहिल/Sahil and आशीष/Ashish into exact hits.

/** Independent vowels — the forms that start a syllable. */
const VOWEL: Record<string, string> = {
  'अ': 'a',  'आ': 'a',  'इ': 'i',  'ई': 'i',  'उ': 'u', 'ऊ': 'u',
  'ऋ': 'ri', 'ए': 'e',  'ऐ': 'ai', 'ओ': 'o',  'औ': 'au', 'ऑ': 'o', 'ऍ': 'e',
};

/** Vowel signs — the forms that replace a consonant's inherent "a". */
const MATRA: Record<string, string> = {
  'ा': 'a',  'ि': 'i',  'ी': 'i',  'ु': 'u',  'ू': 'u',
  'ृ': 'ri', 'े': 'e',  'ै': 'ai', 'ो': 'o',  'ौ': 'au',
  'ॉ': 'o',  'ॅ': 'e',
};

const VIRAMA        = '्'; // ् — kills the inherent vowel
const NUKTA_SIGN    = '़'; // ़
const ANUSVARA      = 'ं'; // ं
const CHANDRABINDU  = 'ँ'; // ँ
const VISARGA       = 'ः'; // ः
const AVAGRAHA      = 'ऽ'; // ऽ

const DIGIT: Record<string, string> = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};

/** True for any codepoint in the Devanagari block. */
export function hasDevanagari(text: string): boolean {
  return /[ऀ-ॿ]/.test(text);
}

/**
 * Transliterate a run of Devanagari into a Latin matching key.
 *
 * `word` is a maximal Devanagari run, so the final-schwa rule can be applied
 * at its end. Hindi does not pronounce the inherent "a" of a word's last
 * consonant — रमेश is "ramesh", not "ramesha" — and leaving it on would put an
 * edit of distance 1 between every Devanagari name and its Roman spelling,
 * which is exactly the band where confirmation prompts start appearing for no
 * reason.
 */
function transliterateRun(word: string): string {
  let out = '';
  // The consonant awaiting its vowel, and the vowel it will get.
  let pending: string | null = null;
  let pendingVowel = '';
  // Whether `pendingVowel` is the unwritten inherent "a" rather than a matra.
  let inherent = false;

  const flush = (): void => {
    if (pending !== null) {
      out += pending + pendingVowel;
      pending = null;
      pendingVowel = '';
    }
  };

  for (const ch of word) {
    if (CONSONANT[ch] !== undefined) {
      flush();
      pending = CONSONANT[ch];
      pendingVowel = 'a';
      inherent = true;
    } else if (ch === NUKTA_SIGN) {
      // Applies to the consonant already pending, so it is rewritten in place.
      if (pending !== null) {
        const base = Object.keys(CONSONANT).find((k) => CONSONANT[k] === pending);
        if (base && NUKTA[base]) pending = NUKTA[base];
      }
    } else if (MATRA[ch] !== undefined) {
      pendingVowel = MATRA[ch];
      inherent = false;
    } else if (ch === VIRAMA) {
      pendingVowel = '';
      inherent = false;
    } else if (VOWEL[ch] !== undefined) {
      flush();
      out += VOWEL[ch];
      inherent = false;
    } else if (ch === ANUSVARA || ch === CHANDRABINDU) {
      flush();
      out += 'n';
      inherent = false;
    } else if (ch === VISARGA) {
      flush();
      out += 'h';
      inherent = false;
    } else if (DIGIT[ch] !== undefined) {
      flush();
      out += DIGIT[ch];
      inherent = false;
    } else if (ch === AVAGRAHA) {
      // Purely orthographic — contributes nothing to a matching key.
    } else {
      flush();
      out += ch;
      inherent = false;
    }
  }

  // Final schwa deletion, but never down to a bare consonant: "न" on its own
  // is more useful as "na" than as "n".
  if (inherent && pending !== null && out.length + pending.length > 1) {
    pendingVowel = '';
  }
  flush();

  return out;
}

/**
 * Rewrite every Devanagari run in `text` as Latin, leaving everything else
 * untouched. Mixed-script input — "रमेश Traders" — comes out fully Latin.
 *
 * Returns `text` unchanged when it contains no Devanagari, so the common
 * all-Latin path costs one regex test.
 */
export function transliterate(text: string): string {
  if (!text || !hasDevanagari(text)) return text;

  // NFD first: precomposed nukta forms (क़ U+0958) decompose to base + nukta,
  // which is the only shape the loop above knows how to read.
  return text
    .normalize('NFD')
    .replace(/[ऀ-ॿ]+/g, (run) => transliterateRun(run));
}
