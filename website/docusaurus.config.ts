import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'Universal Cursor Hotkeys',
  tagline: "CJK-aware word navigation inside Obsidian's Markdown tables, with full Vim mode support",
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  url: 'https://shichishima.github.io',
  baseUrl: '/obsidian-universal-cursor-hotkeys/',

  // GitHub pages deployment config.
  organizationName: 'shichishima',
  projectName: 'obsidian-universal-cursor-hotkeys',
  deploymentBranch: 'gh-pages',
  trailingSlash: false,

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'zh', 'ja'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl:
            'https://github.com/shichishima/obsidian-universal-cursor-hotkeys/tree/main/website/',
          routeBasePath: '/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Universal Cursor Hotkeys',
      items: [
        {
          type: 'localeDropdown',
          position: 'right',
        },
        {
          href: 'https://github.com/shichishima/obsidian-universal-cursor-hotkeys',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/shichishima/obsidian-universal-cursor-hotkeys',
            },
            {
              label: 'Obsidian Community Plugin',
              href: 'https://obsidian.md/plugins?id=universal-cursor-hotkeys',
            },
            {
              html: '<a class="footer__link-item" href="https://forum.obsidian.md/t/universal-cursor-hotkeys-emacs-vim-navigation-for-markdown-tables/114542" target="_blank" rel="noopener noreferrer">Forum (en)<svg width="13.5" height="13.5" aria-label="(opens in new tab)" class="forum-link-icon"><use href="#theme-svg-external-link" /></svg></a> / <a class="footer__link-item" href="https://forum-zh.obsidian.md/t/topic/63176" target="_blank" rel="noopener noreferrer">(zh)<svg width="13.5" height="13.5" aria-label="(opens in new tab)" class="forum-link-icon"><use href="#theme-svg-external-link" /></svg></a>',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} shichishima. <a href="/obsidian-universal-cursor-hotkeys/changelog" style="color: inherit;">0.11.0</a>. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
