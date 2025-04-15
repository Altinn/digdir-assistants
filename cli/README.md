## Digdir Assistants CLI

Use the cli and clj-cli to import and export Typesense collections.

- import and export of small collections will work fine with the bb-scripts version
- importing large JSONL files should be done with the clj-cli

Generate search phrases:

Use the following clj-cli command:

```
clj -M -m kudos-chunks.update-search-phrases <chunks collection name> <phrases collection name> --prompt keyword-search --threads 8

```

## How to run


`yarn kudos:importPublisers --dbhost localhost --dbname <mariadb-name> --dbuser <username> --dbpass <password> -c <collection-name> --pages -1`
`yarn kudos:importRecipients --dbhost localhost --dbname <mariadb-name> --dbuser <username> --dbpass <password> -c <collection-name> --pages -1`
Be sure to set the TYPESENSE_API_HOST, TYPESENSE_API_KEY, and TYPESENSE_API_KEY_ADMIN env vars with your Typesense configuration.

If you have not imported the entire KUDOS dataset, you can safely ignore responses error code 404, "Could not find a document with id".


`yarn contentAnalysis`
Required env vars:
TYPESENSE_DOCS_COLLECTION

