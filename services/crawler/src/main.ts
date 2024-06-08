// For more information, see https://crawlee.dev/
import { Sitemap } from '@crawlee/utils';
import { PlaywrightCrawler } from '@crawlee/playwright'
import TurndownService from 'turndown';
import { createDocsCollectionIfNotExists, RagDoc, countTokens } from '@digdir/assistant-lib'
import sha1 from "sha1";


const startUrls = ['https://info.altinn.no/en/forms-overview/'];
const turndownService = new TurndownService();

// make sure we have a target collection to update
await createDocsCollectionIfNotExists('NEW_docs');

const crawler = new PlaywrightCrawler({
    // proxyConfiguration: new ProxyConfiguration({ proxyUrls: ['...'] }),
    // requestHandler: router,
    headless: true,
    // Comment this option to scrape the full website.
    maxRequestsPerCrawl: 5,
    
    // Function called for each URL
    requestHandler: async ({ page, request, log }) => {
        log.info('Crawling ' + request.url);

        const locators = [
            page.locator('//*[@id="picker-container"]/div[@class="a-page"]/div[1]/div[3]/*/*')
                 .filter({hasNotText: "Start service"}),                
            page.locator('//*[@id="picker-container"]/div[@class="a-page"]/div[1]/div[4]/*'),
            page.locator('//*[@id="picker-container"]/div[@class="a-page"]/div[1]/div[5]')    
        ]

        const contents = await Promise.all(locators.map(async (locator) => {

            const elements = await locator.all();
            const innerHTMLs = await Promise.all(elements.map(element => element.innerHTML()));
            return innerHTMLs.join("\n");            
        }));
        
        const markdown = turndownService.turndown(contents.join("\n\n"));

        const hash = sha1(request.url);
        log.info('Generating sha1 hash: ' + hash);

        const updatedDoc: RagDoc = {
            id: hash,
            content_markdown: markdown,            
            url: new URL(request.url).origin + new URL(request.url).pathname,            
            url_without_anchor: new URL(request.url).origin + new URL(request.url).pathname,
            type: 'content',
            item_priority: 1,
            updated_at: Math.floor(new Date().getTime() / 1000),
            markdown_checksum: sha1(markdown),
            token_count: countTokens(markdown),
        }
    
        log.info(markdown);        
    },
});

const { urls } = await Sitemap.load('https://info.altinn.no/sitemap.xml');

await crawler.addRequests(["https://info.altinn.no/en/forms-overview/civil-affairs-authority/bytte-bank-for-kapitalkonto/"])
// await crawler.addRequests(urls);

// Run the crawler
await crawler.run();
