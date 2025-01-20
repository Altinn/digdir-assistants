## Digdir Assistants CLI

Commands available:

Scope: each document in specified Typesense collection

`contentAnalysis` - use an LLM to extract the relevant language code
`generateSearchPhrases` - use an LLM to generate a set of search phrases related to the contents


## How to run

`yarn run:generateSearchPhrases`  
Be sure to set the `TYPESENSE_DOCS_SEARCH_PHRASE_COLLECTION` env var with the name of the Typesense collection


`yarn run:contentAnalysis`
Required env vars:
TYPESENSE_DOCS_COLLECTION

