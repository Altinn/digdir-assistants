// For more information, see https://crawlee.dev/
import { Sitemap } from '@crawlee/utils';
import { Dataset } from '@crawlee/core';
import { PlaywrightCrawler } from '@crawlee/playwright';
import { ensureDocsAndChunksCollections, retrieveAllUrls } from '@digdir/assistant-lib';
import { createRouter, failedRequestHandler } from './routes.ts';
import { Command } from 'commander';

function filterUrlsToCrawl(urls: string[]): string[] {
  const allowedPrefixes = ['https://www.digdir.no/kunstig-intelligens/'];

  const ignoreRoutes = [];

  return urls.filter(
    (url) =>
      allowedPrefixes.some((route) => url.startsWith(route)) &&
      !ignoreRoutes.some((route) => url.startsWith(route)),
  );
}

async function main() {
  const program = new Command();
  program.name('crawl-studio-docs').description('Crawl the Digdir AI Guide site').version('0.1.0');

  program.requiredOption(
    '-c, --collection <string>',
    "docs collection to update.\n   Chunks collections name will be derived by replacing 'docs' with 'chunks'.",
  );

  program.parse(process.argv);
  const opts = program.opts();
  let docsCollectionName = opts.collection;
  const chunksCollectionName = docsCollectionName.replace('docs', 'chunks');

  // make sure we have a target collection to update
  await ensureDocsAndChunksCollections(docsCollectionName);

  const router = createRouter(docsCollectionName, filterUrlsToCrawl);
  const crawler = new PlaywrightCrawler({
    requestHandler: router,
    headless: true,
    failedRequestHandler: failedRequestHandler,
    // maxRequestsPerCrawl: 10,
  });

  const urls = [
    'https://www.digdir.no/kunstig-intelligens/rad-ansvarlig-utvikling-og-bruk-av-kunstig-intelligens-i-offentlig-sektor/4272',
    'https://www.digdir.no/kunstig-intelligens/apenhet-og-kunstig-intelligens/4581',
    'https://www.digdir.no/kunstig-intelligens/hvordan-vurderer-jeg-risiko-ved-bruk-av-kunstig-intelligens/4537',
    'https://www.digdir.no/kunstig-intelligens/bruk-av-generativ-kunstig-intelligens-i-offentlig-sektor/4670',
    'https://www.digdir.no/kunstig-intelligens/utvikler-eller-bruker-du-kunstig-intelligens/4600',
    'https://www.digdir.no/kunstig-intelligens/veiledning-ansvarlig-bruk-og-utvikling-av-kunstig-intelligens/4601',
    'https://www.digdir.no/kunstig-intelligens/ki-ressurser/4145',
  ];

  await crawler.addRequests(filterUrlsToCrawl(urls));

  // Run the crawler
  await crawler.run();

  await Dataset.exportToCSV('results');

  const allData = await Dataset.getData();

  // Replace the union and difference functions with custom logic

  // Custom union function
  function customUnion(setA: Set<string>, setB: Set<string>): Set<string> {
    const unionSet = new Set(setA);
    for (const item of setB) {
      unionSet.add(item);
    }
    return unionSet;
  }

  // Custom difference function
  function customDifference(setA: Set<string>, setB: Set<string>): Set<string> {
    const differenceSet = new Set(setA);
    for (const item of setB) {
      differenceSet.delete(item);
    }
    return differenceSet;
  }

  // Replace the union and difference functions in the code
  let i = 1;
  let alreadyIndexed = new Set<string>();
  let newUrls: string[] = [];
  do {
    newUrls = await retrieveAllUrls(docsCollectionName, i, 250);
    alreadyIndexed = customUnion(alreadyIndexed, new Set(newUrls));
    i++;
  } while (newUrls.length > 0);

  const crawledUrls = new Set<string>(
    allData.items.filter((item) => item.status == 'success').map((item) => item.url),
  );
  const redirectedUrls = new Set<string>(
    allData.items.filter((item) => item.status == 'redirected').map((item) => item.url),
  );
  const failedUrls = new Set<string>(
    allData.items.filter((item) => item.status == 'failed').map((item) => item.url),
  );
  const urlsToRemove = customDifference(alreadyIndexed, crawledUrls);
  const newUrlsAdded = customDifference(crawledUrls, alreadyIndexed);

  console.log(`Redirected:\n`, Array.from(redirectedUrls));
  console.log(`To remove:\n`, Array.from(urlsToRemove));
  console.log(`New:\n`, Array.from(newUrlsAdded));
  console.log(`Failed:\n`, Array.from(failedUrls));
  // console.log(`Indexed:\n`, Array.from(indexedUrls));
  console.log(
    `Last crawl: ${alreadyIndexed.size} | This crawl: ${crawledUrls.size} | Redirected: ${redirectedUrls.size} | Removed: ${urlsToRemove.size} | New: ${newUrlsAdded.size} | Failed: ${failedUrls.size}`,
  );

  // let i = 1;
  // let indexedUrls = new Set<string>();
  // let orphanedUrlsBatched = new Set<string>();
  // do {
  //   indexedUrls = indexedUrls.union(new Set(await retrieveAllUrls(collectionName, i, 250)));
  //   i++;
  // } while (orphanedUrlsBatched.size > 0);

  // const crawledUrls = new Set(allData.items.filter((item) => item.status == 'success').map((item) => item.url));
  // const urlsToRemove = indexedUrls.difference(crawledUrls);

  // console.log(`Urls to remove: ${urlsToRemove.size}`);
  // console.log(Array.from(urlsToRemove));
}

await main();
