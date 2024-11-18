## Digdir Assistants CLI

Commands available:

Scope: each document in specified Typesense collection

`contentAnalysis` - use an LLM to extract the relevant language code
`generateSearchPhrases` - use an LLM to generate a set of search phrases related to the contents


## How to run

`yarn run:generateSearchPhrases`  
Be sure to set the `TYPESENSE_DOCS_SEARCH_PHRASE_COLLECTION` env var with the name of the Typesense collection


`yarn run:importKudosPublisers --dbhost localhost --dbname <mariadb-name> --dbuser <username> --dbpass <password> -c <collection-name> --pages -1`
`yarn run:importKudosRecipients --dbhost localhost --dbname <mariadb-name> --dbuser <username> --dbpass <password> -c <collection-name> --pages -1`
Be sure to set the TYPESENSE_API_HOST, TYPESENSE_API_KEY, and TYPESENSE_API_KEY_ADMIN env vars with your Typesense configuration.

If you have not imported the entire KUDOS dataset, you can safely ignore responses error code 404, "Could not find a document with id".


`yarn run:contentAnalysis`
Required env vars:
GROQ_API_KEY
TYPESENSE_DOCS_COLLECTION

