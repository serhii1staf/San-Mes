/**
 * Pixel-character icon registry.
 *
 * 70 original AI-generated pixel-art icons in 7 themed packs. All sources
 * are bundled with the app — `require(...)` calls let Metro statically
 * include them and tree-shake unused ones from production builds.
 *
 * Source PNGs were 92 MB at original resolution; resized via
 * System.Drawing to 256x256 max (PowerShell pipeline, see
 * scripts/optimize-pixel-icons.ps1) which collapses the bundled set to
 * ~6 MB. Every individual asset is small enough that expo-image's
 * memory+disk cache absorbs the load with zero perceptible decode lag —
 * so the picker grid stays smooth even on weak devices.
 *
 * The registry shape (id + pack + title + source) is consumed by the
 * picker modal (`app/settings/pixel-icons.tsx`) and any future surfaces
 * that want to render an icon (e.g. profile decoration). `id` is stable
 * across rebuilds — it's safe to persist a chosen id in user settings.
 */

import type { ImageSourcePropType } from 'react-native';

export interface PixelIcon {
  /** Stable id, format `<pack>/<filename-without-ext>`. Persistable. */
  id: string;
  /** Pack identifier (matches the asset directory name). */
  pack: string;
  /** Human-readable title derived from the filename. */
  title: string;
  /** Pre-resolved `require()` source — usable directly with `<Image>` /
   *  `expo-image` `<Image source={...} />`. */
  source: ImageSourcePropType;
}

export interface PixelPack {
  id: string;
  /** Display label shown above each pack section in the picker grid. */
  label: string;
  /** Order in which the pack is shown in the picker. Lower first. */
  order: number;
}

/**
 * Pack metadata. Labels are deliberately short — the picker squeezes them
 * above each section in a grouped grid, so verbose names get truncated.
 */
export const PIXEL_PACKS: PixelPack[] = [
  { id: 'pack-1', label: 'Adventurers', order: 1 },
  { id: 'pack-3', label: 'Mystics', order: 2 },
  { id: 'pack-7-anime', label: 'Anime', order: 3 },
  { id: 'pack-8-kawaii-spooky', label: 'Kawaii Spooky', order: 4 },
  { id: 'pack-4-memes', label: 'Memes', order: 5 },
  { id: 'pack-6-memes', label: 'Memes II', order: 6 },
  { id: 'pack-9-ultra-memes', label: 'Ultra Memes', order: 7 },
];

export const PIXEL_ICONS: PixelIcon[] = [
  { id: 'pack-1/01_ghost_king', pack: 'pack-1', title: 'ghost king', source: require('../../../assets/pixel-icons/pack-1/01_ghost_king.png') },
  { id: 'pack-1/02_raccoon_thief', pack: 'pack-1', title: 'raccoon thief', source: require('../../../assets/pixel-icons/pack-1/02_raccoon_thief.png') },
  { id: 'pack-1/03_fox_adventurer', pack: 'pack-1', title: 'fox adventurer', source: require('../../../assets/pixel-icons/pack-1/03_fox_adventurer.png') },
  { id: 'pack-1/04_panda_scarf', pack: 'pack-1', title: 'panda scarf', source: require('../../../assets/pixel-icons/pack-1/04_panda_scarf.png') },
  { id: 'pack-1/05_capybara_orange', pack: 'pack-1', title: 'capybara orange', source: require('../../../assets/pixel-icons/pack-1/05_capybara_orange.png') },
  { id: 'pack-1/06_robot_retro', pack: 'pack-1', title: 'robot retro', source: require('../../../assets/pixel-icons/pack-1/06_robot_retro.png') },
  { id: 'pack-1/07_baby_dragon', pack: 'pack-1', title: 'baby dragon', source: require('../../../assets/pixel-icons/pack-1/07_baby_dragon.png') },
  { id: 'pack-1/08_shark_hoodie', pack: 'pack-1', title: 'shark hoodie', source: require('../../../assets/pixel-icons/pack-1/08_shark_hoodie.png') },
  { id: 'pack-1/09_mushroom_wizard', pack: 'pack-1', title: 'mushroom wizard', source: require('../../../assets/pixel-icons/pack-1/09_mushroom_wizard.png') },
  { id: 'pack-1/10_slime_cyclops', pack: 'pack-1', title: 'slime cyclops', source: require('../../../assets/pixel-icons/pack-1/10_slime_cyclops.png') },
  { id: 'pack-3/01_fox_shrine_maiden', pack: 'pack-3', title: 'fox shrine maiden', source: require('../../../assets/pixel-icons/pack-3/01_fox_shrine_maiden.png') },
  { id: 'pack-3/02_sloth_gamer', pack: 'pack-3', title: 'sloth gamer', source: require('../../../assets/pixel-icons/pack-3/02_sloth_gamer.png') },
  { id: 'pack-3/03_crystal_golem', pack: 'pack-3', title: 'crystal golem', source: require('../../../assets/pixel-icons/pack-3/03_crystal_golem.png') },
  { id: 'pack-3/04_sushi_ninja_cat', pack: 'pack-3', title: 'sushi ninja cat', source: require('../../../assets/pixel-icons/pack-3/04_sushi_ninja_cat.png') },
  { id: 'pack-3/05_vampire_bat_idol', pack: 'pack-3', title: 'vampire bat idol', source: require('../../../assets/pixel-icons/pack-3/05_vampire_bat_idol.png') },
  { id: 'pack-3/06_mecha_penguin_engineer', pack: 'pack-3', title: 'mecha penguin engineer', source: require('../../../assets/pixel-icons/pack-3/06_mecha_penguin_engineer.png') },
  { id: 'pack-3/07_pumpkin_witch_ghost', pack: 'pack-3', title: 'pumpkin witch ghost', source: require('../../../assets/pixel-icons/pack-3/07_pumpkin_witch_ghost.png') },
  { id: 'pack-3/08_cosmic_jellyfish', pack: 'pack-3', title: 'cosmic jellyfish', source: require('../../../assets/pixel-icons/pack-3/08_cosmic_jellyfish.png') },
  { id: 'pack-3/09_knight_corgi', pack: 'pack-3', title: 'knight corgi', source: require('../../../assets/pixel-icons/pack-3/09_knight_corgi.png') },
  { id: 'pack-3/10_lava_lizard_rocker', pack: 'pack-3', title: 'lava lizard rocker', source: require('../../../assets/pixel-icons/pack-3/10_lava_lizard_rocker.png') },
  { id: 'pack-4-memes/01_doomscroll_cat', pack: 'pack-4-memes', title: 'doomscroll cat', source: require('../../../assets/pixel-icons/pack-4-memes/01_doomscroll_cat.png') },
  { id: 'pack-4-memes/02_cool_pigeon', pack: 'pack-4-memes', title: 'cool pigeon', source: require('../../../assets/pixel-icons/pack-4-memes/02_cool_pigeon.png') },
  { id: 'pack-4-memes/03_sideeye_capybara', pack: 'pack-4-memes', title: 'sideeye capybara', source: require('../../../assets/pixel-icons/pack-4-memes/03_sideeye_capybara.png') },
  { id: 'pack-4-memes/04_laughing_skeleton_streamer', pack: 'pack-4-memes', title: 'laughing skeleton streamer', source: require('../../../assets/pixel-icons/pack-4-memes/04_laughing_skeleton_streamer.png') },
  { id: 'pack-4-memes/05_confused_frog_hoodie', pack: 'pack-4-memes', title: 'confused frog hoodie', source: require('../../../assets/pixel-icons/pack-4-memes/05_confused_frog_hoodie.png') },
  { id: 'pack-4-memes/06_smug_shiba_boss', pack: 'pack-4-memes', title: 'smug shiba boss', source: require('../../../assets/pixel-icons/pack-4-memes/06_smug_shiba_boss.png') },
  { id: 'pack-4-memes/07_buff_hamster', pack: 'pack-4-memes', title: 'buff hamster', source: require('../../../assets/pixel-icons/pack-4-memes/07_buff_hamster.png') },
  { id: 'pack-4-memes/08_conspiracy_raccoon', pack: 'pack-4-memes', title: 'conspiracy raccoon', source: require('../../../assets/pixel-icons/pack-4-memes/08_conspiracy_raccoon.png') },
  { id: 'pack-4-memes/09_sleepy_owl_coder', pack: 'pack-4-memes', title: 'sleepy owl coder', source: require('../../../assets/pixel-icons/pack-4-memes/09_sleepy_owl_coder.png') },
  { id: 'pack-4-memes/10_chaotic_goblin_keyboard', pack: 'pack-4-memes', title: 'chaotic goblin keyboard', source: require('../../../assets/pixel-icons/pack-4-memes/10_chaotic_goblin_keyboard.png') },
  { id: 'pack-6-memes/01_sideeye_cat', pack: 'pack-6-memes', title: 'sideeye cat', source: require('../../../assets/pixel-icons/pack-6-memes/01_sideeye_cat.png') },
  { id: 'pack-6-memes/02_screaming_frog_hoodie', pack: 'pack-6-memes', title: 'screaming frog hoodie', source: require('../../../assets/pixel-icons/pack-6-memes/02_screaming_frog_hoodie.png') },
  { id: 'pack-6-memes/03_swag_pigeon', pack: 'pack-6-memes', title: 'swag pigeon', source: require('../../../assets/pixel-icons/pack-6-memes/03_swag_pigeon.png') },
  { id: 'pack-6-memes/04_thumbs_up_slime', pack: 'pack-6-memes', title: 'thumbs up slime', source: require('../../../assets/pixel-icons/pack-6-memes/04_thumbs_up_slime.png') },
  { id: 'pack-6-memes/05_office_raccoon', pack: 'pack-6-memes', title: 'office raccoon', source: require('../../../assets/pixel-icons/pack-6-memes/05_office_raccoon.png') },
  { id: 'pack-6-memes/06_no_thoughts_wizard_frog', pack: 'pack-6-memes', title: 'no thoughts wizard frog', source: require('../../../assets/pixel-icons/pack-6-memes/06_no_thoughts_wizard_frog.png') },
  { id: 'pack-6-memes/07_buff_hamster', pack: 'pack-6-memes', title: 'buff hamster', source: require('../../../assets/pixel-icons/pack-6-memes/07_buff_hamster.png') },
  { id: 'pack-6-memes/08_sad_shark_hoodie', pack: 'pack-6-memes', title: 'sad shark hoodie', source: require('../../../assets/pixel-icons/pack-6-memes/08_sad_shark_hoodie.png') },
  { id: 'pack-6-memes/09_banana_knight', pack: 'pack-6-memes', title: 'banana knight', source: require('../../../assets/pixel-icons/pack-6-memes/09_banana_knight.png') },
  { id: 'pack-6-memes/10_goblin_influencer', pack: 'pack-6-memes', title: 'goblin influencer', source: require('../../../assets/pixel-icons/pack-6-memes/10_goblin_influencer.png') },
  { id: 'pack-7-anime/01_magical_girl_heroine', pack: 'pack-7-anime', title: 'magical girl heroine', source: require('../../../assets/pixel-icons/pack-7-anime/01_magical_girl_heroine.png') },
  { id: 'pack-7-anime/02_ninja_schoolboy', pack: 'pack-7-anime', title: 'ninja schoolboy', source: require('../../../assets/pixel-icons/pack-7-anime/02_ninja_schoolboy.png') },
  { id: 'pack-7-anime/03_mecha_pilot_girl', pack: 'pack-7-anime', title: 'mecha pilot girl', source: require('../../../assets/pixel-icons/pack-7-anime/03_mecha_pilot_girl.png') },
  { id: 'pack-7-anime/04_cat_eared_idol', pack: 'pack-7-anime', title: 'cat eared idol', source: require('../../../assets/pixel-icons/pack-7-anime/04_cat_eared_idol.png') },
  { id: 'pack-7-anime/05_fox_shrine_maiden', pack: 'pack-7-anime', title: 'fox shrine maiden', source: require('../../../assets/pixel-icons/pack-7-anime/05_fox_shrine_maiden.png') },
  { id: 'pack-7-anime/06_ramen_swordsman', pack: 'pack-7-anime', title: 'ramen swordsman', source: require('../../../assets/pixel-icons/pack-7-anime/06_ramen_swordsman.png') },
  { id: 'pack-7-anime/07_cyber_samurai_girl', pack: 'pack-7-anime', title: 'cyber samurai girl', source: require('../../../assets/pixel-icons/pack-7-anime/07_cyber_samurai_girl.png') },
  { id: 'pack-7-anime/08_sleepy_school_boy', pack: 'pack-7-anime', title: 'sleepy school boy', source: require('../../../assets/pixel-icons/pack-7-anime/08_sleepy_school_boy.png') },
  { id: 'pack-7-anime/09_gothic_vampire_princess', pack: 'pack-7-anime', title: 'gothic vampire princess', source: require('../../../assets/pixel-icons/pack-7-anime/09_gothic_vampire_princess.png') },
  { id: 'pack-7-anime/10_dragon_mascot', pack: 'pack-7-anime', title: 'dragon mascot', source: require('../../../assets/pixel-icons/pack-7-anime/10_dragon_mascot.png') },
  { id: 'pack-8-kawaii-spooky/01_ghost_cat_candy_bucket', pack: 'pack-8-kawaii-spooky', title: 'ghost cat candy bucket', source: require('../../../assets/pixel-icons/pack-8-kawaii-spooky/01_ghost_cat_candy_bucket.png') },
  { id: 'pack-8-kawaii-spooky/02_bat_bunny_moon_lollipop', pack: 'pack-8-kawaii-spooky', title: 'bat bunny moon lollipop', source: require('../../../assets/pixel-icons/pack-8-kawaii-spooky/02_bat_bunny_moon_lollipop.png') },
  { id: 'pack-8-kawaii-spooky/03_pumpkin_puppy', pack: 'pack-8-kawaii-spooky', title: 'pumpkin puppy', source: require('../../../assets/pixel-icons/pack-8-kawaii-spooky/03_pumpkin_puppy.png') },
  { id: 'pack-8-kawaii-spooky/04_witch_frog', pack: 'pack-8-kawaii-spooky', title: 'witch frog', source: require('../../../assets/pixel-icons/pack-8-kawaii-spooky/04_witch_frog.png') },
  { id: 'pack-8-kawaii-spooky/05_mushroom_ghost', pack: 'pack-8-kawaii-spooky', title: 'mushroom ghost', source: require('../../../assets/pixel-icons/pack-8-kawaii-spooky/05_mushroom_ghost.png') },
  { id: 'pack-8-kawaii-spooky/06_skeleton_lamb', pack: 'pack-8-kawaii-spooky', title: 'skeleton lamb', source: require('../../../assets/pixel-icons/pack-8-kawaii-spooky/06_skeleton_lamb.png') },
  { id: 'pack-8-kawaii-spooky/07_vampire_cat', pack: 'pack-8-kawaii-spooky', title: 'vampire cat', source: require('../../../assets/pixel-icons/pack-8-kawaii-spooky/07_vampire_cat.png') },
  { id: 'pack-8-kawaii-spooky/08_sleepy_teddy_ghost_pillow', pack: 'pack-8-kawaii-spooky', title: 'sleepy teddy ghost pillow', source: require('../../../assets/pixel-icons/pack-8-kawaii-spooky/08_sleepy_teddy_ghost_pillow.png') },
  { id: 'pack-8-kawaii-spooky/09_candy_corn_imp', pack: 'pack-8-kawaii-spooky', title: 'candy corn imp', source: require('../../../assets/pixel-icons/pack-8-kawaii-spooky/09_candy_corn_imp.png') },
  { id: 'pack-8-kawaii-spooky/10_lavender_slime_boots', pack: 'pack-8-kawaii-spooky', title: 'lavender slime boots', source: require('../../../assets/pixel-icons/pack-8-kawaii-spooky/10_lavender_slime_boots.png') },
  { id: 'pack-9-ultra-memes/01_burrito_possum', pack: 'pack-9-ultra-memes', title: 'burrito possum', source: require('../../../assets/pixel-icons/pack-9-ultra-memes/01_burrito_possum.png') },
  { id: 'pack-9-ultra-memes/02_meeting_ferret', pack: 'pack-9-ultra-memes', title: 'meeting ferret', source: require('../../../assets/pixel-icons/pack-9-ultra-memes/02_meeting_ferret.png') },
  { id: 'pack-9-ultra-memes/03_buffering_axolotl', pack: 'pack-9-ultra-memes', title: 'buffering axolotl', source: require('../../../assets/pixel-icons/pack-9-ultra-memes/03_buffering_axolotl.png') },
  { id: 'pack-9-ultra-memes/04_goose_ceo', pack: 'pack-9-ultra-memes', title: 'goose ceo', source: require('../../../assets/pixel-icons/pack-9-ultra-memes/04_goose_ceo.png') },
  { id: 'pack-9-ultra-memes/05_disco_snail', pack: 'pack-9-ultra-memes', title: 'disco snail', source: require('../../../assets/pixel-icons/pack-9-ultra-memes/05_disco_snail.png') },
  { id: 'pack-9-ultra-memes/06_goth_cactus_rockstar', pack: 'pack-9-ultra-memes', title: 'goth cactus rockstar', source: require('../../../assets/pixel-icons/pack-9-ultra-memes/06_goth_cactus_rockstar.png') },
  { id: 'pack-9-ultra-memes/07_buff_marshmallow_paladin', pack: 'pack-9-ultra-memes', title: 'buff marshmallow paladin', source: require('../../../assets/pixel-icons/pack-9-ultra-memes/07_buff_marshmallow_paladin.png') },
  { id: 'pack-9-ultra-memes/08_garbage_king_ghost', pack: 'pack-9-ultra-memes', title: 'garbage king ghost', source: require('../../../assets/pixel-icons/pack-9-ultra-memes/08_garbage_king_ghost.png') },
  { id: 'pack-9-ultra-memes/09_ramen_bat', pack: 'pack-9-ultra-memes', title: 'ramen bat', source: require('../../../assets/pixel-icons/pack-9-ultra-memes/09_ramen_bat.png') },
  { id: 'pack-9-ultra-memes/10_toaster_avenger', pack: 'pack-9-ultra-memes', title: 'toaster avenger', source: require('../../../assets/pixel-icons/pack-9-ultra-memes/10_toaster_avenger.png') },
];

/** Lookup table: id -> icon. Built once at module load. */
export const PIXEL_ICON_BY_ID: Record<string, PixelIcon> = (() => {
  const out: Record<string, PixelIcon> = {};
  for (const ic of PIXEL_ICONS) out[ic.id] = ic;
  return out;
})();

