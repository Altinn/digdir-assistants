import { createPlaywrightRouter } from '@crawlee/playwright';
import { Locator } from '@playwright/test';
import TurndownService from 'turndown';
import sha1 from 'sha1';
import { RagDoc, updateDocs, getDocChecksums, countTokens } from '@digdir/assistant-lib';
import { URL } from 'url';

const turndownService = new TurndownService();
const tokenCountWarningThreshold = 20;

type FilterUrlsToCrawl = (urls: string[]) => string[];

export function createRouter(collectionName: string, urlFilter: FilterUrlsToCrawl) {
  const router = createPlaywrightRouter();

  const localDefaultHandler = defaultHandler.bind(null, collectionName, urlFilter);

  router.addDefaultHandler(localDefaultHandler);
  

  // router.addHandler('detail', async ({ request, page, log, pushData }) => {
  //     const title = await page.title();
  //     log.info(`${title}`, { url: request.loadedUrl });

  //     await pushData({
  //         url: request.loadedUrl,
  //         title,
  //     });
  // });

  return router;
}

export async function defaultHandler(
  collectionName: string,
  urlFilter: FilterUrlsToCrawl,
  { page, request, log, crawler, pushData },
) {
    const startUrl = request.url;
    await page.waitForLoadState('networkidle');

  const fullPageUrl = page.url();

  const pageUrl_without_anchor = new URL(page.url()).origin + new URL(page.url()).pathname;
  if (pageUrl_without_anchor !== startUrl) {
    log.info(`Redirected from:\n${startUrl} to\n${fullPageUrl}`);

    await pushData({
      status: "redirected",
      originalUrl: startUrl,
      url: pageUrl_without_anchor,
      title: await page.title(),
    });
  }

  const locators = getLocators(request, page);
  const contents = await Promise.all(
    locators.map(async (locator) => {
      const elements = await locator.all();
      const innerHTMLs = await Promise.all(elements.map((element) => element.innerHTML()));

      // extract links
      const linksList = await Promise.all(
        elements.map(async (element) => {
          const linkElements = await element.getByRole('link').all();

          return await Promise.all(linkElements.map((link) => link.getAttribute('href')));
        }),
      );
      const links = linksList.flatMap((link) => link).filter((link) => link !== null) as string[];

      const filteredUrls = urlFilter(links);

      if (filteredUrls.length > 0) {
        log.info(`Adding ${filteredUrls.length} links:\n${JSON.stringify(filteredUrls)}`);
        await crawler.addRequests(
          filteredUrls.map((url: string) => {
            return { url: url || '' };
          }),
        );
      }

      return innerHTMLs.join('\n');
    }),
  );

  const markdown = turndownService.turndown(contents.join('\n\n'));
  //   log.info('Generating sha1 hash: ' + hash);
  
  const markdown_checksum = sha1(markdown);
  const urlHash = sha1(pageUrl_without_anchor);

  const updatedDoc: RagDoc = {
    id: urlHash,
    content_markdown: markdown,
    url: pageUrl_without_anchor,
    url_without_anchor: pageUrl_without_anchor,
    type: 'content',
    item_priority: 1,
    updated_at: Math.floor(new Date().getTime() / 1000),
    markdown_checksum: markdown_checksum,
    token_count: countTokens(markdown),
  };
  if (!markdown.trim()) {
    log.error(`No content extracted from '${pageUrl_without_anchor}'`);
    return;
  }
  if ((updatedDoc.token_count || 0) < tokenCountWarningThreshold) {
    log.warning(
      `Only ${updatedDoc.token_count} tokens extracted\n from ${pageUrl_without_anchor}\n consider verifying the locators for this url.`,
    );
  }

  const currentDocs = await getDocChecksums(collectionName, [urlHash]);

  if (
    currentDocs &&
    currentDocs.length > 0 &&
    currentDocs[0].id == urlHash &&
    currentDocs[0].markdown_checksum == markdown_checksum    
  ) {
       if (currentDocs[0].url_without_anchor != pageUrl_without_anchor) {
        log.warning(`Possible redirect, not updating yet...\noriginal url: ${currentDocs[0].url_without_anchor}\nnew url:   ${pageUrl_without_anchor}`);
       } else {
          log.info(
              `Tokens: ${updatedDoc.token_count}, no change for url: ${pageUrl_without_anchor}`,      
          );
        }
  } else {
    log.info(`Tokens: ${updatedDoc.token_count}, updating doc for url '${pageUrl_without_anchor}'`);
    await updateDocs([updatedDoc], collectionName);
  }

  await pushData({
    status: "success",
    tokens: updatedDoc.token_count,
    url: pageUrl_without_anchor,
    title: await page.title(),
  })
}

function getLocators(request, page): Locator[] {
  const locatorMap = {
    'https://info.altinn.no/en/forms-overview/': [
      page
        .locator('//*[@id="picker-container"]/div[@class="a-page"]/div[1]/div[3]/*/*')
        .filter({ hasNotText: 'Start service' }),
      page.locator('//*[@id="picker-container"]/div[@class="a-page"]/div[1]/div[4]/*'),
      page.locator('//*[@id="picker-container"]/div[@class="a-page"]/div[1]/div[5]'),
    ],
    'https://info.altinn.no/en/start-and-run-business/support-schemes/': [
      page.locator('//*/body[1]/div[1]/div[1]'),
    ],
    'https://info.altinn.no/en/start-and-run-business/': [page.locator('//*[@id="content"]/div')],
    'https://info.altinn.no/en/help/': [
      page.locator('//html/body/div[@class="a-page"]/div[@class="container"]'),
    ],
    'https://docs.altinn.studio/': [page.locator('//*[@id="body-inner"]')],
    'https://github.com/Altinn/altinn-studio/issues/': [page.locator('//div[@data-turbo-frame]')],
    'https://github.com/Altinn/altinn-studio/releases': [
      page.locator('//*[@id="repo-content-turbo-frame"]/div[1]'), // data-hpc
    ],
    'https://github.com/digdir/roadmap/issues/': [page.locator('//div[@data-turbo-frame"]')],
  };

  for (const url in locatorMap) {
    if (request.url.startsWith(url)) {
      return locatorMap[url];
    }
  }
  return [];
}


export async function failedRequestHandler({ request, pushData }) {
  // This function is called when the crawling of a request failed too many times
  await pushData({
      url: request.url,
      status: "failed",
      errors: request.errorMessages,
  })
}
