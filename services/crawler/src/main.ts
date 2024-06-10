// For more information, see https://crawlee.dev/
import { Sitemap } from '@crawlee/utils';
import { PlaywrightCrawler } from '@crawlee/playwright'
import { createDocsCollectionIfNotExists } from '@digdir/assistant-lib'
import { createRouter } from './routes.ts';

const collectionName = 'NEW_docs';

// make sure we have a target collection to update
await createDocsCollectionIfNotExists(collectionName);

const crawler = new PlaywrightCrawler({
    // proxyConfiguration: new ProxyConfiguration({ proxyUrls: ['...'] }),
    requestHandler: createRouter(collectionName),
    headless: true,
    // Comment this option to scrape the full website.
    // maxRequestsPerCrawl: 5,    
});

const { urls } = await Sitemap.load('https://info.altinn.no/sitemap.xml');

const crawlRoutes = [
    // 'https://info.altinn.no/en/forms-overview/',
    'https://info.altinn.no/en/start-and-run-business/',
    'https://info.altinn.no/en/help/',
]

const ignoreRoutes = [
    "https://info.altinn.no/en/start-and-run-business/E-guide-",
    "https://info.altinn.no/en/start-and-run-business/e-guide-",
    "https://info.altinn.no/en/start-and-run-business/eguide-",
    "https://info.altinn.no/en/help/contact-us/",
    
]

const urlsToCrawl = urls.filter((url) => (
    crawlRoutes.some(route => url.startsWith(route)) &&
    !ignoreRoutes.some(route => url.startsWith(route))
))

// await crawler.addRequests(["https://info.altinn.no/en/forms-overview/civil-affairs-authority/bytte-bank-for-kapitalkonto/"])
// await crawler.addRequests(["https://info.altinn.no/en/start-and-run-business/running-business/running-a-private-limited-company/"])

await crawler.addRequests(urlsToCrawl);

// Run the crawler
await crawler.run();

