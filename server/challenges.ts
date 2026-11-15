export const categories = [
  { label: 'Main subject', weight: 30 },
  { label: 'Setting & objects', weight: 25 },
  { label: 'Composition', weight: 20 },
  { label: 'Lighting & color', weight: 15 },
  { label: 'Visual style', weight: 10 },
];

export const challenges = [
  { id: 'falls', name: 'Emerald Falls', difficulty: 'Easy', title: 'A quiet moment in the jungle', rubric: [
    'A single red wooden rowboat facing the camera, with two oars extended.',
    'A jade lake surrounded by lush tropical trees, with a thin white waterfall in the distance.',
    'The centered boat sits in the lower foreground, facing the centered waterfall, with foliage framing both sides.',
    'Soft misty daylight, dark green edges, brighter background, and reflections in the water.',
    'Realistic vertical nature photography with detailed water and leaves.',
  ], keywords: ['boat|rowboat|canoe', 'waterfall|jungle|lake', 'centered|foreground|middle', 'mist|green|jade|soft', 'photo|realistic'] },
  { id: 'alpine', name: 'Alpine Reflection', difficulty: 'Medium', title: 'A cabin at blue hour', rubric: [
    'An orange-lit A-frame cabin.',
    'A calm alpine lake, dark conifer trees, and jagged snow-covered mountains.',
    'The cabin sits on the right near the waterline. Its reflection and the mountain reflection occupy the foreground.',
    'Cool blue dusk, pink mountain highlights, and a strong warm orange glow in the cabin.',
    'Realistic vertical landscape photography with crisp mountains and a clear water reflection.',
  ], keywords: ['cabin|chalet|cottage', 'mountain|lake|snow|pine', 'right|reflection|reflected', 'blue|dusk|orange|twilight', 'photo|realistic'] },
  { id: 'desert', name: 'Desert Drive', difficulty: 'Hard', title: 'The last light on the road', rubric: [
    'A red vintage coupe shown from the rear three-quarter angle.',
    'A paved road with yellow center lines between tall sandstone formations in a desert.',
    'The car sits in the lower right and the road bends left toward the center distance. Rock towers frame the sky.',
    'A coral sunset with a small low sun, warm sandstone, and long soft shadows.',
    'Realistic vertical cinematic road photography.',
  ], keywords: ['car|coupe|mustang', 'road|desert|sandstone', 'right|curve|winding|rear', 'sunset|coral|golden|red', 'photo|realistic'] },
];

export function weightedScore(ratings: number[]) {
  return Math.round(categories.reduce((total, category, index) =>
    total + category.weight * ratings[index] / 5, 0));
}
