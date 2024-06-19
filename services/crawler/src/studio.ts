// For more information, see https://crawlee.dev/
import { Sitemap } from '@crawlee/utils';
import { Dataset } from '@crawlee/core';
import { PlaywrightCrawler } from '@crawlee/playwright';
import { createDocsCollectionIfNotExists, retrieveAllUrls } from '@digdir/assistant-lib';
import { createRouter, failedRequestHandler } from './routes.ts';

const collectionName = 'NEXT_studio-docs';

// make sure we have a target collection to update
await createDocsCollectionIfNotExists(collectionName);

const router = createRouter(collectionName, filterUrlsToCrawl);
const crawler = new PlaywrightCrawler({
  // proxyConfiguration: new ProxyConfiguration({ proxyUrls: ['...'] }),
  requestHandler: router,
  headless: true,
  failedRequestHandler: failedRequestHandler,
  
  // Comment this option to scrape the full website.
  // maxRequestsPerCrawl: 10,
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
// await crawler.addRequests([
//   // 'https://docs.altinn.studio/technology/altinnstudio/solutions/altinn-studio/',
// 'https://docs.altinn.studio/altinn-studio/reference/deployment/runtime-environment/resource-allocation-tips/',
//   'https://docs.altinn.studio/notifications/send-notifications/developer-guides/get-notification-order-by-id/',
//   'https://docs.altinn.studio/authorization/what-do-you-get/accessgroups/type-accessgroups/versjon-2/integrasjon/',
//   'https://docs.altinn.studio/authorization/what-do-you-get/accessgroups/type-accessgroups/versjon-3/integrasjon/',
//   'https://docs.altinn.studio/authorization/what-do-you-get/accessgroups/type-accessgroups/versjon-2/regnskapsf%C3%B8rere/',
//   'https://docs.altinn.studio/authorization/what-do-you-get/accessgroups/type-accessgroups/versjon-3/revisor/',
//   'https://docs.altinn.studio/altinn-studio/reference/configuration/authorization/guidelines_authorization/roles_and_rights/roles_altinn/altinn_roles_administration/',
//   'https://docs.altinn.studio/app/development/configuration/authorization/guidelines_authorization/roles_and_rights/roles_altinn/altinn_roles_administration/',
//   'https://docs.altinn.studio/technology/architecture/components/application/construction/altinn-platform/',
//   'https://docs.altinn.studio/altinn-studio/reference/configuration/authorization/guidelines_authorization/roles_and_rights/',
//   'https://docs.altinn.studio/altinn-studio/reference/configuration/authorization/guidelines_authorization/roles_and_rights/roles_altinn/',
//   'https://docs.altinn.studio/app/development/configuration/authorization/guidelines_authorization/roles_and_rights/',
//   'https://docs.altinn.studio/app/development/configuration/authorization/guidelines_authorization/roles_and_rights/roles_altinn/',
//   'https://docs.altinn.studio/technology/architecture/capabilities/devops/softwareconfiguration/deployment/altinn-studio/',
//   'https://docs.altinn.studio/technology/architecture/components/application/nonsolutionspecific/operations/backupandrecovery/',
//   'https://docs.altinn.studio/altinn-studio/reference/configuration/authorization/guidelines_authorization/roles_and_rights/roles_altinn/altinn_roles_enterprices/',
//   'https://docs.altinn.studio/app/development/configuration/authorization/guidelines_authorization/roles_and_rights/roles_altinn/altinn_roles_enterprices/',
//   'https://docs.altinn.studio/altinn-studio/reference/configuration/authorization/guidelines_authorization/roles_and_rights/roles_er/',
//   'https://docs.altinn.studio/app/development/configuration/authorization/guidelines_authorization/roles_and_rights/roles_er/',
//   'https://docs.altinn.studio/altinn-studio/reference/configuration/authorization/guidelines_authorization/',
//   'https://docs.altinn.studio/altinn-studio/reference/configuration/authorization/guidelines_authorization/roles_and_rights/roles_altinn/altinn_roles_persons/',
//   'https://docs.altinn.studio/app/development/configuration/authorization/guidelines_authorization/roles_and_rights/roles_altinn/altinn_roles_persons/',
//   'https://docs.altinn.studio/technology/architecture/components/application/construction/altinn-platform/profile/',
//   'https://docs.altinn.studio/technology/architecture/components/application/construction/altinn-platform/receipt/',
//   'https://docs.altinn.studio/technology/architecture/components/application/construction/altinn-platform/register/',
//   'https://docs.altinn.studio/altinn-studio/reference/configuration/authorization/guidelines_authorization/roles_and_rights/roles_ske/',
//   'https://docs.altinn.studio/technology/architecture/components/application/construction/altinn-platform/storage/'
// ]);

// await crawler.addRequests(["https://github.com/Altinn/altinn-studio/issues/5619"])

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
  newUrls = await retrieveAllUrls(collectionName, i, 250);
  alreadyIndexed = customUnion(alreadyIndexed, new Set(newUrls));
  i++;
} while (newUrls.length > 0);

const crawledUrls = new Set<string>(allData.items.filter((item) => item.status == 'success').map((item) => item.url));
const redirectedUrls = new Set<string>(allData.items.filter((item) => item.status == 'redirected').map((item) => item.url));
const failedUrls = new Set<string>(allData.items.filter((item) => item.status == 'failed').map((item) => item.url));
const urlsToRemove = customDifference(alreadyIndexed, crawledUrls);
const newUrlsAdded = customDifference(crawledUrls, alreadyIndexed);

console.log(`Redirected:\n`, Array.from(redirectedUrls));
console.log(`To remove:\n`, Array.from(urlsToRemove));
console.log(`New:\n`, Array.from(newUrlsAdded));
console.log(`Failed:\n`, Array.from(failedUrls));
// console.log(`Indexed:\n`, Array.from(indexedUrls));
console.log(`Last crawl: ${alreadyIndexed.size} | This crawl: ${crawledUrls.size} | Redirected: ${redirectedUrls.size} | Removed: ${urlsToRemove.size} | New: ${newUrlsAdded.size} | Failed: ${failedUrls.size}`);



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

