// For more information, see https://crawlee.dev/
import { Sitemap } from '@crawlee/utils';
import { PlaywrightCrawler } from '@crawlee/playwright';
import { createDocsCollectionIfNotExists } from '@digdir/assistant-lib';
import { createRouter } from './routes.ts';

const collectionName = 'NEXT_infoportal-docs';

// make sure we have a target collection to update
await createDocsCollectionIfNotExists(collectionName);

const crawler = new PlaywrightCrawler({
  // proxyConfiguration: new ProxyConfiguration({ proxyUrls: ['...'] }),
  requestHandler: createRouter(collectionName, filterUrlsToCrawl),
  headless: true,
  // Comment this option to scrape the full website.
  // maxRequestsPerCrawl: 5,
});

const { urls } = await Sitemap.load('https://info.altinn.no/sitemap.xml');

function filterUrlsToCrawl(urls: string[]): string[] {
  const crawlRoutes = [
    'https://info.altinn.no/en/forms-overview/',
    'https://info.altinn.no/en/start-and-run-business/',
    'https://info.altinn.no/en/help/',
  ];

  const ignoreRoutes = [
    'https://info.altinn.no/en/start-and-run-business/E-guide-',
    'https://info.altinn.no/en/start-and-run-business/e-guide-',
    'https://info.altinn.no/en/start-and-run-business/eguide-',
    'https://info.altinn.no/en/help/contact-us/',
  ];

  return urls.filter(
    (url) =>
      crawlRoutes.some((route) => url.startsWith(route)) &&
      !ignoreRoutes.some((route) => url.startsWith(route)),
  );
}

// await crawler.addRequests(["https://info.altinn.no/en/start-and-run-business/running-business/running-a-private-limited-company/"])
await crawler.addRequests([
  'https://info.altinn.no/en/forms-overview/The-Norwegian-Directorate-of-Health-approval-of-foreign-professional-qualifications/medical-doctor-with-specialization-in-geriatrics/',
]);

// crawl filtered sitemap
// await crawler.addRequests(filterUrlsToCrawl(urls));

// Run the crawler
await crawler.run();
