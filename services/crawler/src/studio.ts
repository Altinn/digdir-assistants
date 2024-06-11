// For more information, see https://crawlee.dev/
import { Sitemap } from '@crawlee/utils';
import { PlaywrightCrawler } from '@crawlee/playwright';
import { createDocsCollectionIfNotExists } from '@digdir/assistant-lib';
import { createRouter } from './routes.ts';

const collectionName = 'NEXT_studio-docs';

// make sure we have a target collection to update
await createDocsCollectionIfNotExists(collectionName);

const crawler = new PlaywrightCrawler({
  // proxyConfiguration: new ProxyConfiguration({ proxyUrls: ['...'] }),
  requestHandler: createRouter(collectionName, filterUrlsToCrawl),
  headless: true,
  // Comment this option to scrape the full website.
  // maxRequestsPerCrawl: 5,
});

const { urls } = await Sitemap.load('https://docs.altinn.studio/en/sitemap.xml');

function filterUrlsToCrawl(urls: string[]): string[] {
  const crawlRoutes = [
    // 'https://github.com/Altinn/altinn-studio/issues/',
    // 'https://github.com/digdir/roadmap/issues/',
    'https://docs.altinn.studio/',
  ];

  const ignoreRoutes = [
    'https://docs.altinn.studio/app/app-dev-course',
    'https://docs.altinn.studio/app/launched-apps',
    'https://docs.altinn.studio/tags',
    'https://docs.altinn.studio/api',
    'https://docs.altinn.studio/app/development/data/options/altinn2-codelists',
    'https://docs.altinn.studio/community/changelog/app-nuget',
    'https://docs.altinn.studio/community/about/slide/',
    'https://docs.altinn.studio/nb/',
  ];

  return urls.filter(
    (url) =>
      crawlRoutes.some((route) => url.startsWith(route)) &&
      !ignoreRoutes.some((route) => url.startsWith(route)),
  );
}

await crawler.addRequests(filterUrlsToCrawl(urls));
// await crawler.addRequests(["https://github.com/Altinn/altinn-studio/issues/5619"])

// Run the crawler
await crawler.run();
