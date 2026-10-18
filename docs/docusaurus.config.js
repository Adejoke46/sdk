// @ts-check

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Dorisio SDK',
  tagline: 'Client abstraction layer for payment integration',
  favicon: 'img/favicon.ico',

  url: 'https://docs.dorisio.dev',
  baseUrl: '/',

  organizationName: 'Dorisio',
  projectName: 'sdk',

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: require.resolve('./sidebars.js'),
          editUrl: 'https://github.com/Dorisio/sdk/tree/main/docs/',
        },
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/docusaurus-social-card.jpg',
      navbar: {
        title: 'Dorisio SDK',
        logo: {
          alt: 'Dorisio Logo',
          src: 'img/logo.svg',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'tutorialSidebar',
            position: 'left',
            label: 'Tutorial',
          },
          {
            href: 'https://github.com/Dorisio/sdk',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              {
                label: 'API',
                to: '/docs/api',
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} Dorisio, Inc. Built with Docusaurus.`,
      },
    }),
};

module.exports = config;
