const STAT_MIN = 0;
const STAT_MAX = 10;

const DEFAULT_STATS = {
  hunger: 5,
  energy: 5,
  mood: 5,
};

const DEFAULT_SETTINGS = {
  soundEffects: 50,
  backgroundMusic: 50,
  showCatOnDesktop: true,
  launchAtStartup: false,
};

const DEFAULT_ROOM = {
  currentRoom: 'living', // 'living' | 'bathroom'
  wall: 'warm_brown',    // 'warm_brown' | 'honey_gold' | 'soft_sage' | 'plain_cream'
  floor: 'tan_oak',      // 'tan_oak' | 'dark_oak' | 'plain_sand'
  couch: 'original',     // 'original' | 'ash_gray' | 'none'
  fireplace: 'original', // 'original' | 'stone' | 'terracotta' | 'slate' | 'none'
  bookshelf: 'original', // 'original' | 'pastel' | 'oak_cabinet' | 'white_shelf' | 'white_cabinet' | 'walnut_cabinet' | 'none'
};

const DEFAULT_OVERLAY = {
  roaming: true,
  x: null,
  y: null,
  seenHintBubble: false,
};

/**
 * Care actions directly matched to the Cozy Cat Final High Fidelity Figma prototype
 * and Project Report (living room + bathroom).
 */
const ACTIONS = {
  feed: {
    id: 'feed',
    room: 'living',
    label: 'Feed',
    description: 'Fills bowl with cat kibble (Hunger +2)',
    deltas: { hunger: 2 },
    durationMs: 2200,
    animation: 'eat',
    fullCheckStat: 'hunger',
    fullMessage: 'Cat already full, try feeding later',
  },
  fish: {
    id: 'fish',
    room: 'living',
    label: 'Fish',
    description: 'Fish treat: Hunger +1, Mood +1',
    deltas: { hunger: 1, mood: 1 },
    durationMs: 2200,
    animation: 'fish',
    fullCheckStat: 'hunger',
    fullMessage: 'Cat already full, try feeding later',
  },
  play: {
    id: 'play',
    room: 'living',
    label: 'Play',
    description: 'Yarn ball: Mood +2, Energy -1',
    deltas: { energy: -1, mood: 2 },
    durationMs: 2400,
    animation: 'play',
    fullCheckStat: 'mood',
    fullMessage: 'Cat is already in the best mood!',
    minCheck: { stat: 'energy', min: 1, message: 'Cat is too tired to play, let it rest!' },
  },
  pet: {
    id: 'pet',
    room: 'any',
    label: 'Pet',
    description: 'Stroke the cat: Mood +1',
    deltas: { mood: 1 },
    durationMs: 1800,
    animation: 'pet',
    fullCheckStat: 'mood',
    fullMessage: 'Cat is already completely happy!',
  },
  sleep: {
    id: 'sleep',
    room: 'living',
    label: 'Sleep',
    description: 'Cat bed nap: Energy +3, Hunger -1',
    deltas: { hunger: -1, energy: 3 },
    durationMs: 2800,
    animation: 'sleep',
    fullCheckStat: 'energy',
    fullMessage: 'Cat already has full energy!',
    minCheck: { stat: 'hunger', min: 1, message: 'Cat is too hungry to sleep, feed it first!' },
  },
  bath: {
    id: 'bath',
    room: 'bathroom',
    label: 'Bath',
    description: 'Warm bubble bath: Energy +1, Mood +1',
    deltas: { energy: 1, mood: 1 },
    durationMs: 2400,
    animation: 'bath',
    fullCheckAll: ['energy', 'mood'],
    fullMessage: 'Cat is already clean, rested, and happy!',
  },
  toilet: {
    id: 'toilet',
    room: 'bathroom',
    label: 'Toilet',
    description: 'Use Toilet: Hunger -1, Mood +1',
    deltas: { hunger: -1, mood: 1 },
    durationMs: 2200,
    animation: 'toilet',
    fullCheckStat: 'mood',
    fullMessage: 'Cat is already feeling great!',
    minCheck: { stat: 'hunger', min: 1, message: "Cat's tummy is empty, feed it first!" },
  },
  wash_hands: {
    id: 'wash_hands',
    room: 'bathroom',
    label: 'Wash Hands',
    description: 'Wash Paws: Energy +1',
    deltas: { energy: 1 },
    durationMs: 2000,
    animation: 'wash_hands',
    fullCheckStat: 'energy',
    fullMessage: 'Cat already has full energy!',
  },
};

const CUSTOMIZATION_CATALOG = {
  walls: [
    { id: 'warm_brown', label: 'Warm brown', color: '#794a2b', texture: 'w_brown' },
    { id: 'honey_gold', label: 'Honey gold', color: '#9c713a', texture: 'w_gold' },
    { id: 'soft_sage', label: 'Soft sage', color: '#788a74', texture: 'w_sage' },
    { id: 'plain_cream', label: 'Plain warm', color: '#8f6b47', texture: null },
  ],
  floors: [
    { id: 'tan_oak', label: 'Tan oak', color: '#c49658', texture: 'f_tan' },
    { id: 'dark_oak', label: 'Dark oak', color: '#6b472b', texture: 'f_dark' },
    { id: 'plain_sand', label: 'Plain oak', color: '#b48850', texture: null },
  ],
  couches: [
    { id: 'original', label: 'Cream sofa' },
    { id: 'ash_gray', label: 'Gray sofa' },
    { id: 'none', label: 'None (Minimal)' },
  ],
  fireplaces: [
    { id: 'original', label: 'Original fireplace' },
    { id: 'stone', label: 'Stone hearth' },
    { id: 'terracotta', label: 'Warm clay hearth' },
    { id: 'slate', label: 'Slate hearth' },
    { id: 'none', label: 'None (Minimal)' },
  ],
  bookshelves: [
    { id: 'original', label: 'Original bookshelf' },
    { id: 'pastel', label: 'Pastel bookshelf' },
    { id: 'oak_cabinet', label: 'Oak cabinet' },
    { id: 'white_shelf', label: 'White bookshelf' },
    { id: 'white_cabinet', label: 'White cabinet' },
    { id: 'walnut_cabinet', label: 'Walnut cabinet' },
    { id: 'none', label: 'None (Minimal)' },
  ],
};

// Passive decay rates per minute (simulated pet needs over time)
const DECAY_PER_MINUTE = {
  hunger: 0.25, // ~1 full unit every 4 minutes
  energy: 0.20, // ~1 full unit every 5 minutes
  mood: 0.22,   // ~1 full unit every ~4.5 minutes
};

module.exports = {
  STAT_MIN,
  STAT_MAX,
  DEFAULT_STATS,
  DEFAULT_SETTINGS,
  DEFAULT_ROOM,
  DEFAULT_OVERLAY,
  ACTIONS,
  CUSTOMIZATION_CATALOG,
  DECAY_PER_MINUTE,
};
