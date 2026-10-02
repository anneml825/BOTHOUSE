// One of these is picked per conversation as optional inspiration, so fresh starts don't all
// produce the same drawing. Varied on purpose: objects, places, creatures, weather, abstract ideas.
export const WORDS = [
  'lighthouse', 'octopus', 'volcano', 'teacup', 'labyrinth', 'comet', 'cactus', 'submarine', 'origami',
  'thunderstorm', 'lantern', 'jellyfish', 'treehouse', 'umbrella', 'glacier', 'carousel', 'beehive',
  'telescope', 'mushroom', 'canyon', 'kite', 'whale', 'clocktower', 'snail', 'fireworks', 'desert',
  'violin', 'robot', 'lily pad', 'skyscraper', 'chameleon', 'waterfall', 'rocket', 'campfire', 'owl',
  'iceberg', 'bicycle', 'coral reef', 'windmill', 'dragonfly', 'pyramid', 'harbor', 'fox', 'aurora',
  'hourglass', 'balloon', 'tornado', 'garden', 'penguin', 'bridge', 'eclipse', 'piano', 'castle',
  'flamingo', 'cave', 'train', 'sunflower', 'nebula', 'anchor', 'tiger', 'rainbow', 'ladder', 'moth',
  'island', 'crown', 'snowman', 'cathedral', 'turtle', 'dinosaur', 'meadow', 'spaceship', 'key',
  'heron', 'marketplace', 'shipwreck', 'dandelion', 'mountain', 'mirror', 'parrot', 'bonsai', 'storm',
  'library', 'seahorse', 'bridge at night', 'orchard', 'chess', 'raccoon', 'tidepool', 'skeleton',
  'circus', 'peacock', 'subway', 'lotus', 'mammoth', 'greenhouse', 'tea party', 'firefly', 'frog',
  'memory', 'silence', 'gravity', 'nostalgia', 'chaos', 'symmetry', 'echo', 'time', 'home', 'dream',
];

// Stable for a whole conversation (so the cached prompt doesn't change mid-conversation)
// Scrambles the seed so consecutive conversations get unrelated words
export function wordFor(seed: number): string {
  const n = Math.abs(Math.floor(seed));
  const mixed = Math.imul(n, 2654435761) >>> 0;
  return WORDS[mixed % WORDS.length];
}
