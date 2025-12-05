import { Random } from 'random-js';

/**
 * Adaptive Weighted Selection System
 *
 * This system prioritizes characters the user struggles with while ensuring
 * a balanced learning experience. Key features:
 *
 * 1. Sigmoid-based weight calculation for smooth, bounded adjustments
 * 2. Recency tracking - recently missed characters get priority that decays
 * 3. Streak awareness - consecutive misses compound weight with diminishing returns
 * 4. Minimum floor - mastered characters still appear occasionally
 * 5. Exploration factor - ensures variety even among difficult characters
 */

const random = new Random();

export interface CharacterWeight {
  correct: number;
  wrong: number;
  recentMisses: number[]; // timestamps of recent misses
  lastSeen: number; // timestamp when last shown
  consecutiveCorrect: number;
  consecutiveWrong: number;
}

/**
 * Creates a new adaptive selection instance.
 * Each instance maintains its own weight tracking, allowing different
 * game modes to have independent tracking.
 */
export function createAdaptiveSelector() {
  // Session-based weight tracking (resets when instance is recreated)
  const characterWeights: Map<string, CharacterWeight> = new Map();

  // Sigmoid function for smooth, bounded transformations
  const sigmoid = (
    x: number,
    steepness: number = 1,
    midpoint: number = 0
  ): number => {
    return 1 / (1 + Math.exp(-steepness * (x - midpoint)));
  };

  // Calculate adaptive weight for a character
  const calculateWeight = (char: string, allChars: string[]): number => {
    const weight = characterWeights.get(char);
    const now = Date.now();

    // Base weight for new/unseen characters
    if (!weight) {
      return 1.0;
    }

    const {
      correct,
      wrong,
      recentMisses,
      lastSeen,
      consecutiveCorrect,
      consecutiveWrong
    } = weight;
    const totalAttempts = correct + wrong;

    // Factor 1: Accuracy-based weight (inverted - lower accuracy = higher weight)
    // Uses sigmoid to create smooth curve: 0% accuracy → ~2.5x, 50% accuracy → ~1.5x, 100% accuracy → ~0.3x
    const accuracy = totalAttempts > 0 ? correct / totalAttempts : 0.5;
    const accuracyWeight = 2.5 * sigmoid(0.5 - accuracy, 6, 0);

    // Factor 2: Recency boost for recent misses (decays over time)
    // Misses within last 30 seconds get full boost, decaying to 0 over 2 minutes
    const recentMissWeight = recentMisses.reduce((acc, missTime) => {
      const ageSeconds = (now - missTime) / 1000;
      if (ageSeconds < 30) return acc + 0.5; // Full boost
      if (ageSeconds < 120) return acc + 0.5 * (1 - (ageSeconds - 30) / 90); // Decay
      return acc;
    }, 0);

    // Factor 3: Consecutive wrong answers (compound with diminishing returns)
    // Uses sqrt for diminishing returns: 1 miss → 1.2x, 3 misses → 1.35x, 9 misses → 1.6x
    const streakPenalty =
      consecutiveWrong > 0 ? 1 + 0.2 * Math.sqrt(consecutiveWrong) : 1;

    // Factor 4: Mastery cooldown (reduce weight for well-known characters)
    // Characters answered correctly 3+ times in a row get reduced priority
    const masteryCooldown =
      consecutiveCorrect >= 3
        ? Math.max(0.15, 1 - 0.15 * Math.min(consecutiveCorrect - 2, 5))
        : 1;

    // Factor 5: Time since last seen (slight boost for characters not shown recently)
    // Prevents the same character from appearing twice in quick succession
    const timeSinceLastSeen = (now - lastSeen) / 1000;
    const freshnessBoost = timeSinceLastSeen < 5 ? 0.3 : 1; // Suppress if shown in last 5 seconds

    // Factor 6: Exploration factor based on character pool size
    // Larger pools need more exploration; smaller pools focus more on problem areas
    const explorationFactor =
      allChars.length > 20
        ? 0.9 + 0.1 * random.real(0, 1) // More focused
        : 0.8 + 0.2 * random.real(0, 1); // More exploration

    // Combine all factors
    const finalWeight =
      accuracyWeight *
      (1 + recentMissWeight) *
      streakPenalty *
      masteryCooldown *
      freshnessBoost *
      explorationFactor;

    // Clamp to reasonable bounds: minimum 0.1 (never fully exclude), maximum 5.0
    return Math.max(0.1, Math.min(5.0, finalWeight));
  };

  /**
   * Select a character using weighted random selection.
   * Characters the user struggles with have higher probability of being selected.
   *
   * @param chars - Array of available characters to select from
   * @param excludeChar - Optional character to exclude (e.g., current character)
   * @returns The selected character
   */
  const selectWeightedCharacter = (
    chars: string[],
    excludeChar?: string
  ): string => {
    const availableChars = excludeChar
      ? chars.filter(c => c !== excludeChar)
      : chars;

    if (availableChars.length === 0) return chars[0];
    if (availableChars.length === 1) return availableChars[0];

    // Calculate weights for all available characters
    const weights = availableChars.map(char => ({
      char,
      weight: calculateWeight(char, chars)
    }));

    // Calculate total weight
    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);

    // Weighted random selection
    let randomValue = random.real(0, totalWeight);
    for (const { char, weight } of weights) {
      randomValue -= weight;
      if (randomValue <= 0) {
        return char;
      }
    }

    // Fallback (shouldn't happen)
    return availableChars[random.integer(0, availableChars.length - 1)];
  };

  /**
   * Update character weight after an answer.
   * Call this after the user answers correctly or incorrectly.
   *
   * @param char - The character that was answered
   * @param isCorrect - Whether the answer was correct
   */
  const updateCharacterWeight = (char: string, isCorrect: boolean): void => {
    const now = Date.now();
    const existing = characterWeights.get(char);

    if (!existing) {
      characterWeights.set(char, {
        correct: isCorrect ? 1 : 0,
        wrong: isCorrect ? 0 : 1,
        recentMisses: isCorrect ? [] : [now],
        lastSeen: now,
        consecutiveCorrect: isCorrect ? 1 : 0,
        consecutiveWrong: isCorrect ? 0 : 1
      });
    } else {
      // Update stats
      if (isCorrect) {
        existing.correct += 1;
        existing.consecutiveCorrect += 1;
        existing.consecutiveWrong = 0;
      } else {
        existing.wrong += 1;
        existing.consecutiveWrong += 1;
        existing.consecutiveCorrect = 0;
        existing.recentMisses.push(now);
        // Keep only misses from last 2 minutes
        existing.recentMisses = existing.recentMisses.filter(
          t => now - t < 120000
        );
      }
      existing.lastSeen = now;
    }
  };

  /**
   * Mark a character as seen (updates lastSeen timestamp).
   * Call this when a new character is displayed to the user.
   *
   * @param char - The character being displayed
   */
  const markCharacterSeen = (char: string): void => {
    const now = Date.now();
    const existing = characterWeights.get(char);
    if (existing) {
      existing.lastSeen = now;
    } else {
      characterWeights.set(char, {
        correct: 0,
        wrong: 0,
        recentMisses: [],
        lastSeen: now,
        consecutiveCorrect: 0,
        consecutiveWrong: 0
      });
    }
  };

  /**
   * Reset all character weights.
   * Useful when starting a new training session.
   */
  const reset = (): void => {
    characterWeights.clear();
  };

  /**
   * Get current weight data for a character (for debugging/analytics).
   *
   * @param char - The character to get weight for
   * @returns The character's weight data or undefined if not tracked
   */
  const getCharacterWeight = (char: string): CharacterWeight | undefined => {
    return characterWeights.get(char);
  };

  return {
    selectWeightedCharacter,
    updateCharacterWeight,
    markCharacterSeen,
    reset,
    getCharacterWeight
  };
}

// Type for the adaptive selector instance
export type AdaptiveSelector = ReturnType<typeof createAdaptiveSelector>;

// Global selector instance for shared state across components
// This ensures weights persist when switching between game modes in the same session
let globalSelector: AdaptiveSelector | null = null;

/**
 * Get the global adaptive selector instance.
 * Creates one if it doesn't exist.
 * Use this for shared state across game modes in the same training session.
 */
export function getGlobalAdaptiveSelector(): AdaptiveSelector {
  if (!globalSelector) {
    globalSelector = createAdaptiveSelector();
  }
  return globalSelector;
}

/**
 * Reset the global adaptive selector.
 * Call this when starting a completely new training session.
 */
export function resetGlobalAdaptiveSelector(): void {
  if (globalSelector) {
    globalSelector.reset();
  }
}
