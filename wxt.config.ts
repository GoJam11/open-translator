import { defineConfig } from 'wxt';

const ICON_PATH = 'icon/logo.png';

const EXTENSION_ICONS = {
  16: ICON_PATH,
  32: ICON_PATH,
  48: ICON_PATH,
  96: ICON_PATH,
  128: ICON_PATH,
} as const;

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '纯净式翻译 · Open Translator',
    permissions: [
      'storage',
      'declarativeNetRequestWithHostAccess',
    ],
    host_permissions: ['<all_urls>'],
    icons: EXTENSION_ICONS,
    action: {
      default_title: '纯净式翻译 · Open Translate',
      default_icon: EXTENSION_ICONS,
    },
    options_ui: {
      page: 'entrypoints/options/index.html',
      open_in_tab: true,
    },
  },
});
