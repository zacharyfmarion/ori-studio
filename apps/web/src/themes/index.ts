import type { TreeMakerTheme } from './types';

import atomOneLight from './presets/atom-one-light.json';
import ayuDark from './presets/ayu-dark.json';
import catppuccinLatte from './presets/catppuccin-latte.json';
import catppuccinMocha from './presets/catppuccin-mocha.json';
import cobalt2 from './presets/cobalt2.json';
import dracula from './presets/dracula.json';
import everforestDark from './presets/everforest-dark.json';
import githubDark from './presets/github-dark.json';
import githubLight from './presets/github-light.json';
import gruvboxDark from './presets/gruvbox-dark.json';
import gruvboxLight from './presets/gruvbox-light.json';
import horizon from './presets/horizon.json';
import monokai from './presets/monokai.json';
import nightOwl from './presets/night-owl.json';
import nord from './presets/nord.json';
import oneDark from './presets/one-dark.json';
import palenight from './presets/palenight.json';
import rosePine from './presets/rose-pine.json';
import shadesOfPurple from './presets/shades-of-purple.json';
import solarizedDark from './presets/solarized-dark.json';
import solarizedLight from './presets/solarized-light.json';
import synthwave84 from './presets/synthwave-84.json';
import tokyoNight from './presets/tokyo-night.json';

const oneDarkTheme = oneDark as TreeMakerTheme;
const atomOneLightTheme = atomOneLight as TreeMakerTheme;

export const PRESET_THEMES: TreeMakerTheme[] = [
  oneDarkTheme,
  atomOneLightTheme,
  solarizedDark as TreeMakerTheme,
  solarizedLight as TreeMakerTheme,
  monokai as TreeMakerTheme,
  dracula as TreeMakerTheme,
  nord as TreeMakerTheme,
  tokyoNight as TreeMakerTheme,
  catppuccinMocha as TreeMakerTheme,
  catppuccinLatte as TreeMakerTheme,
  rosePine as TreeMakerTheme,
  gruvboxDark as TreeMakerTheme,
  gruvboxLight as TreeMakerTheme,
  palenight as TreeMakerTheme,
  ayuDark as TreeMakerTheme,
  nightOwl as TreeMakerTheme,
  synthwave84 as TreeMakerTheme,
  everforestDark as TreeMakerTheme,
  cobalt2 as TreeMakerTheme,
  horizon as TreeMakerTheme,
  shadesOfPurple as TreeMakerTheme,
  githubDark as TreeMakerTheme,
  githubLight as TreeMakerTheme,
];

export const DEFAULT_DARK_THEME = oneDarkTheme;
export const DEFAULT_LIGHT_THEME = atomOneLightTheme;
export const DEFAULT_THEME = DEFAULT_DARK_THEME;

export { applyTheme, themeCssVariables } from './applyTheme';
export type { SyntaxColors, ThemeTokens, TreeMakerTheme } from './types';
